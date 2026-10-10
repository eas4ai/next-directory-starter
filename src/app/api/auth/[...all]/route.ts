import { auth } from "@/lib/auth";
import { accountMailConfigured } from "@/lib/mail";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);
export const GET = handler.GET;

export function POST(request: Request) {
  if (new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/sign-up/email") &&
      !accountMailConfigured()) {
    return Response.json({ message: "Signup is temporarily unavailable. Contact the site operator." },
      { status: 503 });
  }
  return handler.POST(request);
}
