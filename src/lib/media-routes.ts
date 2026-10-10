import { sameOrigin, sessionUser } from "@/lib/admin";
import { ensureUploadPermission, MediaError, mediaErrorResponse, readBoundedImage,
  uploadPrivateImage, type MediaKind } from "@/lib/media";

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
