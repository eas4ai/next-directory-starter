import { headers } from "next/headers";
import { canManageCatalog, sessionUser } from "@/lib/admin";
import { directoryCategories } from "@/lib/listings";

export async function GET() {
  const user = await sessionUser(await headers());
  if (!user || !canManageCatalog(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ categories: directoryCategories() }, { headers: { "Cache-Control": "no-store" } });
}
