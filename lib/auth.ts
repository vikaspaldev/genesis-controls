import { createHmac, timingSafeEqual } from "node:crypto";

export class AuthError extends Error {
  readonly statusCode = 401;
  constructor() {
    super("Unauthorized");
  }
}

/**
 * Normalize a string to a fixed-length HMAC-SHA256 buffer so that
 * timingSafeEqual can compare values of arbitrary length without leaking
 * length information via timing differences.
 */
function digest(value: string): Buffer {
  return Buffer.from(
    createHmac("sha256", "genesis-controls-auth-normalizer")
      .update(value)
      .digest()
  );
}

/**
 * Validates the incoming request carries a valid Bearer token.
 * Reads API_SECRET from the environment and does a constant-time comparison.
 * Throws AuthError on mismatch; throws Error if API_SECRET is not configured.
 */
export function requireBearer(req: Request): void {
  const secret = process.env.API_SECRET;
  if (!secret) {
    throw new Error(
      "API_SECRET environment variable is not set. Add it to your Vercel project env vars."
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!timingSafeEqual(digest(token), digest(secret))) {
    throw new AuthError();
  }
}
