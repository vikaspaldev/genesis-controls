import { BlueLinky } from "bluelinky";
import type { Vehicle } from "bluelinky/dist/vehicles/vehicle.js";
import type { VehicleStatus as BlueLinkStatus } from "bluelinky/dist/interfaces/common.interfaces.js";

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

// ─── Bluelinky (live) ─────────────────────────────────────────────────────────

class BluelinkyCarClient implements CarClient {
  private readonly vehiclePromise: Promise<Vehicle>;

  constructor() {
    this.vehiclePromise = this.#connect();
  }

  #connect(): Promise<Vehicle> {
    return new Promise((resolve, reject) => {
      const bluelinky = new BlueLinky({
        username: process.env.GENESIS_USERNAME!,
        password: process.env.GENESIS_PASSWORD!,
        pin: process.env.GENESIS_PIN!,
        brand: "hyundai", // Genesis Canada runs on the HMG/Hyundai backend
        region: "CA",
      });

      bluelinky.on("ready", (vehicles: Vehicle[]) => {
        const vin = process.env.GENESIS_VIN;
        const vehicle = vin
          ? (vehicles.find((v) => v.vin() === vin) ?? vehicles[0])
          : vehicles[0];
        vehicle
          ? resolve(vehicle)
          : reject(new Error("No vehicles found on account"));
      });

      bluelinky.on("error", (err: Error) => reject(err));
    });
  }

  async start(options?: StartOptions) {
    const vehicle = await this.vehiclePromise;
    await vehicle.start({
      hvac: true,
      duration: options?.durationMinutes ?? 10,
      temperature: options?.temperature ?? 22,
      defrost: false,
      heatedFeatures: 0,
      unit: "C",
    });
    return { ok: true, action: "start" };
  }

  async stop() {
    const vehicle = await this.vehiclePromise;
    await vehicle.stop();
    return { ok: true, action: "stop" };
  }

  async lock() {
    const vehicle = await this.vehiclePromise;
    await vehicle.lock();
    return { ok: true, action: "lock" };
  }

  async unlock() {
    const vehicle = await this.vehiclePromise;
    await vehicle.unlock();
    return { ok: true, action: "unlock" };
  }

  async status(): Promise<CarStatus> {
    const vehicle = await this.vehiclePromise;
    const [raw, odo] = await Promise.all([
      vehicle.status({ refresh: true, parsed: true }),
      vehicle.odometer(),
    ]);
    const s = raw as BlueLinkStatus | null;
    return {
      locked: s?.chassis?.locked ?? false,
      running: s?.engine?.ignition ?? false,
      odometer: odo?.value,
      batteryVoltage: s?.engine?.batteryCharge12v,
    };
  }
}

// ─── Stub (active when GENESIS_* env vars are absent) ────────────────────────

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
 * Automatically uses BluelinkyCarClient when GENESIS_USERNAME is set,
 * otherwise falls back to StubCarClient for local dev without credentials.
 */
export function getCarClient(): CarClient {
  if (!_client) {
    _client = process.env.GENESIS_USERNAME
      ? new BluelinkyCarClient()
      : new StubCarClient();
  }
  return _client;
}
