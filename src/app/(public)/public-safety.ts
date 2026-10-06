/**
 * The public tier's own guard rails, expressed as data so a test can hold them.
 *
 * The public tier is the one surface with no authentication in front of it, so
 * the rule is not "be careful" but "carry no field that could identify a
 * member". `tests/public.test.ts` walks every module in this directory and
 * every route file under `src/app/jsoa` and `src/app/jsof` against these lists.
 *
 * See docs/ARCHITECTURE.md ("Access tiers") and docs/MODULE-BRIEF.md ("Never
 * put a member's name, unit, rank or face into a public-tier page").
 */

/**
 * Field names carried by the shared types that identify a member, an applicant
 * or a dependent. No public content record may declare one, under any casing.
 *
 * The entries after `memberId` are the compliance fields from
 * ARCHITECTURE.md's member record. They exist so the composition report can be
 * built; they are the last thing that may ever reach an unauthenticated page.
 */
export const MEMBER_IDENTIFYING_FIELDS = [
  "name",
  "fullName",
  "firstName",
  "lastName",
  "surname",
  "memberName",
  "personName",
  "rank",
  "grade",
  "unit",
  "unitDesignation",
  "assignment",
  "command",
  "photo",
  "photoUrl",
  "headshot",
  "portrait",
  "avatar",
  "memberId",
  "sponsorMemberId",
  "membershipCategory",
  "qualifyingRelationship",
  "serviceDatesFrom",
  "serviceDatesTo",
  "isWarVeteran",
  "applicantName",
  "dependentName",
  "guardianName",
  "personalEmail",
  "homeAddress",
  "phone",
  "dateOfBirth",
] as const;

/** `JSOA-YYYY-NNNN`. A lookup key for members. It belongs nowhere public. */
export const MEMBER_ID_PATTERN = /JSOA-\d{4}-\d{4}/;

/**
 * Rank abbreviations and titles, as whole words. A rank plus a first name is
 * enough to identify a person inside a community this small, so the public
 * tier carries neither.
 */
export const RANK_TOKEN_PATTERN = new RegExp(
  "\\b(" +
    [
      "PVT",
      "PFC",
      "SPC",
      "CPL",
      "SGT",
      "SSG",
      "SFC",
      "MSG",
      "1SG",
      "SGM",
      "CSM",
      "WO1",
      "CW2",
      "CW3",
      "CW4",
      "CW5",
      "2LT",
      "1LT",
      "CPT",
      "MAJ",
      "LTC",
      "COL",
      "BG",
      "MG",
      "LTG",
      "MSgt",
      "TSgt",
      "SMSgt",
      "CMSgt",
      "PO1",
      "PO2",
      "CPO",
      "SCPO",
      "MCPO",
      "LCDR",
      "CDR",
      "CAPT",
      "RADM",
      "Private",
      "Corporal",
      "Sergeant",
      "Lieutenant",
      "Captain",
      "Colonel",
      "Admiral",
      "Commander",
    ].join("|") +
    ")\\b",
);

/**
 * Adjectives and comparatives that convert a sponsorship acknowledgment into
 * advertising. ARCHITECTURE.md: a single message containing both advertising
 * and acknowledgment is *entirely* advertising, so one adjective converts the
 * whole placement into taxable income. The partners page therefore carries a
 * name, a link, and a factual relationship, and nothing else.
 *
 * "provider" is on the list because an exclusive *sponsor* is a qualified
 * sponsorship payment and an exclusive *provider* is not.
 */
export const FORBIDDEN_SPONSOR_LANGUAGE = [
  "best",
  "leading",
  "premier",
  "trusted",
  "proud",
  "excellent",
  "outstanding",
  "quality",
  "affordable",
  "recommend",
  "endorse",
  "preferred",
  "favourite",
  "favorite",
  "top-rated",
  "award-winning",
  "world-class",
  "provider",
  "call today",
  "save",
  "discount",
  "offer",
  "buy",
  "shop",
] as const;

/**
 * Third-party hosts. Nothing here may appear in a public route file. The only
 * external origin the product loads is the font stylesheet already in
 * `src/app/layout.tsx`, which this module does not own and does not extend.
 *
 * docs/PRIVACY-AND-PAYMENTS.md: analytics and session-replay tags are being
 * litigated as wiretapping under California's CIPA, with no nonprofit
 * exemption. Ship none by default.
 */
export const FORBIDDEN_THIRD_PARTY_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "connect.facebook.net",
  "facebook.com/tr",
  "hotjar",
  "clarity.ms",
  "segment.com",
  "mixpanel",
  "plausible.io",
  "posthog",
  "intercom",
  "hubspot",
  "doubleclick.net",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "use.typekit.net",
  "fonts.bunny.net",
] as const;

/**
 * Mailboxes on a consumer mail host. The live site publishes two, which routes
 * organizational correspondence about the fallen and about Gold Star families
 * through a personal account. The public tier replaces both with role
 * mailboxes on the organization's own domain.
 */
export const CONSUMER_MAIL_HOST_PATTERN =
  /@(gmail|yahoo|hotmail|outlook|aol|icloud|proton(mail)?|me)\.(com|co\.uk|net)/i;
