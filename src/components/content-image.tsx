import Image from "next/image";
import type { MediaAsset } from "@/lib/media";

export function ContentImage({ asset, privateView = false }: {
  asset: MediaAsset; privateView?: boolean;
}) {
  return <Image unoptimized src={`${privateView ? "/api" : ""}/media/${asset.id}`}
    alt={asset.alt} width={asset.width} height={asset.height}
    className="max-h-96 w-auto max-w-full rounded-lg border object-contain" />;
}
