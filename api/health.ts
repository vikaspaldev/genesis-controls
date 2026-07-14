import { json } from "../lib/response.js";

// No auth — safe for uptime monitors / Google Home routines to probe liveness.
export async function GET(_req: Request): Promise<Response> {
  return json(200, { ok: true, ts: new Date().toISOString() });
}
