import type { IncomingMessage, ServerResponse } from "node:http";

type WebHandler = (req: Request) => Promise<Response>;

/**
 * Adapts a Web API (Request → Response) handler to the Node.js
 * (IncomingMessage, ServerResponse) signature that `vercel dev` uses when the
 * project is not yet linked.  The production Vercel runtime natively supports
 * the Web API format, so this wrapper is a no-op there — Vercel detects the
 * arity of the default export and picks the right calling convention.
 */
export function adapt(
  webHandler: WebHandler
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    const host = nodeReq.headers.host ?? "localhost";
    const url = `http://${host}${nodeReq.url ?? "/"}`;

    const init: RequestInit = {
      method: nodeReq.method ?? "GET",
      headers: nodeReq.headers as Record<string, string>,
    };

    if (!["GET", "HEAD"].includes(nodeReq.method ?? "")) {
      init.body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        nodeReq.on("data", (chunk: Buffer) => chunks.push(chunk));
        nodeReq.on("end", () => resolve(Buffer.concat(chunks)));
        nodeReq.on("error", reject);
      });
    }

    const response = await webHandler(new Request(url, init));

    nodeRes.statusCode = response.status;
    response.headers.forEach((value, key) => nodeRes.setHeader(key, value));

    const body = await response.arrayBuffer();
    nodeRes.end(Buffer.from(body));
  };
}
