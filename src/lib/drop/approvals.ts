import type { Drop } from "./config";

/**
 * Which photographs may be shown in public.
 *
 * Two gates, and a photograph needs both.
 *
 * The first is the sender's. A tick box in the tray, off by default, and
 * recorded on the object as `share`. Nobody's photograph goes on a public
 * page because they did not read a sentence.
 *
 * The second is the board's. Somebody with the drop key marks a
 * photograph approved and only then does it appear. The code that opens
 * the uploader is printed on a sign at a public golf course, so anyone who
 * walks past can send anything: a public page with no human between the
 * upload and the world is a public page somebody will eventually abuse.
 *
 * The approvals live in the bucket as one small JSON file, outside the
 * drop's own prefix so it never turns up in the manifest. One file written
 * whole, which is the right shape for this: approving is something one
 * person does from one page, and a lost write costs a second click rather
 * than a photograph.
 */

export type Approvals = {
  /** Object keys cleared for the public page. */
  keys: string[];
  updated: string;
};

export function approvalsKey(drop: Drop): string {
  return `_approvals/${drop.prefix}.json`;
}

export async function readApprovals(
  bucket: R2Bucket,
  drop: Drop,
): Promise<Approvals> {
  const object = await bucket.get(approvalsKey(drop));
  if (!object) return { keys: [], updated: "" };
  try {
    const parsed = (await object.json()) as Partial<Approvals>;
    const keys = Array.isArray(parsed.keys) ? parsed.keys : [];
    // Only ever this drop's own objects, whatever the file says. The list
    // is data in a bucket, and it decides what gets served without a key.
    return {
      keys: keys.filter(
        (key): key is string =>
          typeof key === "string" && key.startsWith(`${drop.prefix}/`),
      ),
      updated: typeof parsed.updated === "string" ? parsed.updated : "",
    };
  } catch {
    return { keys: [], updated: "" };
  }
}

export async function writeApprovals(
  bucket: R2Bucket,
  drop: Drop,
  keys: string[],
): Promise<Approvals> {
  const unique = [...new Set(keys)].filter((key) =>
    key.startsWith(`${drop.prefix}/`),
  );
  const next: Approvals = { keys: unique, updated: new Date().toISOString() };
  await bucket.put(approvalsKey(drop), JSON.stringify(next), {
    httpMetadata: { contentType: "application/json" },
  });
  return next;
}
