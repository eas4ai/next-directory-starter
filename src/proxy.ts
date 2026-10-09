import { NextResponse, type NextRequest } from "next/server";
import { isAdmin } from "@/lib/admin";

export async function proxy(request: NextRequest) {
  if (!(await isAdmin(request.headers))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/admin/theme/:path*" };
