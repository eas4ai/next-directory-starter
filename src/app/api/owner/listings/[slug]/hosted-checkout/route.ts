import { sameOrigin, sessionUser } from "@/lib/admin";
import { checkoutErrorResponse } from "@/lib/checkout";
import { createHostedCheckout } from "@/lib/hosted-checkout";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let value: unknown;
  try { value = await requestJson(request, 1024); }
  catch (error) { return requestJsonErrorResponse(error); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Response.json({ error: "Invalid checkout request" }, { status: 400 });
  }
  const input = value as Record<string, unknown>;
  if (typeof input.planKey !== "string" || typeof input.offerToken !== "string" ||
      typeof input.requestId !== "string" ||
      (input.provider !== "stripe" && input.provider !== "paddle" && input.provider !== "nowpayments")) {
    return Response.json({ error: "Invalid checkout request" }, { status: 400 });
  }
  const { slug } = await params;
  try {
    return Response.json(await createHostedCheckout(user.id, slug, {
      planKey: input.planKey, offerToken: input.offerToken,
      requestId: input.requestId, provider: input.provider,
    }));
  } catch (error) {
    return checkoutErrorResponse(error);
  }
}
