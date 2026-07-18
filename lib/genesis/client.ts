import type { CarClient, CarStatus, StartOptions } from "../car.js";
import { SingleFlight } from "../single-flight.js";
import { AUTH_CODE_TTL_MS, BASE_URL, BROWSER_HEADERS, DEVICE_ID, ORIGIN } from "./constants.js";
import {
  GenesisApiError,
  GenesisAuthError,
  GenesisConfigError,
} from "./errors.js";
import type {
  LoginResponse,
  MyVehicleResponse,
  VehicleStatusResponse,
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
    const deviceId = process.env.GENESIS_DEVICE_ID;

    if (!username || !password || !pin || !deviceId) {
      throw new GenesisConfigError(
        "GENESIS_USERNAME, GENESIS_PASSWORD, GENESIS_PIN, and GENESIS_DEVICE_ID must all be set.",
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
    await this.#writeRequest(
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
    await this.#writeRequest(
      "/rmtstp",
      { pin: this.#pin },
      { forceRefreshAuthCode: true },
    );
    return { ok: true, action: "stop" };
  }

  async lock() {
    await this.#writeRequest("/drlck", { pin: this.#pin });
    return { ok: true, action: "lock" };
  }

  async unlock() {
    await this.#writeRequest("/drulck", { pin: this.#pin });
    return { ok: true, action: "unlock" };
  }

  async status(): Promise<CarStatus> {
    const res = await this.#readRequest<VehicleStatusResponse>("/rltmvhclsts");
    const s = res.result?.status;
    return {
      // ─── Engine & locks
      running: s?.engine ?? false,
      remoteStart: s?.remoteIgnition ?? false,
      locked: s?.doorLock ?? false,
      // ─── Openings
      hood: s?.hoodOpen ?? false,
      trunk: s?.trunkOpen ?? false,
      sunroof: s?.sunroofOpen ?? false,
      doors: {
        frontLeft: (s?.doorOpen?.frontLeft ?? 0) !== 0,
        frontRight: (s?.doorOpen?.frontRight ?? 0) !== 0,
        rearLeft: (s?.doorOpen?.backLeft ?? 0) !== 0,
        rearRight: (s?.doorOpen?.backRight ?? 0) !== 0,
      },
      // ─── Climate
      climate: s?.airCtrlOn ?? false,
      defrost: s?.defrost ?? false,
      // ─── Fuel & range
      fuelLevelPercent: s?.fuelLevel ?? 0,
      rangeKm: s?.dte?.value ?? 0,
      // ─── Battery
      batteryPercent: s?.battery?.batSoc ?? 0,
      // ─── Warnings
      warnings: {
        lowFuel: s?.lowFuelLight ?? false,
        tirePressure: (s?.tirePressureLamp?.tirePressureLampAll ?? 0) !== 0,
        smartKeyBattery: s?.smartKeyBatteryWarning ?? false,
        washerFluid: s?.washerFluidStatus ?? false,
        brakeOil: s?.breakOilStatus ?? false,
        engineOil: s?.engineOilStatus ?? false,
      },
      // ─── Meta
      lastUpdated: s?.lastStatusDate ?? "",
    };
  }

  // ─── Auth handshake ────────────────────────────────────────────────────────

  async #ensureAccessToken(): Promise<void> {
    if (this.#accessToken && Date.now() < this.#accessTokenExpiresAt) {
      console.log("[genesis] accessToken: cache hit, expires in",
        Math.round((this.#accessTokenExpiresAt - Date.now()) / 1000), "s");
      return;
    }
    console.log("[genesis] accessToken: cache miss → logging in");
    await this.#loginFlight.run(() => this.#login());
  }

  async #login(): Promise<void> {
    const res = await this.#httpJson<LoginResponse>("/v2/login", {
      method: "POST",
      skipAccessToken: true,
      extraHeaders: { Referer: `${ORIGIN}/login` },
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
    console.log("[genesis] login OK — token valid for",
      Math.round(ttlMs / 1000), "s");
    // Stale auth code and vehicle ID are tied to the previous session.
    this.#authCode = null;
    this.#authCodeExpiresAt = 0;
    this.#vehicleId = null;
  }

  async #ensureAuthCode(forceRefresh = false): Promise<void> {
    if (
      !forceRefresh &&
      this.#authCode &&
      Date.now() < this.#authCodeExpiresAt
    ) {
      console.log("[genesis] authCode: cache hit, expires in",
        Math.round((this.#authCodeExpiresAt - Date.now()) / 1000), "s");
      return;
    }
    console.log(
      forceRefresh
        ? "[genesis] authCode: forced refresh → verifying PIN"
        : "[genesis] authCode: cache miss → verifying PIN"
    );
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
    console.log("[genesis] PIN verified OK — authCode valid for",
      Math.round(AUTH_CODE_TTL_MS / 1000), "s");
  }

  async #ensureVehicleId(): Promise<void> {
    if (this.#vehicleIdOverride) {
      this.#vehicleId = this.#vehicleIdOverride;
      console.log("[genesis] vehicleId: using env override");
      return;
    }
    if (this.#vehicleId) {
      console.log("[genesis] vehicleId: cache hit");
      return;
    }
    console.log("[genesis] vehicleId: cache miss → fetching from myvehicle");
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

  // ─── Vehicle-scoped helpers: read (status) vs write (commands) ──────────

  /**
   * Read-only vehicle request — requires `accessToken` + `vehicleId`.
   * Does NOT verify the PIN. Use for status/info queries.
   */
  async #readRequest<T = unknown>(path: string, body?: unknown): Promise<T> {
    await this.#ensureAccessToken();
    await this.#ensureVehicleId();
    return this.#httpJson<T>(path, {
      method: "POST",
      body,
      extraHeaders: { vehicleid: this.#vehicleId! },
    });
  }

  /**
   * Write (command) vehicle request — requires `accessToken` + `vehicleId`
   * + a freshly verified `pAuth` code. Use for start/stop/lock/unlock.
   */
  async #writeRequest<T = unknown>(
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

  // ─── Low-level HTTP with retry-on-401 and retry-on-429 ──────────────────

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
    console.log(`[genesis] → ${opts.method} ${path}`);
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      "Content-Type": "application/json;charset=UTF-8",
      From: "CWP",
      Language: "0",
      Offset: "-4",
      Deviceid: DEVICE_ID!, // validated as set in constructor
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
    console.log(`[genesis] ← ${res.status} ${path}`);

    // Rate-limited by Cloudflare — throw immediately with a human-readable
    // retry time so the caller knows exactly when to try again.
    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : 60;
      const retryAt = new Date(Date.now() + waitSeconds * 1000);
      const retryTime = retryAt.toLocaleTimeString("en-CA", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      throw new GenesisApiError(
        `Rate limited by Cloudflare. Retry after ${retryTime}.`,
        429,
        "",
      );
    }

    // Session expired — drop cached auth material.
    // Do NOT retry inline if vehicle-scoped headers (pauth) are present:
    // those headers are stale too and need to be regenerated via #writeRequest.
    // Clearing the cached token here means the next #writeRequest call will
    // re-login, re-verify PIN, and retry cleanly.
    if (res.status === 401 && !opts._isRetry && !opts.skipAccessToken) {
      this.#accessToken = null;
      this.#accessTokenExpiresAt = 0;
      this.#refreshToken = null;
      this.#authCode = null;
      this.#authCodeExpiresAt = 0;
      this.#vehicleId = null;
      if (opts.extraHeaders?.pauth) {
        // Stale pauth — propagate the 401 so the caller retries via #writeRequest.
        throw new GenesisApiError(
          "Session expired. Please retry the request.",
          401,
          "",
        );
      }
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
