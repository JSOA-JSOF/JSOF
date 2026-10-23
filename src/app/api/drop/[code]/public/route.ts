import { getCloudflareContext } from "@opennextjs/cloudflare";

import { dropByCode, dropIsOpen, isThumbKey, thumbKeyFor } from "@/lib/drop/config";
import { readHidden } from "@/lib/drop/visibility";

/**
 * One photograph from the gallery, to anybody with the link.
 *
 * Hidden and closed are both checked here and not only in the listing,
 * because this is the route that hands over the pixels and a key lives on
 * in a page somebody left open.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop || !drop.gallery) return new Response("Not found.", { status: 404 });
  if (!dropIsOpen(drop, new Date())) {
    return new Response("This gallery has closed.", { status: 410 });
  }

  const { env } = getCloudflareContext();
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return new Response("Not found.", { status: 404 });

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  // Only ever a photograph's key. A thumbnail is reached by asking for
  // its photograph with ?thumb=1, so the hide check can never be walked
  // around by naming the small copy directly.
  if (!key.startsWith(`${drop.prefix}/`) || key.includes("..") || isThumbKey(key)) {
    return new Response("Not found.", { status: 404 });
  }

  let hidden: string[];
  try {
    hidden = (await readHidden(bucket, drop)).keys;
  } catch {
    return new Response("Unavailable.", { status: 503 });
  }
  if (hidden.includes(key)) return new Response("Not found.", { status: 404 });

  // The small copy if one was asked for and one exists, the photograph
  // otherwise. Anything uploaded before thumbnails existed falls back
  // rather than showing a gap.
  const wantsThumb = url.searchParams.get("thumb") === "1";
  const object =
    (wantsThumb ? await bucket.get(thumbKeyFor(key)) : null) ??
    (await bucket.get(key));
  if (!object) return new Response("Not found.", { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(object.size),
      // A minute, so taking a photograph down takes effect while somebody
      // is still on the phone about it.
      "Cache-Control": "public, max-age=60",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
