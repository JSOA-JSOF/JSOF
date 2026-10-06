/**
 * The North Carolina Chapter 131F disclosure statement, in one place.
 *
 * It lives in its own module because it is verbatim statutory text that has to
 * appear on a donor-facing page, in an emailed receipt, and on the board's
 * receipt preview. Three copies of a sentence that must be identical is three
 * chances for them to drift, so there is one copy and everything imports it.
 *
 * N.C.G.S. § 131F-9: the statement appears on every printed solicitation,
 * written confirmation, receipt or reminder of a contribution, in at least
 * nine-point type, and is made conspicuous by underlining, a border, or bold.
 *
 * Do not paraphrase. Do not re-wrap the sentences. Do not write "licence" —
 * the statutory word is "license".
 *
 * CONFIRM before launch: the Solicitation Licensing Branch's current published
 * telephone number. The words are fixed by statute; the number is the one part
 * the State has changed before. COUNSEL.
 */

export const NC_131F_DISCLOSURE =
  "Financial information about this organization and a copy of its license are " +
  "available from the State Solicitation Licensing Branch at 888-830-4989. " +
  "The license is not an endorsement by the State.";

export const NC_131F_STATUTE_LABEL = "N.C.G.S. Chapter 131F";

/**
 * The formatting half of the requirement, as data rather than as a note in a
 * stylesheet. Nine points is twelve CSS pixels at 96dpi.
 */
export const NC_131F_TYPE = {
  minPointSize: 9,
  minPixelSize: 12,
  /** What the renderers actually declare. Above the floor, not at it. */
  declaredPointSize: 10,
  declaredPixelSize: 13,
  /** The statute allows underline, border or bold. This uses two of the three. */
  bold: true,
  bordered: true,
} as const;
