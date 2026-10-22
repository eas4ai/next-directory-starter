import { auth } from "@/lib/auth";
import { accountMailConfigured } from "@/lib/mail";
import { verificationLinkWasUsed } from "@/lib/email-verification";
import { RequestTooLargeError, requestJsonErrorResponse, requestWithBodyLimit } from "@/lib/request-json";
import { toNextJsHandler } from "better-auth/next-js";

const handler = toNextJsHandler(auth);
const AUTH_REQUEST_MAX_BYTES = 64 * 1024;

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

export async function POST(request: Request) {
  const isEmailSignup = new URL(request.url).pathname.replace(/\/+$/, "").endsWith("/sign-up/email");
  if (isEmailSignup && !accountMailConfigured()) {
    return Response.json({ message: "Signup is temporarily unavailable. Contact the site operator." },
      { status: 503 });
  }
  try {
    const response = await handler.POST(await requestWithBodyLimit(request, AUTH_REQUEST_MAX_BYTES));
    if (isEmailSignup && response.ok) {
      return Response.json({ message: "Check your email for a verification link." });
    }
    return response;
  } catch (error) {
    if (error instanceof RequestTooLargeError) return requestJsonErrorResponse(error);
    throw error;
  }
}
