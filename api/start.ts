import { getCarClient } from "../lib/car.js";
import { withAuth } from "../lib/handler.js";
import { json } from "../lib/response.js";

export const POST = withAuth(async (_req: Request): Promise<Response> => {
  const result = await getCarClient().start();
  return json(200, result);
});
