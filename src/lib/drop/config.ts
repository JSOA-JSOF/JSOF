/**
 * Event photo drops.
 *
 * One entry per event that collects photographs from the people who were
 * there. The code in the URL is the whole access control, which is a
 * deliberate choice rather than a shortcut:
 *
 *   - Nobody at a golf course is going to make an account. A form that asks
 *     for one collects nothing.
 *   - The page is reached by scanning a code on the signage, so the secret
 *     travels on paper rather than over the network.
 *   - There is nothing behind it to steal. The route only writes.
 *
 * What the code does buy is that a crawler, a scanner sweeping the domain,
 * or somebody who heard the site exists cannot find it, and cannot post to
 * it. `closesAt` then takes it down on its own a few days later, so an open
 * write endpoint does not stay open for a year because nobody remembered.
 *
 * The code is not a password and is not treated as one. It is printed on a
 * sign in public. If it leaks, rotate it here and print a new code.
 */

export type Drop = {
  /** The URL segment. Unguessable, printed on the signage. */
  code: string;
  /** Prefix for every object this drop writes into the bucket. */
  prefix: string;
  /** What the page says it is collecting photographs of. */
  event: string;
  /** Shown under the title. */
  where: string;
  /** Date of the event, for the page and for the object metadata. */
  heldOn: string;
  /** The clip that plays before the uploader. */
  video: string;
  /** Last day the drop accepts anything, inclusive, as YYYY-MM-DD. */
  closesAt: string;
};

export const DROPS: Drop[] = [
  {
    code: "golf26-k7n2xqvp4m",
    prefix: "golf-2026",
    event: "Golf Tournament 2026",
    where: "Fayetteville, North Carolina",
    heldOn: "2026-10-23",
    video: "/media/golf-drop.mp4",
    // Two weeks. Long enough that somebody who gets home and remembers the
    // photographs on Sunday can still send them.
    closesAt: "2026-11-06",
  },
];

export function dropByCode(code: string): Drop | undefined {
  return DROPS.find((drop) => drop.code === code);
}

/** Whether the drop still accepts uploads, as of `now`. */
export function dropIsOpen(drop: Drop, now: Date): boolean {
  // Compared as dates, not instants: "closes on the 6th" means the whole of
  // the 6th, wherever the person uploading happens to be.
  const closes = new Date(`${drop.closesAt}T23:59:59Z`);
  return now.getTime() <= closes.getTime();
}

/** What the bucket will accept. Images only, and only ones browsers show. */
export const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/**
 * Per-file ceiling, after the browser has resized it.
 *
 * The page downscales before it uploads, so anything arriving above this is
 * either a resize that did not run or something that is not a photograph.
 * 20MB leaves room for a large panorama without leaving the door open.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Longest edge the browser resizes to before uploading. */
export const RESIZE_MAX_EDGE = 2560;
