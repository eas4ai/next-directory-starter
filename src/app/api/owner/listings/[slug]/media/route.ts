import { currentMediaRoute, uploadMediaRoute } from "@/lib/media-routes";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  return uploadMediaRoute("listing", (await params).slug, request);
}

export async function GET(request: Request, { params }: Params) {
  return currentMediaRoute("listing", (await params).slug, request);
}
