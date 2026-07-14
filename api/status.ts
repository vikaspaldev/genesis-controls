import { getCarClient } from "../lib/car";
import { methodGuard, withAuth } from "../lib/handler";
import { json } from "../lib/response";
import { adapt } from "../lib/vercel-adapter";

export default adapt(withAuth(async (req: Request): Promise<Response> => {
  const guard = methodGuard(req, "GET");
  if (guard) return guard;

  const result = await getCarClient().status();
  return json(200, result);
}));
