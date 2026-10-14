import { currentProfileMediaRoute, uploadProfileMediaRoute } from "@/lib/media-routes";

type Params = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Params) {
  return uploadProfileMediaRoute((await params).slug, request);
}

export async function GET(request: Request, { params }: Params) {
  return currentProfileMediaRoute((await params).slug, request);
}
