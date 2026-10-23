# Board review of the public site

23 October 2026. One reviewer per office from the original thejsoa.org board:
President, VP Membership, VP Operations, Secretary, Treasurer, and the chairs
for Fundraising, Scholarships, Sales, Memorial and the Webmaster. Each was
asked the same thing: read the live site as an outsider, and say whether your
office's work is represented and whether an outsider could understand it.

They read the deployed site, not the source, except where a claim needed the
source to confirm. Everything marked CONFIRMED below I checked myself in the
repository and quote by file and line. Everything marked REPORTED is their
finding, which I have not independently verified.

## The verdict in one paragraph

The machinery is in better shape than the prose. Nobody found a way to move
money to the wrong place, read a member's record, or get a scholarship
decision out of the site. What they found instead, nine times out of ten, is
the same defect wearing different clothes: **a fact that is correct in one
place and contradicted in another, because the site holds the same fact in
more than one file.** The second theme is softer and costs more donations: the
site repeatedly invites an action it cannot yet complete.

## 1. The entity map contradicts itself, at the point of payment

Flagged independently by the Treasurer, the Secretary and the Memorial Chair.
Three offices, three routes, one defect. That makes it the finding with the
most weight behind it.

CONFIRMED. There are two registers of who owns what, and they disagree.

`src/app/(public)/programmes.ts` says the memorial is `runBy: "JSOF"`,
`fundedBy: "JSOF"`. `src/lib/donations/seed.ts:80` puts the only open memorial
fund under the Association:

    id: "fund-jsoa-memorial", entity: "JSOA", name: "Memorial Wall Fund"

The Foundation's own memorial fund, `fund-jsof-pavers-2019`, is closed
(`openToGifts: false`). So `/jsof/memorial` tells a Gold Star family the gift
is deductible and routes them to `/donate`, where the only memorial option is
the 501(c)(19) and the page says in terms that gifts there are not deductible
as charitable contributions. That is a donor acting on our promise and getting
the opposite of it.

CONFIRMED, and worse. `src/lib/donations/seed.ts:42`:

    id: "fund-jsof-golf", entity: "JSOF",
    purpose: "Direct costs of the annual golf tournament and its charitable proceeds."

`/jsof/mission` says, in the Foundation's own voice, that the ball, the golf
and the triathlon are member benefits and the Association pays for them. So a
Foundation fund is defined to pay the direct costs of an event the Foundation
has published a policy against funding. The Treasurer's reading is the one
that matters: an examiner comparing the fund's stated purpose to our own
published policy finds the policy breached in the definition, before any money
moves.

Family support is the one that looks like a contradiction and is not.
`programmes.ts` has it `runBy: "JSOA"`, `fundedBy: "JSOF"`, which is the right
model and is what the Treasurer and the Secretary each independently
recommended we adopt. The bug is in the rendering: `/jsof/mission` prints
`runBy` under a heading that promises the reader a deductible charitable gift.
The data is right and the page shows the wrong field.

**The fix is structural, not editorial.** One register, generated from one
file, with programme, owning entity, funding entity and administering office,
and every page rendered from it. Until that exists, correcting the copy just
moves the contradiction somewhere else.

**Board decision required:** who owns the memorial asset and its capital
campaign, and whether the golf fund keeps event costs or only charitable
proceeds. Nothing else can be fixed until those two are answered.

## 2. Nothing on the site can be independently verified

Treasurer and Secretary, independently. CONFIRMED by grep across every public
page: there is no EIN for either entity anywhere on the site, no state of
incorporation, no Form 990, no financial statement, no NC solicitation licence
number, and no telephone number.

Two consequences the reviewers put better than I would. A corporate
matching-gift portal and a donor-advised fund both require the EIN, so the
site currently cannot accept the largest gifts it is asking for. And
`/jsof/why-the-foundation` twice points the reader at "the annual accounts"
as the place to check a claim, which is a reference to a document that does
not exist on the site.

Separately CONFIRMED: the statutory North Carolina disclosure exists twice in
the codebase, in two different wordings, and they cannot both be the verbatim
statutory text.

- `src/lib/donations/disclosure.ts:23` says "at 888-830-4989"
- `src/lib/treasury/workspace.ts:628` says "at 1-888-830-4989 (within North
  Carolina) or (919) 814-5400"

The Secretary's larger point stands and I had not seen it: the disclosure is
required *at the point of solicitation*, not only on the acknowledgment, and
the site currently carries it in the donate flow but makes the claim on
`/jsof/why-the-foundation` that the acknowledgment is where it lives.

## 3. The site asks for an action it cannot complete, in four places

Scholarships Chair, Memorial Chair, Store Chair and VP Membership each found
their own version of this without knowing about the others.

- "Start an application" on both Foundation-run scholarship pages is a live,
  unstyled link to `/apply/scholarship`, which says the feature is not built.
  The Scholarships Chair's point is the one I would not have thought of: a
  family that has just read "eligibility is under legal review" and then hits
  a dead apply button concludes that counsel has suspended the programme.
