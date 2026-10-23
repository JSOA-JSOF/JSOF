import { getCloudflareContext } from "@opennextjs/cloudflare";

import { isBoard } from "@/lib/drop/admin";
import { readApprovals, writeApprovals } from "@/lib/drop/approvals";
import { dropByCode } from "@/lib/drop/config";

/**
 * Clear a photograph for the public page, or take it back down.
 *
 * Taking it down has to work as well as putting it up, and has to work
 * immediately: somebody asking for their photograph to come off a public
 * page is the request this whole arrangement has to be able to honour.
 */

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  const { env } = getCloudflareContext();
  if (!drop || !(await isBoard(request, env.DROP_ADMIN_KEY))) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return Response.json({ error: "No bucket." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as {
    key?: string;
    approved?: boolean;
  } | null;
  const key = body?.key ?? "";
  if (!key.startsWith(`${drop.prefix}/`) || key.includes("..")) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const object = await bucket.head(key);
  if (!object) return Response.json({ error: "Not found." }, { status: 404 });

  // The board cannot publish what the sender did not offer. Both gates, in
  // that order, and this is the one that cannot be clicked past.
  if (body?.approved && object.customMetadata?.share !== "yes") {
    return Response.json(
      { error: "The sender did not agree to this one being shown." },
      { status: 409 },
    );
  }

  const current = await readApprovals(bucket, drop);
  const next = body?.approved
    ? [...current.keys, key]
    : current.keys.filter((held) => held !== key);

  const saved = await writeApprovals(bucket, drop, next);
  return Response.json({ ok: true, approved: saved.keys.includes(key) });
}
