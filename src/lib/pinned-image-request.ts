import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

// The caller validates every resolved address before this pinned request.
export function requestPinnedImage(url: URL, pinned: { address: string; family: number }): Promise<Buffer | null> {
  return new Promise((resolveImage) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET", family: pinned.family,
      headers: { Accept: "image/png,image/jpeg,image/webp,image/avif" },
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      if (response.statusCode !== 200 ||
          !/^image\/(?:png|jpeg|webp|avif)(?:;|$)/i.test(response.headers["content-type"] ?? "") ||
          Number(response.headers["content-length"] ?? 0) > MAX_SOURCE_BYTES) {
        response.destroy(); resolveImage(null); return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_SOURCE_BYTES) { response.destroy(); resolveImage(null); }
        else chunks.push(chunk);
      });
      response.on("end", () => resolveImage(Buffer.concat(chunks)));
      response.on("error", () => resolveImage(null));
    });
    const deadline = setTimeout(() => request.destroy(), 5000);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", () => resolveImage(null));
    request.end();
  });
}
