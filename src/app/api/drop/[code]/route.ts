import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  ACCEPTED_TYPES,
  MAX_FILE_BYTES,
  dropByCode,
  dropIsOpen,
} from "@/lib/drop/config";

/**
 * Receives one photograph and writes it to the bucket.
 *
 * One file per request rather than a batch. A phone on course wifi drops
 * connections, and a batch that fails at file nine loses the first eight;
 * one at a time means a retry costs one photograph.
 *
 * Nothing is read back out through this route, and nothing an attendee
 * sends appears anywhere on the site. That is the promise the page makes,
 * and this is the half of it that has to be true in code: this file has no
 * GET, and the two routes that do read are behind a key the board holds
 * and the sign does not carry. See ./manifest and ./object.
 */

export const dynamic = "force-dynamic";

function fail(status: number, error: string) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  // Same answer for a wrong code and a closed drop as for a missing route:
  // an endpoint that says "that code is wrong" is an endpoint that can be
  // guessed at.
  if (!drop) return fail(404, "Not found.");
  if (!dropIsOpen(drop, new Date())) {
    return fail(410, "This drop has closed. Write to connect@thejsoa.org.");
  }

  const { env } = getCloudflareContext();
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return fail(503, "Uploads are not switched on yet.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "That upload did not arrive in one piece. Try again.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "No file in that request.");
  if (file.size === 0) return fail(400, "That file was empty.");
  if (file.size > MAX_FILE_BYTES) return fail(413, "That photo is too large.");

  const type = file.type.toLowerCase();
  if (!(ACCEPTED_TYPES as readonly string[]).includes(type)) {
    return fail(415, "Photographs only, please.");
  }

  // Optional, and genuinely optional: the page does not require it and the
  // upload does not fail without it. It exists so the board can credit a
  // photograph, not so we know who was there.
  const credit = (form.get("credit") ?? "").toString().slice(0, 80).trim();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const unique = crypto.randomUUID().slice(0, 8);
  const extension = type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = `${drop.prefix}/${stamp}-${unique}.${extension}`;

  try {
    await bucket.put(key, file.stream(), {
      httpMetadata: { contentType: type },
      customMetadata: {
        event: drop.event,
        heldOn: drop.heldOn,
        originalName: file.name.slice(0, 120),
        ...(credit ? { credit } : {}),
      },
    });
  } catch {
    return fail(502, "That did not save. Try it again.");
  }

  return Response.json({ ok: true, key });
}
