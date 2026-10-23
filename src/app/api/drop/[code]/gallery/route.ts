import { getCloudflareContext } from "@opennextjs/cloudflare";

import { readApprovals } from "@/lib/drop/approvals";
import { dropByCode } from "@/lib/drop/config";

/**
 * What the public page may show. No key: that is the point of it.
 *
 * It lists the approved objects and nothing else, so a photograph that
 * has not been through both gates is not named here, let alone served.
 * Not even its filename: the original name off somebody's phone is their
 * text, not ours to publish.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop || !drop.publicGallery) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const { env } = getCloudflareContext();
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return Response.json({ event: drop.event, objects: [] });

  const approvals = await readApprovals(bucket, drop);
  const objects: { key: string; credit?: string }[] = [];
  for (const key of approvals.keys) {
    const head = await bucket.head(key);
    // An approval for an object that has since been deleted is stale, and
    // a deleted photograph should disappear from the page without anybody
    // having to tidy the list first.
    if (!head) continue;
    if (head.customMetadata?.share !== "yes") continue;
    objects.push({
      key,
      ...(head.customMetadata?.credit ? { credit: head.customMetadata.credit } : {}),
    });
  }

  return Response.json(
    { event: drop.event, count: objects.length, objects },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
