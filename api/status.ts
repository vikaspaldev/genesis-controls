import { getCarClient } from "../lib/car.js";
import { withAuth } from "../lib/handler.js";
import { json } from "../lib/response.js";

export const GET = withAuth(async (_req: Request): Promise<Response> => {
  const result = await getCarClient().status();
  return json(200, result);
});
