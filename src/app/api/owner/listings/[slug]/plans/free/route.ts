import { sameOrigin, sessionUser } from "@/lib/admin";
import { acceptFreePlan, checkoutErrorResponse } from "@/lib/checkout";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  let input: unknown;
  try { input = await requestJson(request, 1024); }
  catch (error) { return requestJsonErrorResponse(error); }
  const planKey = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).planKey : undefined;
  const offerToken = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).offerToken : undefined;
  if (typeof planKey !== "string") return Response.json({ error: "Choose a plan" }, { status: 400 });
  if (typeof offerToken !== "string") return Response.json({ error: "Invalid plan terms" }, { status: 400 });
  const { slug } = await params;
  try {
    return Response.json(acceptFreePlan(user.id, slug, planKey, offerToken));
  } catch (error) {
    return checkoutErrorResponse(error);
  }
}