- "Give to the memorial fund" leads to a page with no Foundation memorial fund
  (finding 1).
- "Members: sign in for the full catalogue" promises a sign-in that does not
  exist anywhere on the site.
- `/jsof/memorial` and `/jsoa/family-support` both publish a reply-time
  commitment and then admit the mailbox is not routed. The Memorial Chair's
  version of this is the one worth reading twice: a published two-business-day
  commitment to a bereaved family, pointed at a mailbox that nobody reads.

The pattern is one rule, not four fixes. **A control that cannot complete its
action does not render as a control.** Inert text with a note beats a live
link into a wall, every time.

## 4. Where a reviewer says I got it wrong

Two of these are about copy I wrote.

**The sponsor's deduction.** `src/app/donate/sponsor/page.tsx:99` tells a
corporate sponsor that advertising "can create taxable income for us as well
as costing you the deduction." The Fundraising Chair and the Secretary both
say the second half is wrong, and I agree with them. §513(i) is a rule about
*our* unrelated business income. A company that buys advertising ordinarily
still deducts it as a business expense under §162; what it loses is the
*charitable* characterisation under §170, which is not the same thing. We are
publishing a false statement about a sponsor's own tax position on the page we
tell them to rely on before signing. **I have not changed it.** It is a tax
statement on a solicitation and it goes to counsel, not to me.

**The paver.** The Memorial Chair says `/jsof/memorial` reads "Gift:
Deductible" while the donor receives an inscribed paver, which is a benefit, so
only the excess over its value is deductible and the receipt has to state the
good-faith estimate. No other reviewer raised it. I think the Memorial Chair is
right, and the page also says "Paver cost: to be confirmed", so a donor could
not compute the deductible part even if we had told them to.

## 5. Where the reviewers disagree with each other

**Publishing the board.** The Secretary argues that withholding officer names
is pointless, because Form 990 Part VII publishes officers and directors by
name and 990s are on the IRS site, so the site withholds what is already
public while withholding nothing a regulator wants. The OPSEC posture on the
other side is that a list of people who run a JSOC-affiliated association,
matched to their offices, is a list somebody else can use.

They are both right about their own half. The 990 point is factually correct
and I had not weighed it. But a 990 is a PDF somebody has to go and find, and
a web page is indexed, scraped and permanent, and that difference is real.
The position I would defend: keep offices only on the site, and say on the
governance page that officers are named in each entity's Form 990, which is
public. That turns what currently reads as evasion into a stated policy. You
have already said this is the board's call, and it is.

**How far the NC disclosure goes.** The Secretary wants the statutory text in
the global footer of every page in bold. I would put it on every page that
solicits (donate, checkout, sponsor, membership, the receipt) and not on the
memorial page. The statute attaches to solicitations, and a disclosure that
appears under a memorial is a disclosure nobody reads.

## 6. The Webmaster's measurements

These are the only findings with numbers attached, so they are the cheapest to
act on and the easiest to verify.

Clean: all 22 pages return 200, all 41 internal links resolve, 22 unique titles
and descriptions, viewport and `lang` on every page, every image under 500KB.

- Every `/_next/static/**` asset is served `max-age=0, must-revalidate`. The
  filenames are content-hashed, so this is pure waste: about ten conditional
  requests per navigation that should be zero. Fixed in the Workers asset
  headers, not in Next config.
- `/jsof/scholarships` fails WCAG AA at 3.04:1 on the deadline label, because
  `opacity: .85` is layered over `--mute` on a tinted card. The colour token is
  fine on its own; the opacity is what breaks it.
- No sitemap. `robots.txt` returns 200 and contains 24 lines, every one a
  comment, so it declares nothing at all.
- `/` has two `h1` elements (Association and Foundation) and therefore none
  describing the page.
- The 404 page is the unbranded Next.js default, with no way back into the
  site.

## 7. Fixed in this pass

- **The store's member catalogue was readable by anyone** who appended
  `?viewer=good-standing`, and the dev role switcher rendered in production.
  Found by the Store Chair and VP Membership. Outside development every key now
  resolves to the visitor and the switcher does not render. Verified against the
  live Worker.
- **"Closes close in the middle of February"** on all three scholarship cards.
  Found by three offices. The template stripped "They " and left the verb.
- **Partner logos** for the two partners who have one, with the manifest
  recording whose mark each is and that permission has not yet been asked for.
- **Force Network's link.** `forcenetwork.com` serves a Network Solutions
  "under construction" placeholder over plain HTTP and does not answer over
  HTTPS at all. The card now carries the name with no link.
- `/jsof/partners` heading levels, which skipped from `h1` to `h3`.

## 8. What to do next, in order

Blocking, before anyone outside the board reads the site:

1. Answer the two entity questions in finding 1, then build the single
   programme register and render every page from it.
2. Send the sponsor page and the paver page to counsel together. Both are tax
   statements on solicitations and neither should be rewritten by me.
3. Publish both EINs, or take down the deductibility claims until they are.
4. Make every control that cannot complete its action inert, with a note.
5. Decide the demo question. The footer says "Demo build, no live member data"
   on pages that solicit $200 dues and $2,500 sponsorships, and the site is
   `index: true`. It cannot be both.

