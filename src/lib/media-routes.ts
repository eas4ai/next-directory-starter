import { sameOrigin, sessionUser } from "@/lib/admin";
import { readFile } from "node:fs/promises";
import { assignedMedia, ensureUploadPermission, MediaError, mediaErrorResponse, readBoundedImage,
  assignedProfileMedia, mediaFilePath, privateMediaAsset, uploadPrivateImage, uploadProfileMedia,
  type MediaAsset, type MediaKind } from "@/lib/media";

export async function mediaFileResponse(asset: MediaAsset): Promise<Response> {
  try {
    const bytes = await readFile(mediaFilePath(asset.id));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/webp", "Content-Length": String(bytes.length),
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="image.webp"',
    } });
  } catch {
    return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}

export async function uploadMediaRoute(kind: MediaKind, slug: string, request: Request): Promise<Response> {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    ensureUploadPermission(kind, slug, user.id, user.role);
    let alt: string;
    try { alt = decodeURIComponent(request.headers.get("x-image-alt") ?? ""); }
    catch { throw new MediaError(400, "Invalid image alt text"); }
    const bytes = await readBoundedImage(request);
    const asset = await uploadPrivateImage({ kind, slug, actorId: user.id,
      actorRole: user.role, bytes, mimeType: request.headers.get("content-type") ?? "", alt });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    return mediaErrorResponse(error);
  }
}

export async function currentMediaRoute(kind: MediaKind, slug: string, request: Request): Promise<Response> {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const asset = assignedMedia(kind, slug, "draft") ?? assignedMedia(kind, slug, "public");
  if (!asset) return Response.json({ asset: null }, { headers: { "Cache-Control": "no-store" } });
  try {
    return Response.json({ asset: privateMediaAsset(asset.id, user.id, user.role) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mediaErrorResponse(error);
  }
}

function profileMediaTarget(request: Request): { fieldKey: string; itemId: string } {
  const url = new URL(request.url);
  const fieldKey = url.searchParams.get("fieldKey") ?? "";
  const itemId = url.searchParams.get("itemId") ?? "value";
  if (!fieldKey || fieldKey.length > 160 || itemId.length > 120) {
    throw new MediaError(400, "Invalid profile media target");
  }
  return { fieldKey, itemId };
}

export async function uploadProfileMediaRoute(slug: string, request: Request): Promise<Response> {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const { fieldKey, itemId } = profileMediaTarget(request);
    let alt: string;
    try { alt = decodeURIComponent(request.headers.get("x-image-alt") ?? ""); }
    catch { throw new MediaError(400, "Invalid image alt text"); }
    const bytes = await readBoundedImage(request);
    const asset = await uploadProfileMedia({ listingSlug: slug, fieldKey, itemId,
      actorUserId: user.id, actorRole: user.role, bytes,
      mimeType: request.headers.get("content-type") ?? "", alt });
    return Response.json({ asset }, { status: 201 });
  } catch (error) {
    return mediaErrorResponse(error);
  }
}

export async function currentProfileMediaRoute(slug: string, request: Request): Promise<Response> {
  const user = await sessionUser(request.headers);
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const { fieldKey, itemId } = profileMediaTarget(request);
    const asset = assignedProfileMedia(slug, fieldKey, itemId);
    if (!asset) return Response.json({ asset: null }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ asset: privateMediaAsset(asset.id, user.id, user.role) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mediaErrorResponse(error);
  }
}
