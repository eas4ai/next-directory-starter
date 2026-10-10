import { auth } from "@/lib/auth";
import { accountMailConfigured } from "@/lib/mail";
import { verificationLinkWasUsed } from "@/lib/email-verification";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);

export function GET(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.replace(/\/+$/, "").endsWith("/verify-email")) {
    const token = url.searchParams.get("token");
    if (token && verificationLinkWasUsed(token)) {
      return Response.json({ message: "Verification link already used." }, { status: 409 });
    }
  }
  return handler.GET(request);
}

export function POST(request: Request) {
  if (new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/sign-up/email") &&
      !accountMailConfigured()) {
    return Response.json({ message: "Signup is temporarily unavailable. Contact the site operator." },
      { status: 503 });
  }
  return handler.POST(request);
}
