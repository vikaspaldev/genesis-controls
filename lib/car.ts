import { GenesisCarClient } from "./genesis/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StartOptions {
  /** How many minutes to run the engine (default: 10). */
  durationMinutes?: number;
  /** Target cabin temperature in Celsius. */
  temperature?: number;
}

export interface CarStatus {
  // ─── Engine & locks ───────────────────────────────────────────────────────
  running: boolean;             // engine on/off
  remoteStart: boolean;         // started via remote ignition
  locked: boolean;              // door lock state

  // ─── Openings ─────────────────────────────────────────────────────────────
  hood: boolean;                // hood open
  trunk: boolean;               // trunk open
  sunroof: boolean;             // sunroof open
  doors: {
    frontLeft: boolean;
    frontRight: boolean;
    rearLeft: boolean;
    rearRight: boolean;
  };

  // ─── Climate ──────────────────────────────────────────────────────────────
  climate: boolean;             // A/C or heat active
  defrost: boolean;             // front defrost active

  // ─── Fuel & range ─────────────────────────────────────────────────────────
  fuelLevelPercent: number;     // 0–100
  rangeKm: number;              // estimated range in km

  // ─── 12 V battery ─────────────────────────────────────────────────────────
  batteryPercent: number;       // battery.batSoc (0–100)

  // ─── Warnings ─────────────────────────────────────────────────────────────
  warnings: {
    lowFuel: boolean;
    tirePressure: boolean;
    smartKeyBattery: boolean;
    washerFluid: boolean;
    brakeOil: boolean;
    engineOil: boolean;
  };

  // ─── Meta ─────────────────────────────────────────────────────────────────
  /** Raw timestamp from Genesis portal, format "YYYYMMDDHHmmss" */
  lastUpdated: string;
}

export interface CarClient {
  start(options?: StartOptions): Promise<{ ok: boolean; action: string }>;
  stop(): Promise<{ ok: boolean; action: string }>;
  lock(): Promise<{ ok: boolean; action: string }>;
  unlock(): Promise<{ ok: boolean; action: string }>;
  status(): Promise<CarStatus>;
}

// ─── Stub (used when GENESIS_USERNAME is not set) ────────────────────────────

export class StubCarClient implements CarClient {
  async start(options?: StartOptions) {
    console.log("[StubCarClient] start", options);
    return { ok: true, action: "start", mock: true } as never;
  }

  async stop() {
    console.log("[StubCarClient] stop");
    return { ok: true, action: "stop", mock: true } as never;
  }

  async lock() {
    console.log("[StubCarClient] lock");
    return { ok: true, action: "lock", mock: true } as never;
  }

  async unlock() {
    console.log("[StubCarClient] unlock");
    return { ok: true, action: "unlock", mock: true } as never;
  }

  async status(): Promise<CarStatus> {
    console.log("[StubCarClient] status");
    return {
      running: false,
      remoteStart: false,
      locked: true,
      hood: false,
      trunk: false,
      sunroof: false,
      doors: { frontLeft: false, frontRight: false, rearLeft: false, rearRight: false },
      climate: false,
      defrost: false,
      fuelLevelPercent: 75,
      rangeKm: 400,
      batteryPercent: 75,
      warnings: {
        lowFuel: false,
        tirePressure: false,
        smartKeyBattery: false,
        washerFluid: false,
        brakeOil: false,
        engineOil: false,
      },
      lastUpdated: new Date().toISOString(),
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _client: CarClient | null = null;

/**
 * Returns the module-scoped CarClient singleton.
 * The singleton is created once per warm worker so login/PIN-verify
 * overhead is paid only on cold starts.
 *
 * Uses GenesisCarClient (native Genesis Canada web API) when GENESIS_USERNAME
 * is set; otherwise falls back to StubCarClient for local dev.
 */
export function getCarClient(): CarClient {
  if (!_client) {
    _client = process.env.GENESIS_USERNAME
      ? new GenesisCarClient()
      : new StubCarClient();
  }
  return _client;
}
