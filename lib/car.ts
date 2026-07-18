import { GenesisCarClient } from "./genesis/index.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StartOptions {
  /** How many minutes to run the engine (default: 10). */
  durationMinutes?: number;
  /** Target cabin temperature in Celsius. */
  temperature?: number;
}

export interface CarStatus {
  locked: boolean;
  running: boolean;
  odometer?: number;
  fuelLevelPercent?: number;
  batteryVoltage?: number;
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
    return { locked: true, running: false };
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
