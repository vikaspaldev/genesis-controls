import { AuthError, requireBearer } from "./auth.js";
import { error } from "./response.js";

type Handler = (req: Request) => Promise<Response>;

/**
 * Wraps a handler with Bearer token authentication.
 * AuthError  → 401
 * Any other error → 500 (message is never forwarded to the client)
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
