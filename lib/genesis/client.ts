import type { CarClient, CarStatus, StartOptions } from "../car.js";
import { SingleFlight } from "../single-flight.js";
import { AUTH_CODE_TTL_MS, BASE_URL, DEVICE_ID } from "./constants.js";
import {
  GenesisApiError,
  GenesisAuthError,
  GenesisConfigError,
} from "./errors.js";
import type {
  LoginResponse,
  MyVehicleResponse,
  VerifyPinResponse,
} from "./types.js";

/**
 * Native HTTP client for the Genesis Connected Services web portal
 * (`genesisconnect.ca/tods/api`).
 *
 * Speaks the browser-portal protocol end-to-end:
 *   1. `POST /v2/login`      → cached `accessToken`
 *   2. `POST /vrfypin`       → cached `pAuth` (TTL configurable)
 *   3. `POST /v2/myvehicle`  → cached `vehicleId` (with env override)
 *   4. `POST /rmtstrt` / `/rmtstp` / `/drlck` / `/drulck`  → vehicle commands
 *
 * Concurrency: parallel calls into any handshake step share a single in-flight
 * Promise, so a burst of requests only triggers one login/verify/lookup.
 *
 * Session refresh: any downstream 401 clears cached auth material and retries
 * the request exactly once.
 */
export class GenesisCarClient implements CarClient {
  readonly #username: string;
  readonly #password: string;
  readonly #pin: string;
  readonly #vehicleIdOverride: string | undefined;

  #accessToken: string | null = null;
  #accessTokenExpiresAt = 0;
  #refreshToken: string | null = null;
  #authCode: string | null = null;
  #authCodeExpiresAt = 0;
  #vehicleId: string | null = null;

  // Serialize concurrent handshake requests.
  readonly #loginFlight = new SingleFlight();
  readonly #authCodeFlight = new SingleFlight();
  readonly #vehicleIdFlight = new SingleFlight();

  constructor() {
    const username = process.env.GENESIS_USERNAME;
    const password = process.env.GENESIS_PASSWORD;
    const pin = process.env.GENESIS_PIN;

    if (!username || !password || !pin) {
      throw new GenesisConfigError(
        "GENESIS_USERNAME, GENESIS_PASSWORD, and GENESIS_PIN must all be set.",
      );
    }

    this.#username = username;
    this.#password = password;
    this.#pin = pin;
    this.#vehicleIdOverride = process.env.GENESIS_VEHICLE_ID || undefined;
  }

  // ─── Public API (CarClient) ────────────────────────────────────────────────

