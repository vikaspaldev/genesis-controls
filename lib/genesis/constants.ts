/**
 * Configuration constants for the Genesis Canada web-portal client.
 *
 * Values marked "env override" can be tuned without a code change; the defaults
 * mirror the values captured in the working Postman collection so out-of-the-box
 * behavior matches what has been verified against the real service.
 */

/** Env override: `GENESIS_BASE_URL` */
export const BASE_URL =
  process.env.GENESIS_BASE_URL ?? "https://www.genesisconnect.ca/tods/api";

/** Derived from BASE_URL — used for Origin / Referer headers. */
export const ORIGIN = new URL(BASE_URL).origin;

/**
 * The UA string embedded in DEVICE_ID, used as the actual HTTP User-Agent.
 * Cloudflare blocks requests without a recognisable browser UA.
 *
 * Env override: `GENESIS_USER_AGENT`
 */
export const USER_AGENT =
  process.env.GENESIS_USER_AGENT ??
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";

/**
 * Static browser security headers required by Cloudflare to pass bot detection.
 * Values mirror the working browser session captured in curl.
 */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  DNT: "1",
  Priority: "u=1, i",
  "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Microsoft Edge";v="150"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  Origin: ORIGIN,
};

/**
 * Base64-encoded browser fingerprint sent as the `Deviceid` header.
 * Required — must be set via `GENESIS_DEVICE_ID` env var.
 * Decodes to a browser UA string + screen resolution used by the web portal.
 */
export const DEVICE_ID: string | undefined = process.env.GENESIS_DEVICE_ID;

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
