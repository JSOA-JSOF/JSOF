import type { Drop } from "./config";

/**
 * Which photographs the gallery does not show.
 *
 * A hide list, not an approve list, and the difference is the whole
 * point of the gallery.
 *
 * It was built the other way first: the sender ticked a box, the board
 * approved, and only then did a photograph appear. That is the right
 * shape for publishing something, and the wrong shape for this. The
 * gallery exists so that somebody who has just sent six photographs from
 * a phone can see that the six arrived. Most of the people at this event
 * are not young, and "it says sent" is a weaker reassurance than seeing
 * the photograph. Behind two gates they would see nothing, press send
 * again, and send everything twice.
 *
 * So everything shows, and the board can take any of it down. That keeps
 * a human between an upload and the gallery without putting the human in
 * front of the confirmation. It is defensible because the gallery is not
 * publication: it is at an unlisted address nobody reaches except by
 * scanning the code on the sign, it is noindex, and it closes with the
 * drop. See the copy on the page, which says exactly that and does not
 * promise more.
 */

export type Hidden = {
  /** Object keys the board has taken out of the gallery. */
  keys: string[];
  updated: string;
};

export function hiddenKey(drop: Drop): string {
  return `_hidden/${drop.prefix}.json`;
}

export async function readHidden(bucket: R2Bucket, drop: Drop): Promise<Hidden> {
  const object = await bucket.get(hiddenKey(drop));
  if (!object) return { keys: [], updated: "" };
  try {
    const parsed = (await object.json()) as Partial<Hidden>;
    const keys = Array.isArray(parsed.keys) ? parsed.keys : [];
    return {
      keys: keys.filter(
        (key): key is string =>
          typeof key === "string" && key.startsWith(`${drop.prefix}/`),
      ),
      updated: typeof parsed.updated === "string" ? parsed.updated : "",
    };
  } catch {
    // An unreadable hide list must not quietly show what was hidden. The
    // callers treat a throw as "show nothing" rather than "show all".
    throw new Error("the hide list could not be read");
  }
}

export async function writeHidden(
  bucket: R2Bucket,
  drop: Drop,
  keys: string[],
): Promise<Hidden> {
  const unique = [...new Set(keys)].filter((key) =>
    key.startsWith(`${drop.prefix}/`),
  );
  const next: Hidden = { keys: unique, updated: new Date().toISOString() };
  await bucket.put(hiddenKey(drop), JSON.stringify(next), {
    httpMetadata: { contentType: "application/json" },
  });
  return next;
}
