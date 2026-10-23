/**
 * Where event photographs are submitted.
 *
 * Separate from the events data because it is infrastructure, not content:
 * the collector is a standalone Cloudflare Worker with an R2 bucket, built
 * so that a live event does not depend on the rest of this platform, which
 * still has no persistence layer.
 *
 * `href` is null until the bucket exists. A submission link that leads
 * nowhere is worse than a stated absence, especially on a page somebody
 * reached by scanning a code at the event itself.
 */
export const PHOTO_SUBMISSION: {
  href: string | null;
  whyClosed: string;
} = {
  href: null,
  whyClosed: "Opens at the event.",
};