  async start(options?: StartOptions) {
    const durationMinutes = options?.durationMinutes ?? 10;
    await this.#vehicleRequest(
      "/rmtstrt",
      {
        setting: {
          airCtrl: 1,
          defrost: false,
          airTemp: { value: "10H", unit: 0, hvacTempType: 1 },
          heating1: 0,
          igniOnDuration: durationMinutes,
          seatHeaterVentCMD: {
            drvSeatOptCmd: 5,
            astSeatOptCmd: 2,
            rlSeatOptCmd: 2,
            rrSeatOptCmd: 2,
          },
          ims: 0,
          defaultFavorite: true,
        },
        pin: this.#pin,
      },
      { forceRefreshAuthCode: true },
    );
    return { ok: true, action: "start" };
  }

  async stop() {
    await this.#vehicleRequest(
      "/rmtstp",
      { pin: this.#pin },
      { forceRefreshAuthCode: true },
    );
    return { ok: true, action: "stop" };
  }

  async lock() {
    await this.#vehicleRequest("/drlck", { pin: this.#pin });
    return { ok: true, action: "lock" };
  }

  async unlock() {
    await this.#vehicleRequest("/drulck", { pin: this.#pin });
    return { ok: true, action: "unlock" };
  }

  async status(): Promise<CarStatus> {
    // The Postman capture only exposes `myvehicle` (registration data) and
    // `rmtsts` (transaction status). Neither returns real-time lock/engine
    // state, so we can only surface a placeholder shape here.
    await this.#ensureVehicleId();
    return { locked: false, running: false };
  }

  // ─── Auth handshake ────────────────────────────────────────────────────────

  async #ensureAccessToken(): Promise<void> {
    if (this.#accessToken && Date.now() < this.#accessTokenExpiresAt) return;
    await this.#loginFlight.run(() => this.#login());
  }

  async #login(): Promise<void> {
    const res = await this.#httpJson<LoginResponse>("/v2/login", {
      method: "POST",
      skipAccessToken: true,
      body: { loginId: this.#username, password: this.#password },
    });
    const token = res.result?.token?.accessToken;
    if (!token) {
      throw new GenesisAuthError(
        "Login response did not include an accessToken.",
      );
    }
    this.#accessToken = token;
    // Treat the server-supplied lifetime (seconds) as the TTL, minus a 60-second
    // buffer so we never hand an about-to-expire token to the next request.
    const ttlMs = ((res.result?.token?.expireIn ?? 86400) - 60) * 1000;
    this.#accessTokenExpiresAt = Date.now() + ttlMs;
    this.#refreshToken = res.result?.token?.refreshToken ?? null;
    // Any stale auth code is tied to the previous session.
    this.#authCode = null;
    this.#authCodeExpiresAt = 0;
  }

  async #ensureAuthCode(forceRefresh = false): Promise<void> {
    if (
      !forceRefresh &&
      this.#authCode &&
      Date.now() < this.#authCodeExpiresAt
    ) {
      return;
    }
    if (forceRefresh) {
      // Invalidate the cache so a concurrent non-forcing caller doesn't reuse
      // it while we're in the middle of refreshing.
      this.#authCode = null;
      this.#authCodeExpiresAt = 0;
    }
    await this.#authCodeFlight.run(() => this.#verifyPin());
  }

  async #verifyPin(): Promise<void> {
    await this.#ensureAccessToken();
    const res = await this.#httpJson<VerifyPinResponse>("/vrfypin", {
      method: "POST",
      body: { pin: this.#pin },
    });
    const authCode = res.result?.pAuth;
    if (!authCode) {
      throw new GenesisAuthError("verify pin response did not include pAuth.");
    }
    this.#authCode = authCode;
    this.#authCodeExpiresAt = Date.now() + AUTH_CODE_TTL_MS;
  }

  async #ensureVehicleId(): Promise<void> {
    if (this.#vehicleIdOverride) {
      this.#vehicleId = this.#vehicleIdOverride;
      return;
    }
    if (this.#vehicleId) return;
    await this.#vehicleIdFlight.run(() => this.#fetchVehicleId());
  }

  async #fetchVehicleId(): Promise<void> {
    await this.#ensureAccessToken();
    const res = await this.#httpJson<MyVehicleResponse>("/v2/myvehicle", {
      method: "POST",
    });
    const vehicleId =
      res.result?.vehicles?.[0]?.vehicleId ?? res.result?.vehicleId;
    if (!vehicleId) {
      throw new GenesisApiError(
        "myvehicle response did not include a vehicleId.",
        500,
        JSON.stringify(res),
      );
    }
    this.#vehicleId = vehicleId;
  }

  // ─── Vehicle-scoped request (adds pauth + vehicleid headers) ──────────────

  async #vehicleRequest<T = unknown>(
    path: string,
    body: unknown,
    opts: { forceRefreshAuthCode?: boolean } = {},
  ): Promise<T> {
    await this.#ensureAccessToken();
    await this.#ensureAuthCode(opts.forceRefreshAuthCode);
    await this.#ensureVehicleId();
    return this.#httpJson<T>(path, {
      method: "POST",
      body,
      extraHeaders: {
        pauth: this.#authCode!,
        vehicleid: this.#vehicleId!,
      },
    });
  }

  // ─── Low-level HTTP with retry-on-401 ─────────────────────────────────────

  async #httpJson<T>(
    path: string,
    opts: {
      method: "GET" | "POST";
      body?: unknown;
      extraHeaders?: Record<string, string>;
      skipAccessToken?: boolean;
      _isRetry?: boolean;
    },
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      From: "CWP",
      Language: "0",
      Offset: "-4",
      Deviceid: DEVICE_ID,
      ...opts.extraHeaders,
    };
    if (!opts.skipAccessToken && this.#accessToken) {
      headers.accesstoken = this.#accessToken;
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    // Session expired — drop cached auth material and retry once.
    if (res.status === 401 && !opts._isRetry && !opts.skipAccessToken) {
      this.#accessToken = null;
      this.#accessTokenExpiresAt = 0;
      this.#refreshToken = null;
      this.#authCode = null;
      this.#authCodeExpiresAt = 0;
      return this.#httpJson<T>(path, { ...opts, _isRetry: true });
    }

    const text = await res.text();
    if (!res.ok) {
      throw new GenesisApiError(
        `Genesis ${opts.method} ${path} failed with ${res.status}`,
        res.status,
        text.slice(0, 500),
      );
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  }
}
