export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function error(status: number, message: string): Response {
  return json(status, { ok: false, error: message });
}
