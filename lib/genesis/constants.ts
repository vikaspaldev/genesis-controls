/**
 * Configuration constants for the Genesis Canada web-portal client.
 *
 * Values marked "env override" can be tuned without a code change; the defaults
 * mirror the values captured in the working Postman collection so out-of-the-box
 * behavior matches what has been verified against the real service.
 */

export const BASE_URL = "https://www.genesisconnect.ca/tods/api";

/**
 * Base64-encoded browser fingerprint the Genesis web portal requires on every
 * request. Decodes to a Chrome/Edge on macOS UA string plus screen resolution.
 *
 * Env override: `GENESIS_DEVICE_ID`
 */
export const DEVICE_ID =
  process.env.GENESIS_DEVICE_ID ??
  "TW96aWxsYS81LjAgKE1hY2ludG9zaDsgSW50ZWwgTWFjIE9TIFggMTBfMTVfNykgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE1MC4wLjAuMCBTYWZhcmkvNTM3LjM2IEVkZy8xNTAuMC4wLjArTWFjSW50ZWwrMzQ0MCsxNDQw";

/**
 * PIN-verification `pAuth` codes have a short server-side TTL. Cached codes
 * are reused across vehicle operations within this window; requests that opt
 * out of the cache (e.g. remote start/stop) bypass it entirely.
 *
 * Env override: `GENESIS_AUTH_CODE_TTL_MS`  (integer ms; 0 disables caching)
 */
export const AUTH_CODE_TTL_MS = (() => {
  const raw = process.env.GENESIS_AUTH_CODE_TTL_MS;
  if (!raw) return 5 * 60 * 1000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5 * 60 * 1000;
})();
