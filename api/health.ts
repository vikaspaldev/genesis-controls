import { adapt } from "../lib/vercel-adapter";
import { json } from "../lib/response";

// No auth — safe for uptime monitors / Google Home routines to probe liveness.
async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  return json(200, { ok: true, ts: new Date().toISOString() });
}

export default adapt(handler);
