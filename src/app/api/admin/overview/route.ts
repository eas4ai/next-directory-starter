import { canAdmin, canOpenOverview, sessionUser } from "@/lib/admin";
import { overviewData } from "@/lib/overview";

export async function GET(request: Request) {
  const user = await sessionUser(request.headers);
  if (!canOpenOverview(user?.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return Response.json(overviewData(canAdmin(user?.role)));
  } catch (error) {
    console.error("Administration overview unavailable", error);
    return Response.json({ error: "Overview data is unavailable" }, { status: 503 });
  }
}
