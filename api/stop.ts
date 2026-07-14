import { getCarClient } from "../lib/car.js";
import { methodGuard, withAuth } from "../lib/handler.js";
import { json } from "../lib/response.js";

export default withAuth(async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, "POST");
  if (guard) return guard;

  const result = await getCarClient().stop();
  return json(200, result);
});