Then: the mailboxes (`support@`, `connect@`, and a routed address for the
Memorial and Scholarships chairs), the governance page, the cache headers, the
sitemap and robots, the contrast fix, and the branded 404.

Not blocking, and worth keeping: the entity-scoped donate state machine, the
refusal to make percentage claims, the dues and store non-deductibility
statements, the scholarship publication promise, and the restraint on
`/jsof/memorial`. Four reviewers went out of their way to say the writing on
the memorial page is the best on the site. The problem there is everything
around it, not the page.

## 9. The recommendations, numbered

Stable numbers so they can be referred to in a meeting. R1 to R12 block a
public reading of the site. R13 onward do not.

### Blocking

| # | Recommendation | Whose finding |
|---|---|---|
| R1 | Decide which entity owns the memorial asset and its capital campaign, then make one memorial fund in that entity and retire the other | Treasurer, Secretary, Memorial |
| R2 | Decide what the golf fund pays for: charitable proceeds only, or move the fund to the Association | Treasurer |
| R3 | Build one programme and entity register, and render every page from it instead of restating it | Treasurer, Secretary |
| R4 | On `/jsof/mission`, show the funding entity where a donor needs it, not the running entity | Secretary, Treasurer |
| R5 | Send the sponsor advertising and deduction wording to counsel. Do not rewrite it in-house | Fundraising, Secretary |
| R6 | Send the paver wording to counsel, set the paver price and the good-faith value of the inscription | Memorial |
| R7 | Publish both EINs, or remove the deductibility claims until they are published | Treasurer, Secretary |
| R8 | Reconcile the two different North Carolina disclosure strings to one, and confirm the number with the Branch | Secretary |
| R9 | Carry that disclosure at the point of solicitation, not only on the acknowledgment | Secretary |
| R10 | Make every control that cannot complete its action inert with a note: apply, give to the memorial, member sign-in | Scholarships, Memorial, Sales, VP Membership |
| R11 | Route the mailboxes, including one each for the Memorial and Scholarships chairs, or withdraw the published reply times | Memorial, Scholarships, Secretary |
| R12 | Resolve demo against live. Either drop the "Demo build" badge or `noindex` the site and disable the payment steps | Secretary, Webmaster |

### After that

| # | Recommendation | Whose finding |
|---|---|---|
| R13 | A `/governance` page: legal names, state and year of incorporation, EINs, 990s, licence number, conflict-of-interest policy, and the shared board stated plainly | Secretary, Treasurer |
| R14 | Add "Why the Foundation" to the JSOF nav and footer. It is the only page with the correct tax qualifier and nothing links to it | Secretary |
| R15 | Add "Memorial" to the JSOF nav, and link it from the `/jsof` hero and from the Memorial Chair's contact entry | Memorial |
| R16 | One shared scholarship block on all three programme pages: how an application is handled, the dates policy, and the publication promise | Scholarships |
| R17 | Give the North Carolina Patriot Star page its own callout. Our legal hold and our calendar do not govern a Patriot Foundation award | Scholarships |
| R18 | Drop "You will get an answer about your own situation" from the eligibility placeholder. It is a private ruling on an unpublished standard | Scholarships |
| R19 | A fulfilment step in the store: recipient, email, address, and a required size or colour per garment | Sales |
| R20 | State shipping and the free-shipping threshold up front, and stop charging postage on an emailed gift certificate | Sales |
| R21 | Resolve sales tax from a postcode, and either wire `postalCode` into the order or stop saying it is kept | Sales |
| R22 | A quantity stepper in the cart, and make "Keep shopping" carry the cart | Sales |
| R23 | A sponsorship tier sheet: price, benefits, fair market value, deductible amount, and the named payee entity per tier | Fundraising, Treasurer |
| R24 | Serve `/_next/static/**` immutable and `/media/**` with a real max-age | Webmaster |
| R25 | A sitemap, and a `robots.txt` that contains at least one directive | Webmaster |
| R26 | Fix the 3.04:1 contrast on `/jsof/scholarships` by dropping the layered opacity | Webmaster |
| R27 | One `h1` on the front door. It currently has two and therefore none | Webmaster |
| R28 | A branded 404 with a way back into the site | Webmaster |
| R29 | Canonicals on `/`, `/donate` and `/store`, and trim the nine over-long meta descriptions | Webmaster |
| R30 | One date format across both event listings, and link the Foundation's event cards to the event pages | Webmaster |

### Already done

| # | Recommendation | Whose finding |
|---|---|---|
| R31 | Close the store's member gate, which `?viewer=good-standing` opened on the live site | Sales, VP Membership |
| R32 | "Closes close in the middle of February" on all three scholarship cards | Scholarships, Secretary, Webmaster |
| R33 | Partner logos, with the rights record | (asked for separately) |
| R34 | Force Network's link, which pointed at a registrar's parking page | Webmaster |
| R35 | Heading levels on `/jsof/partners`, which skipped `h1` to `h3` | Webmaster |
