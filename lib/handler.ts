import { AuthError, requireBearer } from "./auth.js";
import { error } from "./response.js";

type Handler = (req: Request) => Promise<Response>;

/**
 * Maps an upstream status code to the HTTP status we return to the client.
 * - 429 → 429  (rate limited — include retry time in message)
 * - 4xx → 502  (upstream rejected the request — bad gateway, don't leak details)
 * - 5xx → 503  (upstream server error — service unavailable)
 */
function upstreamErrorResponse(err: unknown): Response | null {
  if (
    err !== null &&
    typeof err === "object" &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  ) {
    const status = (err as { status: number }).status;
    const message = String((err as { message?: unknown }).message ?? "");
    if (status === 429) return error(429, message);
    if (status >= 400 && status < 500) return error(502, "Bad gateway");
    if (status >= 500) return error(503, "Service unavailable");
  }
  return null;
}

/**
 * Wraps a handler with Bearer token authentication.
 * AuthError        → 401
 * Upstream 429     → 429  (rate-limit message forwarded to caller)
 * Upstream 4xx     → 502
 * Upstream 5xx     → 503
 * Any other error  → 500  (message never forwarded to client)
 */
export function withAuth(handler: Handler): Handler {
  return async (req: Request) => {
    try {
      requireBearer(req);
      return await handler(req);
    } catch (err) {
      if (err instanceof AuthError) {
        return error(401, "Unauthorized");
      }
      const upstream = upstreamErrorResponse(err);
      if (upstream) return upstream;
      console.error("[handler] Unexpected error:", err);
      return error(500, "Internal server error");
    }
  };
}

/**
 * Returns a 405 Response if the request method does not match, null otherwise.
 * Call this as the first thing inside a withAuth handler.
 */
export function methodGuard(
  req: Request,
  allowed: "GET" | "POST"
): Response | null {
  if (req.method !== allowed) {
    return new Response(null, {
      status: 405,
      headers: { Allow: allowed },
    });
  }
  return null;
}
