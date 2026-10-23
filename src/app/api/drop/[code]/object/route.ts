import { getCloudflareContext } from "@opennextjs/cloudflare";

import { isBoard } from "@/lib/drop/admin";
import { dropByCode } from "@/lib/drop/config";

/** One photograph, for the board. `?key=` comes from the manifest. */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const drop = dropByCode(code);
  const { env } = getCloudflareContext();
  if (!drop || !(await isBoard(request, env.DROP_ADMIN_KEY))) {
    return new Response("Not found.", { status: 404 });
  }
  const bucket = env.EVENT_PHOTOS;
  if (!bucket) return new Response("No bucket.", { status: 503 });

  const key = new URL(request.url).searchParams.get("key") ?? "";
  // The key has to be one of this drop's own. Without this check the board
  // key reads the whole bucket through whichever drop happens to be open.
  if (!key.startsWith(`${drop.prefix}/`) || key.includes("..")) {
    return new Response("Not found.", { status: 404 });
  }

  const object = await bucket.get(key);
  if (!object) return new Response("Not found.", { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Length": String(object.size),
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
