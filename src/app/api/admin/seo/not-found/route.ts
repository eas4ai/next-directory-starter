import { adminReadResponse } from "@/lib/admin-api";
import { listNotFound } from "@/lib/seo-redirects";

export async function GET(request: Request) {
  return adminReadResponse(request, () => ({ paths: listNotFound() }));
}
