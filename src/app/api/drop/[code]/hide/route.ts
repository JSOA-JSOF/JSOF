import { getCloudflareContext } from "@opennextjs/cloudflare";

import { isBoard } from "@/lib/drop/admin";
import { dropByCode, isThumbKey } from "@/lib/drop/config";
import { readHidden, writeHidden } from "@/lib/drop/visibility";

/**
 * Take a photograph out of the gallery, or put it back.
 *
 * The gallery shows everything by default, so this is the control that
 * makes that safe. It has to work immediately: somebody asking for their
 * photograph to come off is the request the whole arrangement must be
 * able to honour while they are still on the phone.
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
    hidden?: boolean;
  } | null;
  const key = body?.key ?? "";
  if (!key.startsWith(`${drop.prefix}/`) || key.includes("..") || isThumbKey(key)) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const current = await readHidden(bucket, drop);
  const next = body?.hidden
    ? [...current.keys, key]
    : current.keys.filter((held) => held !== key);

  const saved = await writeHidden(bucket, drop, next);
  return Response.json({ ok: true, hidden: saved.keys.includes(key) });
}
