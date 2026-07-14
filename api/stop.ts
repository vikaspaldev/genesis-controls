import { getCarClient } from "../lib/car";
import { methodGuard, withAuth } from "../lib/handler";
import { json } from "../lib/response";

export default withAuth(async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, "POST");
  if (guard) return guard;

  const result = await getCarClient().stop();
  return json(200, result);
});
