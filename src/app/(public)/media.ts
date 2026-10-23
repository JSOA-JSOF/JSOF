/**
 * Every image the public tier is allowed to render.
 *
 * The public tier used to render no image at all, and a test enforced it. That
 * was the simplest way to guarantee no member's face reaches a public page,
 * and it was the right rule while the tier had no photography.
 *
 * The board now wants photographs. A blanket ban cannot survive that, so the
 * guarantee changes shape rather than disappearing: an image may only be
 * rendered through this manifest, every entry records when it was reviewed and
 * what was checked, and `Banner` accepts a key from here rather than an
 * arbitrary path. An unreviewed photograph is a type error, not a judgement
 * call made at the call site.
 *
 * The review is not a formality. Before adding an entry, confirm the image has
 * no identifiable face, no legible unit insignia or patch, no name tape, and
 * nothing that identifies an individual member. See docs/ARCHITECTURE.md and
 * docs/PRIVACY-AND-PAYMENTS.md.
 */

/**
 * What the image actually shows.
 *
 * This field exists because a review note is free text and free text can be
 * vague exactly where it matters. A photograph with recognisable faces is
 * safe when nobody in it is real and unsafe when they are, and that is a fact
 * about the image rather than a judgement, so it is recorded as one.
 *
 * `MEMBERS` is rejected by the public-tier tests. If the board ever wants a
 * real photograph of real people on a public page, that needs signed releases
 * and a decision at board level, not a new manifest entry.
 */
export type Depicts =
  /** No people at all: a building, a plaza, an object, an abstract field. */
  | "NO_PEOPLE"
  /** People, but none identifiable: shot from behind, obscured, distant. */
  | "UNIDENTIFIABLE"
  /** Recognisable faces, of people who do not exist. Stock or generated. */
  | "SYNTHETIC"
  /** Recognisable faces of actual members or their families. Not permitted. */
  | "MEMBERS";

export type PublicImage = {
  src: string;
  /** ISO date the OPSEC review was carried out. */
  reviewed: string;
  depicts: Depicts;
  /**
   * Where to anchor the crop, as a CSS object-position.
   *
   * A banner is a wide band and most source photographs are not that shape,
   * so `cover` throws away a third of the frame. Which third is a property of
   * the image, not of the component, which is why it lives here. Defaults to
   * centre when omitted.
   */
  focus?: string;
  /** What was checked, in one line. Not alt text. */
  note: string;
};

export const PUBLIC_IMAGES = {
  "association-hero": {
    src: "/media/door-association.webp",
    reviewed: "2026-10-19",
    depicts: "UNIDENTIFIABLE",
    note:
      "Every figure is shot from behind and helmeted. No faces, no legible " +
      "unit insignia, no name tapes.",
  },
  crest: {
    src: "/media/crest-v2.webp",
    reviewed: "2026-10-20",
    depicts: "NO_PEOPLE",
    note: "The association crest. An emblem, with no people in it at all.",
  },
  "event-ball": {
    src: "/media/event-ball.webp",
    reviewed: "2026-10-23",
    depicts: "SYNTHETIC",
    // The place setting is the subject; the figures are behind it.
    focus: "center 55%",
    note:
      "A place setting in a ballroom, with figures in formal and service " +
      "dress behind it. Classified SYNTHETIC on the generated-image markers " +
      "in the frame: nobody in it exists. If these are real people the " +
      "entry is wrong and it must come down.",
  },
  "event-golf": {
    src: "/media/event-golf.webp",
    reviewed: "2026-10-23",
    depicts: "UNIDENTIFIABLE",
    // The crest is on the ball, which is the point of the shot.
    focus: "center 45%",
    note:
      "A gloved hand placing a ball on a tee. No face, no name tape, no " +
      "unit insignia, and nothing that identifies the person holding it.",
  },
  "foundation-hero": {
    src: "/media/door-foundation.webp",
    reviewed: "2026-10-20",
    depicts: "SYNTHETIC",
    // The faces sit high in the frame; centring the crop decapitates them.
    focus: "center 28%",
    note:
      "Recognisable faces, including two children, of people who do not " +
      "exist. Classified SYNTHETIC on the generated-image markers in the " +
      "frame rather than on a release. If this is a real family, the entry " +
      "is wrong and the image must come down: see the note below.",
  },
} as const satisfies Record<string, PublicImage>;

export type PublicImageKey = keyof typeof PUBLIC_IMAGES;

/**
 * On `foundation-hero`, recorded here rather than lost in a commit message.
 *
 * It is the first entry with recognisable faces, and it was classified from
 * the image itself, not from a provenance record anybody holds. Two things
 * follow that the board should decide rather than inherit:
 *
 *   1. If the photograph turns out to depict real people, it is `MEMBERS`,
 *      the test fails, and it comes down until there are signed releases.
 *      Two of the faces are children, which engages the guardian consent
 *      rules in docs/PRIVACY-AND-PAYMENTS.md on top of everything else.
 *
 *   2. Even synthetic, a graduate-and-family photograph on the Foundation's
 *      page reads as "here is a scholarship recipient", on a page that
 *      promises never to identify one. That is a tension in the editorial
 *      line rather than a breach, and it is the board's call.
 */

/**
 * Read an entry as a `PublicImage`.
 *
 * `PUBLIC_IMAGES` is `as const satisfies`, which keeps each entry's literal
 * type exact. That is what makes an unreviewed image a type error, and it is
 * worth keeping. The cost is that an entry which omits an optional field does
 * not have that property at all, so reading `.focus` straight off the union
 * fails to compile for the entries that never declared one.
 *
 * This accessor widens a single entry to the declared shape, where the
 * optional fields exist and are simply undefined. Call it rather than
 * indexing the object when you need an optional field.
 */
export function publicImage(key: PublicImageKey): PublicImage {
  return PUBLIC_IMAGES[key];
}
