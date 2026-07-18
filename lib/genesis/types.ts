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
