import { getCloudflareContext } from "@opennextjs/cloudflare";

import { readApprovals } from "@/lib/drop/approvals";
import { dropByCode } from "@/lib/drop/config";

/**
 * One approved photograph, to anybody.
 *
 * Both gates are checked here and not only in the listing, because this
 * is the route that actually hands over the pixels and a key could be
 * guessed from a page somebody had open an hour ago. An approval that has
 * been withdrawn stops serving within the minute.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop || !drop.publicGallery) return new Response("Not found.", { status: 404 });

  const { env } = getCloudflareContext();
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return new Response("Not found.", { status: 404 });

  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key.startsWith(`${drop.prefix}/`) || key.includes("..")) {
    return new Response("Not found.", { status: 404 });
  }

  const approvals = await readApprovals(bucket, drop);
  if (!approvals.keys.includes(key)) return new Response("Not found.", { status: 404 });

  const object = await bucket.get(key);
  if (!object) return new Response("Not found.", { status: 404 });
  if (object.customMetadata?.share !== "yes") {
    return new Response("Not found.", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(object.size),
      // A minute, so withdrawing an approval takes effect while somebody
      // is still on the phone about it.
      "Cache-Control": "public, max-age=60",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
