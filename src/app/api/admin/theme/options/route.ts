import { isAdmin } from "@/lib/admin";
import { themeOptions } from "@/lib/theme";

export async function GET(request: Request) {
  if (!(await isAdmin(request.headers))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json(themeOptions);
}
