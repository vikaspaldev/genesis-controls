/**
 * Errors thrown by the Genesis Canada web-portal client. All extend the built-in
 * `Error` so consumers can `instanceof`-narrow to react selectively.
 */

/** Missing / invalid configuration (env vars). Non-recoverable at runtime. */
export class GenesisConfigError extends Error {
  override readonly name = "GenesisConfigError";
}

/** Login or PIN verification returned a response we can't authenticate against. */
export class GenesisAuthError extends Error {
  override readonly name = "GenesisAuthError";
}

/** HTTP call to the Genesis portal returned a non-2xx response. */
export class GenesisApiError extends Error {
  override readonly name = "GenesisApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}
