import Stripe from "stripe";
import { sameOrigin, sessionUser } from "@/lib/admin";
import { checkoutErrorResponse, createPublishingCheckout } from "@/lib/checkout";
import { requestJson, requestJsonErrorResponse } from "@/lib/request-json";
import { ownerListing } from "@/lib/moderation";
import { billingProfileErrorResponse, stripeCheckoutConfiguration } from "@/lib/billing-profiles";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const { slug } = await params;
  try {
    if (ownerListing(user.id, slug).listing.status !== "published") {
      return Response.json({ error: "Approved owned listing not found" }, { status: 404 });
    }
  } catch {
    return Response.json({ error: "Approved owned listing not found" }, { status: 404 });
  }
  let configuration;
  try { configuration = stripeCheckoutConfiguration(); }
  catch (error) { return billingProfileErrorResponse(error); }
  if (!configuration) return Response.json({ error: "Stripe is not configured for this mode" }, { status: 503 });
  let input: unknown;
  try { input = await requestJson(request, 1024); }
  catch (error) { return requestJsonErrorResponse(error); }
  const planKey = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).planKey : undefined;
  const requestId = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).requestId : undefined;
  const offerToken = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).offerToken : undefined;
  if (typeof planKey !== "string") return Response.json({ error: "Choose a plan" }, { status: 400 });
  if (typeof requestId !== "string") return Response.json({ error: "Invalid checkout request" }, { status: 400 });
  if (typeof offerToken !== "string") return Response.json({ error: "Invalid plan terms" }, { status: 400 });
  const stripe = new Stripe(configuration.apiKey);
  try {
    const checkout = await createPublishingCheckout(user.id, slug, planKey, offerToken, requestId,
      (settings, options) => stripe.checkout.sessions.create(settings, options));
    return Response.json(checkout);
  } catch (error) {
    return checkoutErrorResponse(error);
  }
}
