import { getCloudflareContext } from "@opennextjs/cloudflare";

import { isBoard } from "@/lib/drop/admin";
import { readApprovals } from "@/lib/drop/approvals";
import { dropByCode } from "@/lib/drop/config";

/**
 * Everything a drop has collected, as JSON.
 *
 * For `scripts/collect-photos.sh`, which walks this and then pulls each
 * object. Paginates, because R2 returns a thousand keys at a time and a
 * well-attended tournament will go past that.
 */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  const { env } = getCloudflareContext();
  // One answer for every way of not being allowed in.
  if (!drop || !(await isBoard(request, env.DROP_ADMIN_KEY))) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return Response.json({ error: "No bucket." }, { status: 503 });

  const objects: {
    key: string;
    size: number;
    uploaded: string;
    credit?: string;
    originalName?: string;
    /** Whether the sender ticked the public-page box. */
    share: boolean;
    /** Whether the board has cleared it for the public page. */
    approved: boolean;
  }[] = [];

  const approvals = await readApprovals(bucket, drop);
  const cleared = new Set(approvals.keys);

  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: `${drop.prefix}/`,
      cursor,
      include: ["customMetadata"],
    });
    for (const object of page.objects) {
      objects.push({
        key: object.key,
        size: object.size,
        uploaded: object.uploaded.toISOString(),
        share: object.customMetadata?.share === "yes",
        approved: cleared.has(object.key),
        ...(object.customMetadata?.credit
          ? { credit: object.customMetadata.credit }
          : {}),
        ...(object.customMetadata?.originalName
          ? { originalName: object.customMetadata.originalName }
          : {}),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const bytes = objects.reduce((total, object) => total + object.size, 0);
  return Response.json({
    event: drop.event,
    heldOn: drop.heldOn,
    count: objects.length,
    bytes,
    objects,
  });
}
