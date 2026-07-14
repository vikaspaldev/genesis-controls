import type { CarClient, CarStatus, StartOptions } from "./car.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = "https://www.genesisconnect.ca/tods/api";

/**
 * Base64-encoded browser fingerprint the Genesis web portal requires on every
 * request. Reused verbatim from the working Postman collection — decodes to a
 * Chrome/Edge on macOS UA string plus screen resolution.
 */
const DEVICE_ID =
  "TW96aWxsYS81LjAgKE1hY2ludG9zaDsgSW50ZWwgTWFjIE9TIFggMTBfMTVfNykgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE1MC4wLjAuMCBTYWZhcmkvNTM3LjM2IEVkZ2UvMTUwLjAuMC4wK01hY0ludGVsKzM0NDAuMTQ0MA==";

/** PIN-verification auth codes have a short server-side TTL; refresh proactively. */
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

// ─── Response type shapes (only the fields we consume) ────────────────────────

interface LoginResponse {
  result?: {
    token?: {
      accessToken?: string;
      refreshToken?: string;
    };
  };
}

interface VerifyPinResponse {
  result?: {
    pAuth?: string;
  };
}

interface MyVehicleResponse {
  result?: {
    vehicles?: Array<{ vehicleId?: string; nickName?: string }>;
    // some payloads use a flat `vehicleId` — tolerate both
    vehicleId?: string;
  };
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class GenesisConfigError extends Error {}
export class GenesisAuthError extends Error {}
export class GenesisApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class GenesisCarClient implements CarClient {
  readonly #username: string;
  readonly #password: string;
  readonly #pin: string;
  readonly #vehicleIdOverride: string | undefined;

  #accessToken: string | null = null;
  #authCode: string | null = null;
  #authCodeExpiresAt = 0;
  #vehicleId: string | null = null;

  // Serialize concurrent login / pin-verify / vehicle-lookup requests so
  // several parallel API calls don't all trigger the same handshake.
  #loginInFlight: Promise<void> | null = null;
  #authCodeInFlight: Promise<void> | null = null;
  #vehicleIdInFlight: Promise<void> | null = null;

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
    // Genesis web portal encodes cabin temperature as a hex string ("FEH" ≈ 22°C
    // from the Postman capture). Until we reverse the full table, honor the
    // capture default and ignore custom temperatures.
    await this.#vehicleRequest("/rmtstrt", {
      setting: {
        airCtrl: 1,
        defrost: true,
        airTemp: { value: "FEH", unit: 0, hvacTempType: 1 },
        heating1: 4,
        igniOnDuration: durationMinutes,
        seatHeaterVentCMD: {
          drvSeatOptCmd: 8,
          astSeatOptCmd: 0,
          rlSeatOptCmd: 0,
          rrSeatOptCmd: 0,
        },
        ims: 0,
        defaultFavorite: true,
      },
      pin: this.#pin,
    });
    return { ok: true, action: "start" };
  }

  async stop() {
    await this.#vehicleRequest("/rmtstp", { pin: this.#pin });
    return { ok: true, action: "stop" };
  }

  async lock(): Promise<{ ok: boolean; action: string }> {
    await this.#vehicleRequest("/drlck", { pin: this.#pin });
    return { ok: true, action: "lock" };
  }

  async unlock(): Promise<{ ok: boolean; action: string }> {
    await this.#vehicleRequest("/drulck", { pin: this.#pin });
    return { ok: true, action: "unlock" };
  }

  async status(): Promise<CarStatus> {
    // The Postman capture only exposes `myvehicle` (registration data) and
    // `rmtsts` (transaction status). Neither returns real-time lock/engine
    // state, so we can only surface a limited shape here.
    await this.#ensureVehicleId();
    return { locked: false, running: false };
  }

  // ─── Auth handshake ────────────────────────────────────────────────────────

  async #ensureAccessToken(): Promise<void> {
    if (this.#accessToken) return;
    this.#loginInFlight ??= this.#login().finally(() => {
      this.#loginInFlight = null;
    });
    await this.#loginInFlight;
  }

  async #login(): Promise<void> {
    const res = await this.#httpJson<LoginResponse>("/v2/login", {
      method: "POST",
      skipAccessToken: true,
      body: { loginId: this.#username, password: this.#password },
    });
    const token = res.result?.token?.accessToken;
    if (!token) {
      throw new GenesisAuthError("Login response did not include an accessToken.");
    }
    this.#accessToken = token;
    // Any stale auth code / vehicle id is tied to the previous session.
    this.#authCode = null;
    this.#authCodeExpiresAt = 0;
  }

  async #ensureAuthCode(): Promise<void> {
    if (this.#authCode && Date.now() < this.#authCodeExpiresAt) return;
    this.#authCodeInFlight ??= this.#verifyPin().finally(() => {
      this.#authCodeInFlight = null;
    });
    await this.#authCodeInFlight;
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
    this.#vehicleIdInFlight ??= this.#fetchVehicleId().finally(() => {
      this.#vehicleIdInFlight = null;
    });
    await this.#vehicleIdInFlight;
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
  ): Promise<T> {
    await this.#ensureAccessToken();
    await this.#ensureAuthCode();
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
