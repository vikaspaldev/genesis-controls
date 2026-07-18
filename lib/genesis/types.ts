/**
 * Response type shapes for the Genesis Canada web-portal endpoints.
 *
 * Only the fields we consume are typed — the portal returns much more, but
 * declaring the full surface would just create maintenance burden. All fields
 * are optional because the portal has been observed to change shape between
 * releases; the client validates presence at parse time and throws
 * `GenesisAuthError` / `GenesisApiError` on missing data.
 */

export interface LoginResponse {
  result?: {
    token?: {
      accessToken?: string;
      refreshToken?: string;
      /** Lifetime of the access token in **seconds** (e.g. 86400 = 24 h). */
      expireIn?: number;
      tokenType?: string;
      scope?: string[];
    };
  };
}

export interface VerifyPinResponse {
  result?: {
    pAuth?: string;
  };
}

export interface MyVehicleResponse {
  result?: {
    vehicles?: Array<{ vehicleId?: string; nickName?: string }>;
    /** Some payloads return a flat `vehicleId` — tolerate both shapes. */
    vehicleId?: string;
  };
}

export interface VehicleStatusResponse {
  result?: {
    status?: {
      lastStatusDate?: string;
      engine?: boolean;
      remoteIgnition?: boolean;
      doorLock?: boolean;
      doorOpen?: {
        frontLeft?: number;
        frontRight?: number;
        backLeft?: number;
        backRight?: number;
      };
      hoodOpen?: boolean;
      trunkOpen?: boolean;
      sunroofOpen?: boolean;
      airCtrlOn?: boolean;
      defrost?: boolean;
      fuelLevel?: number;
      dte?: { value?: number; unit?: number };
      battery?: { batSoc?: number };
      lowFuelLight?: boolean;
      tirePressureLamp?: { tirePressureLampAll?: number };
      smartKeyBatteryWarning?: boolean;
      washerFluidStatus?: boolean;
      /** Note: Genesis API uses "break" (sic) instead of "brake". */
      breakOilStatus?: boolean;
      engineOilStatus?: boolean;
    };
  };
}
