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

// ─── Stub (active until bluelinky is wired up) ───────────────────────────────

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
 * The singleton is created once per warm worker, so the real client's
 * login/session overhead is paid only on cold starts.
 *
 * HOW TO SWAP IN GENESIS (when you're ready):
 *
 *   1. pnpm add bluelinky
 *   2. Create a BluelinkyCarClient class that wraps BlueLinky:
 *        const client = new BlueLinky({
 *          username: process.env.GENESIS_USERNAME,
 *          password: process.env.GENESIS_PASSWORD,
 *          pin:      process.env.GENESIS_PIN,
 *          brand:    'hyundai',   // Genesis Canada uses the HMG/Hyundai backend
 *          region:   'CA',
 *        });
 *   3. Await the 'ready' event and store the BlueLinky vehicle reference.
 *   4. Add GENESIS_* vars to your Vercel project environment variables.
 *   5. Replace `new StubCarClient()` below with `new BluelinkyCarClient()`.
 *      None of the api/ endpoint files need to change.
 */
export function getCarClient(): CarClient {
  if (!_client) {
    _client = new StubCarClient();
  }
  return _client;
}
