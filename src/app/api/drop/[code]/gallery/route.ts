import { getCloudflareContext } from "@opennextjs/cloudflare";

import { dropByCode, dropIsOpen, isThumbKey } from "@/lib/drop/config";
import { readHidden } from "@/lib/drop/visibility";

/**
 * What the gallery shows. No key: that is the point of it.
 *
 * Newest first, because the person refreshing this page thirty seconds
 * after pressing send is looking for their own photographs and should
 * not have to scroll past everyone else's to find them.
 *
 * It closes with the drop. After that the route says so rather than
 * serving the photographs to anyone who kept the link.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop || !drop.gallery) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (!dropIsOpen(drop, new Date())) {
    return Response.json(
      { event: drop.event, closed: true, count: 0, objects: [] },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  }

  const { env } = getCloudflareContext();
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return Response.json({ event: drop.event, count: 0, objects: [] });

  let hidden: Set<string>;
  try {
    hidden = new Set((await readHidden(bucket, drop)).keys);
  } catch {
    // Cannot tell what was taken down, so show nothing. Failing closed is
    // the only safe direction for a list whose job is to withhold.
    return Response.json({ error: "Unavailable." }, { status: 503 });
  }

  const objects: { key: string; credit?: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: `${drop.prefix}/`,
      cursor,
      include: ["customMetadata"],
    });
    for (const object of page.objects) {
      // Thumbnails live under the same prefix and are not photographs.
      if (isThumbKey(object.key)) continue;
      if (hidden.has(object.key)) continue;
      objects.push({
        key: object.key,
        ...(object.customMetadata?.credit
          ? { credit: object.customMetadata.credit }
          : {}),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  // The keys begin with the upload time, so sorting them sorts by when
  // they arrived without having to carry the date through.
  objects.sort((a, b) => b.key.localeCompare(a.key));

  return Response.json(
    { event: drop.event, count: objects.length, objects },
    // Short, because somebody is refreshing this to see their own
    // photograph appear.
    { headers: { "Cache-Control": "public, max-age=10" } },
  );
}
