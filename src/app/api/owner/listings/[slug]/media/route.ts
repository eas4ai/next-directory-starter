import { uploadMediaRoute } from "@/lib/media-routes";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  return uploadMediaRoute("listing", (await params).slug, request);
}
