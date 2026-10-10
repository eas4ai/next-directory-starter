import { canAdmin, sameOrigin, sessionUser } from "@/lib/admin";
import { brandingErrorResponse, uploadBrandAsset, type BrandAssetSlot } from "@/lib/branding";
import { mediaErrorResponse, readBoundedImage } from "@/lib/media";

export async function POST(request: Request) {
  const user = await sessionUser(request.headers);
  if (!user || !canAdmin(user.role)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const slot = request.headers.get("x-brand-slot");
  if (slot !== "logo" && slot !== "icon" && slot !== "social") {
    return Response.json({ error: "Invalid brand asset slot" }, { status: 400 });
  }
  let bytes: Buffer;
  try { bytes = await readBoundedImage(request); }
  catch (error) { return mediaErrorResponse(error); }
  try {
    const branding = await uploadBrandAsset(slot as BrandAssetSlot, bytes,
      request.headers.get("content-type") ?? "", user.id);
    return Response.json({ branding }, { status: 201 });
  } catch (error) { return brandingErrorResponse(error); }
}
