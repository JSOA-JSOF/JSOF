# Webmaster requirements: E61 to E72

Written 27 October 2026 by the Webmaster, against the repository at `main`.
Every measurement below was taken on that date and is reproducible from the
command given beside it. Where a line is already satisfied I say so in one
paragraph and move on. The words are spent on the seven that are not.

This office owns twelve contracted functions. Three of them — E66, E67 and
E68 — have nothing in the repository at all, and they are three of the five
conditions on going live. That is the first thing a board member should take
from this document.

## Baseline, measured today

| Measurement | Value | Command |
| --- | --- | --- |
| Test suite | 878 tests, 15 files, all passing, 1.13s | `npm test` |
| Type check | clean | `npm run typecheck` |
| Production dependency advisories | **6 (5 high, 1 moderate)** | `npm audit --omit=dev` |
| Continuous integration | **none** | `ls .github` |
| Occurrences of "OWASP" or "ASVS" in the repository | **0** | `grep -ri owasp\|asvs .` |
| `authorize()` call sites in `src/lib` | 74 | `grep -rn "authorize(" src/lib` |
| Public pages built | 32 (contract says up to 25) | counted in E62 below |
| Deployed stage | `public-beta` | `wrangler.jsonc`, `vars.STAGE` |

The six advisories are the sharpest argument for E67 I can make. They are in
production dependencies — `postcss` by way of `next`, `zod`, and `deepmerge-ts`
by way of `prisma` — they are there today, and nothing in this repository would
have told anyone. A board that buys E67 is buying the thing that would have
raised its hand.

## The four decisions I need from the board

I cannot close these myself and I am not going to pretend otherwise.

1. **Who holds the Network Solutions login for thejsoa.org** (E64). If nobody
   does, the answer is not a website decision, it is a corporate-records
   decision, and it has a deadline of 2028-06-01.
2. **Whether 32 pages is over-delivery or over-build** (E62).
3. **Who may ask for a full data export, and whether it includes medical and
   disability evidence** (E72).
4. **The ASVS edition and level we are reviewed against** (E66), pinned in
   writing so a later edition does not silently move the bar under a signed
   sign-off.

---

# E61 — JSOA public front door

**What it must do.** A visitor who types `thejsoa.org` reaches a page that
says, in plain terms, that there are two organizations, what each does, and
where to go next. It loads, it is indexed by search engines, it tells the
truth about what the site can and cannot do today, and it does not name a
member.

**Acceptance criteria.**

- `GET /` returns 200 and renders the two-door split with both entity films.
- Exactly **one** `<h1>` on the page. There are currently two.
- A `<link rel="canonical">` is present on `/`.
- `/sitemap.xml` returns 200 and lists every public page.
- `/robots.txt` returns 200 and contains **at least one directive**. It
  currently returns 24 lines, every one a comment, which declares nothing.
- A request for a path that does not exist returns a **branded** 404 carrying
  at least one link back into the site.
- The page states one thing about its own status, not two. It cannot both
  carry a "Demo build, no live member data" badge and solicit $200 dues while
  `robots: { index: true }`.
- No name from the live site's board directory appears anywhere in the public
  tier. Enforced today by `tests/public.test.ts`.

**What already exists.** `src/app/page.tsx`, `src/app/DoorLink.tsx` and
`src/app/(public)/Intro.tsx` build the front door and the opening film.
`src/app/layout.tsx` sets `robots: { index: true, follow: true }` and
`poweredByHeader: false` is set in `next.config.ts`. The 57 tests in
`tests/public.test.ts` hold the OPSEC line on it. Prior measurement found all
22 then-deployed pages returning 200, all 41 internal links resolving, and
22 unique titles and descriptions.

**What is missing or undecided.** The sitemap, the robots directives, the
canonical, the single `h1` and the branded 404 are all mine to build
(recommendations R25, R27, R28, R29 in `docs/BOARD-REVIEW.md`). The demo-versus-live
contradiction (R12) is the board's: either the badge comes off or the site is
`noindex` and the payment steps are disabled. I will not ship a front door
that solicits money under a disclaimer saying the money is not real.

**Edge cases.** The front door is currently served under `STAGE=public-beta`,
so it is live while most of the tier behind it is held back — a visitor who
bookmarks a deep link gets `/soon` with no explanation of when. The holding
page needs to say what is held and until when. And when the board later
decides a page is members-only, the sitemap must lose it in the same commit
that gates it; a sitemap entry for a gated page is a public index of what the
members have.

---

# E62 — Existing site rebuilt, up to 25 pages

**What it must do.** Everything the live Wix site carried is either rebuilt,
deliberately retired, or moved to the Foundation, with nothing silently lost.

**Acceptance criteria.** Every row of the inventory in
`docs/ASSOCIATION-SITE-REMAP.md` resolves to one of: a built page, a written
decision to retire it, or a redirect. No rebuilt page restates a fact that
another page also states — one register, one source (R3).

**What already exists.** The rebuild is done and then some. Counting
addressable public content URLs:

    26  static content routes
         1  /
         7  /jsoa and its children
         9  /jsof and its children
         3  /donate and its children
         6  /store and its children
     3  /jsoa/events/[event]          (ball, golf-tournament, triathlon)
     3  /jsof/scholarships/[programme] (merit, wounded-patriot, nc-patriot-star)
    ----
    32  pages

Excluded from that count, deliberately: the two sign-in screens (those are
E63, not content), the nine `/apply` screens (gated, not yet reachable), the
three `/drop` screens (reached by scanning a QR code at an event, `noindex`,
not in the navigation), the two holding pages, and `/store/item/[sku]`, which
renders one URL per product — 37 of them today — from one template. If the
board counts SKU pages as pages, the number is 69, which tells you the metric
is the wrong shape rather than that we built 69 pages.

**My recommendation: note it as over-delivery, do not trim.** Seven pages over
a 25-page ceiling is not scope creep, it is the Association and the Foundation
each needing a full site and the contract having been written when that split
had not been decided. Every one of the seven is load-bearing:
`/jsof/why-the-foundation` is the only page on the site with the correct tax
qualifier; `/jsof/memorial` is the page four reviewers singled out as the best
writing we have. Trimming to 25 would mean deleting content the board review
asked for. What the board should do is record the variance in the minutes so
the number in the next statement of work is 32 and not 25, and so nobody is
surprised by a maintenance burden they did not price.

**What is missing or undecided.** Whether the board accepts the variance, and
at what point a thirty-third page needs an approval rather than a commit. I
would set that line at: new pages inside an existing section are mine; a new
top-level section is the board's.

**Edge cases.** `/store/item/[sku]` grows with the catalogue, so a page count
is not a fixed quantity once the store opens. A page that becomes members-only
later leaves the public count and joins the gated one, and the sitemap, the
robots rules and the `public.test.ts` sweep all have to move with it in the
same change.

---

# E63 — Member login gateway separating public content from member content

**What it must do.** A member proves who they are and sees member content.
Everyone else sees public content and cannot learn, from any response, whether
a given person is a member.

**Acceptance criteria.**

- Sign-in is by email link plus a second factor. The link is good for **15
  minutes** and is single-use; presenting it twice fails the second time.
- The session lasts **12 hours** and begins **without** the second factor
  satisfied, reaching only the enrolment and challenge screens.
- The database stores a **SHA-256 hash**, never the token: a dump of `session`
  or `login_token` yields no working credential.
- Requesting a link for an address that has no account and for an address that
  does returns **byte-identical** responses and takes comparable time. The
  roster must not be enumerable from the sign-in form.
- A signed-in member in `GOOD_STANDING` or `PROBATIONARY` sees the member
  catalogue. A `LAPSED` member and a visitor do not, and the page they get
  names nothing that is not already on the public catalogue.
- No query parameter, and no cookie other than the session cookie, changes
  what any page shows in production.

**What already exists, and it is good work.** `src/lib/auth/tokens.ts`,
`src/lib/auth/store.ts`, `src/lib/auth/actions.ts`, `src/lib/auth/totp.ts` and
`src/lib/authz/session.ts` implement the whole flow. The link is *consumed*
rather than checked — the `UPDATE ... RETURNING` in `consumeLoginToken` matches
only an unused, unexpired row, so two requests racing on a forwarded email
cannot both win. `requestLink` returns one sentence in every case. TOTP is
RFC 6238 and `tests/auth.test.ts` runs it against the published RFC 4226 and
6238 vectors — 29 tests, so it agrees with the standard rather than with its
author. The session cookie is `httpOnly`, `secure`, `sameSite: lax`.

**What is missing, and this one is serious.** The gateway is wired to the
board and **not to the storefront**. `src/app/store/members/page.tsx` resolves
its viewer through `resolveDevViewer` in `src/lib/store/dev.ts`, which never
consults a session. Outside development that function resolves every key to
the visitor. So in production today the member catalogue is unreachable **by
anyone, including an actual member who has paid**. The gate is not leaking; it
is welded shut. Closing `?viewer=good-standing` on 23 October was the right
fix and it left the storefront with no door at all. Wiring
`viewerHasMemberAccess` to `getLiveSession()` and the membership record is the
remaining work and it is mine.

Also missing: the mail queue. `requestLink` writes the sign-in link to the
audit log with a `TODO(E46)` rather than sending it, so today a member cannot
actually receive one. And the published Webmaster and Memorial office
mailboxes on `@thejsoa.org` are not routed (R11), so the address the sign-in
page would tell a stuck member to write to does not answer.

**Edge cases.**

- **A board member loses their phone.** There is no recovery path in the code.
  `beginEnrolment` refuses to replace a confirmed credential — correctly, since
  silent re-enrolment is how an attacker with a live session locks the owner
  out — and nothing revokes a confirmed credential. `revokeAllSessions` exists
  in `src/lib/auth/store.ts` and **has zero callers**. So the honest state is:
  lose the phone, lose the account, permanently. The fix needs a decision I do
  not own: recovery codes issued at enrolment, or an administrative reset by a
  second named officer holding `ADMIN_ROLES` with the reset written to the
  audit log and notified to the President and Secretary. I recommend the
  second, because recovery codes printed by a volunteer board end up in the
  same drawer as the phone. Either way the first implementation step is a
  caller for `revokeAllSessions`, so a lost device kills every live session
  before a new credential is issued.
- **A shared machine.** Twelve hours is chosen so an evening session is not
  live the next morning. There is no "sign out everywhere" control for a member
  who realises afterwards; that is the same missing caller.
- **A lapsed member mid-session.** Membership state is read per request, not
  cached into the session, so a lapse takes effect on the next page load. That
  is the behaviour I want; it needs a test.

---

# E64 — Domain move with a full DNS and mailbox inventory taken first

**What it must do.** Move `thejsoa.org` off Wix without anyone losing a web
page or an email, having first written down everything that would break.

**This is blocked, and not on anything technical.** `thejsoa.org` is registered
at Network Solutions with nameservers at `ns0.wixdns.net` and `ns1.wixdns.net`.
**Nobody has the registrar login.** The WHOIS registrant is a privacy proxy
(Perfect Privacy, LLC), so there is no person in the public record to recover
through — account recovery runs entirely through the Network Solutions login
itself. `thejsof.org` is already at Cloudflare, registered 22 October 2026 into
an empty zone, and is serving from `wrangler.jsonc` today. That half is done.

**The inventory, taken before anything moves.** This is the deliverable, and it
is a signed document, not a conversation.

1. **Registrar record.** Registrar, account email, the named person who holds
   the login, the MFA method and who holds the second factor, the named
   deputy, expiry (**2028-06-01**), lock status (`clientTransferProhibited`,
   correct, stays on), and whether an auth/EPP code can be obtained.
2. **Every DNS record, read from the Wix panel by hand.** Not Cloudflare's
   import scan — it is best effort and will silently miss anything unusual. A
   probe of fifteen common subdomains found none in use, which is encouraging
   and is not a list from the source. Capture A, AAAA, CNAME, MX, TXT, SRV,
   CAA, any subdomain NS delegation, and the TTL on each. The records already
   measured are in `docs/DNS-AND-EMAIL.md`:

       A     thejsoa.org  185.230.63.107 / .186 / .171
       CNAME www          cdn3.wixdns.net
       MX    10/20/30/40/50  aspmx.l.google.com and the four alternates
       TXT   "v=spf1 include:_spf.google.com ~all"
       TXT   "google-site-verification=5bJKYDUBYoYO1XOg1fQwnk9gSA-mDRXPKpk6H7dBvsM"

3. **Independent confirmation.** Each record re-queried with `dig` against the
   authoritative nameservers *and* a public resolver, dated, by a second person.
4. **DS and DNSKEY at the parent.** WHOIS claims `DNSSEC: Signed`; three
   checks say it is not, and there is therefore no DS record to remove. Re-check
   immediately before the switch anyway. Had the zone genuinely been signed,
   moving the nameservers with a stale DS would take the domain dark for web
   **and mail** behind every validating resolver.
5. **Mailbox inventory, from Google Workspace admin.** Every mailbox, alias,
   group, forwarding rule and delegate; every super-admin account and its
   recovery method; and which addresses appear on the live site, on printed
   material and on anything already in a donor's address book.
6. **Everything that authenticates by DNS or by an `@thejsoa.org` address.**
   The Google verification TXT, Stripe, Resend, Submittable, and any ACME or
   CAA dependency. Each one is an account that can lock us out if a record is
   dropped.
7. **Who holds what, with a named deputy for each**: Network Solutions, Wix,
   Google Workspace, Stripe (both entities), Cloudflare.
8. **The Wix content capture.** Wix has no clean export. Pages, images and
   event history come out by hand before the subscription lapses, and the
   account is the only copy.

**Acceptance criteria.** One dated inventory document; every record verified by
two people; an explicit gap list naming every account whose holder is unknown;
and no nameserver change begins until the gap list for `thejsoa.org` is empty.

**What already exists.** `docs/DNS-AND-EMAIL.md` and
`docs/CLOUDFLARE-MIGRATION.md` are the measured state and the plan, and they
are honest about the two-phase split: DNS first, hosting a week later, never
together, because together means two candidate causes and no clean rollback.
`wrangler.jsonc` already serves `thejsof.org` and `www.thejsof.org` as custom
domains with `workers_dev` kept on so a printed QR code still resolves.

**If the Network Solutions account is never recovered.** Say this plainly to
the board, because the consequence is worse than "the website stays on Wix":

- The nameservers cannot be changed, so `thejsoa.org` stays served by Wix.
- **The MX records live in the Wix-hosted zone.** If the Wix subscription
  lapses, the zone goes with it and `@thejsoa.org` mail stops. The lockout
  therefore makes the Wix bill a *mail* dependency, not just a website one,
  and that bill has to be paid indefinitely by an all-volunteer board.
- At **2028-06-01** the registration expires. If the card on file is also
  unreachable, the domain lapses and is auctioned. Nineteen months is not long
  at this cadence, and that step is irreversible.

Recovery routes, in the order I would try them: Network Solutions account
recovery; failing that, an organizational-ownership claim with the articles of
incorporation and the EIN, which is the Secretary's work and not mine; failing
that, a registrar complaint to ICANN. If all three fail, the fallback is to run
the public site on `thejsof.org`, which is already at Cloudflare and already
serving, and keep `thejsoa.org` as a Wix-served redirect for as long as the
bill is paid. Registering a replacement Association domain is a last resort,
because it costs the mail identity and every printed item that carries the old
one. **Decision owner: the board, through the President, with the Secretary on
the corporate records.** I cannot authenticate to an account for which I hold
no credential, and I am not going to attempt a social-engineering recovery on
the organization's behalf.

**Edge cases.** A mailbox that exists in Google Workspace but appears nowhere
in our inventory keeps working after the move only if the MX records carry
across, which they will — but a *subdomain* mail host, or an SRV record for
something nobody remembers configuring, will not. That is what item 2 is for.
And if the registrar login is recovered by one person, the first action after
sign-in is to add a second administrator and MFA, not to change the
nameservers; recovering an account into the same single point of failure
solves nothing.

---

# E65 — Written rollback plan and a scheduled cutover window

**What it must do.** Before any switch, there is a document saying what time it
happens, who is on the call, what we check, what makes us stop, and exactly how
we put it back.

**Acceptance criteria.**

- TTLs on every record lowered to **300 seconds** at least **48 hours** before
  the window, and the old TTL waited out.
- The rollback is one action — restore the nameservers at Network Solutions to
  `ns0.wixdns.net` and `ns1.wixdns.net` — and the document states its expected
  time to effect and who can execute it. **Two** named people can.
- The window is a weekday morning US Eastern. Not a Friday, not inside 7 days
  of a scholarship deadline, and not inside 48 hours of an event.
- Abort criteria are written as conditions, not judgement: mail fails a
  round-trip in either direction within **15 minutes** of the switch; the site
  does not resolve from two independent resolvers within **30 minutes**; or any
  record in the inventory is found missing at the new host.
- A go/no-go checklist is signed before step 1, with the pre-flight DS and
  DNSKEY re-check on it.
- **Mail is confirmed in both directions before anything else is confirmed.**
  Mail is the thing that fails quietly and the thing people actually need.
- Wix is not cancelled. The content capture is complete and the subscription
  paid until the replacement is live and verified.

**What already exists.** `docs/DNS-AND-EMAIL.md` has a six-step cutover order
and `docs/CLOUDFLARE-MIGRATION.md` has the two-phase sequencing and the
"identical answers mean no outage window" reasoning, which is the right mental
model: every risk in the DNS phase reduces to one record existing at Wix and
not at Cloudflare. Both documents are sound.

**What is missing.** Neither is a rollback plan and neither names a date. There
is no abort criterion, no named operator, no TTL schedule with numbers, and no
communication plan for the board or for members. Writing it is mine. Scheduling
it is the board's, and it cannot be scheduled for `thejsoa.org` until E64 is
unblocked.

**Edge cases.** A rollback does not undo a Cloudflare-side change, so proxying
must stay **off** (grey cloud) through the DNS phase while Wix is still the
origin — the default SSL mode gives a redirect loop and Full (strict) gives a
certificate error, both outages caused by a setting that buys nothing yet. A
partial rollback — nameservers back at Wix while a zone record was edited at
Wix during the window — is the one that leaves no clean state, so the rule is
that nothing is edited at Wix inside the window. And resolvers that cached the
old nameservers before the TTL was lowered will keep using them past the
rollback; the document should say so rather than letting someone on the call
conclude the rollback failed.

---

# E66 — Security review against OWASP ASVS before go live

**Nothing exists.** The strings "OWASP" and "ASVS" appear nowhere in this
repository. This is one of the five go-live conditions and it is at zero.

**What it must do.** Before the site is live, somebody works the whole platform
against a published standard, writes down every requirement that fails, and
records for each failure either a fix or a named officer accepting the risk.
The point of using a standard rather than my own judgement is that the standard
was written by people who did not know what we built and therefore cannot have
been shaped to pass it.

**Scope, pinned.** Review against **OWASP ASVS 5.0.0 at Level 1**, plus the
Level 2 requirements of the authentication, session management, authorization,
cryptography, secure communication, configuration, data protection, and
security logging chapters. Level 2 on those chapters and not across the board,
because the platform holds `MEMBER_PII` and `APPLICANT_SENSITIVE` — medical and
disability evidence inside scholarship applications — which is what Level 2 is
written for, and because a volunteer board cannot carry full Level 2 on a first
pass without the review becoming a paper exercise. **The edition and the level
are recorded in the sign-off**, so a later ASVS edition does not silently move
the bar under a signature. That choice is the board's to ratify; the
recommendation is mine.

**Acceptance criteria.**

- A completed worksheet with one row per in-scope ASVS requirement and a
  verdict of PASS, FAIL, or N/A **with a reason** — "N/A" with no reason counts
  as FAIL.
- Every FAIL carries either a commit that fixes it or a dated risk acceptance
  naming the officer who accepted it.
- Coverage is complete: no in-scope requirement is left unverdicted.
- The review names the **exact commit SHA** it was performed against.
- The review is repeated, not inherited, if the deployed commit changes before
  go-live.
- Evidence for a PASS is a file path, a test name, or a captured response
  header. Not a sentence saying it is fine.

**What already exists that will pass.** I expect the authentication, session
management and authorization chapters to go well, and I want the board to know
that before the review finds anything, so a long FAIL list later is read in
proportion. Specifically: hashed single-use tokens and an MFA gate separate
from the session (`src/lib/auth/`), a policy layer with 74 enforcement points
and three invariants asserted in `tests/invariants.test.ts`, an append-only
audit log with no delete path in code or schema, integer-cents money, and a
public tier held by 57 prohibition tests.

**What is missing or undecided.** All of it, plus two decisions. The board
ratifies the edition and level. And the board decides whether the review is
performed by this office or by an outside party — a Webmaster reviewing his own
platform against a checklist is a real review and a weak one, and I would
rather say that now than have it said about my signature later. If the budget
will not carry an outside review, the mitigation is that every FAIL and every
accepted risk is published to the board in full, so the board is the
independent reader rather than nobody being.

**Edge cases.** The review covers code **and** configuration, and the
configuration is partly outside the repository — Cloudflare TLS mode, minimum
TLS version, Workers secrets, D1 region, Google Workspace. Those get captured
as screenshots or API output into the evidence pack, because a setting nobody
recorded is a setting that can change without anybody noticing. And the
`APPLICANT_SENSITIVE` boundary is a business-logic requirement, not a
configuration one: a scorer who can reach disability documentation is an ASVS
authorization failure even though every HTTP response is correct.

---

# E67 — Automated security gate in the build pipeline

**Nothing exists.** There is no `.github/`, no CI of any kind, and no
scheduled scan. Every check in this repository runs only when somebody
remembers to type it.

**What it must do.** On every push and every pull request, a pipeline runs a
fixed list of checks. Some of them stop a deploy. The rest are recorded and
reviewed, and do not. The difference is written down in advance so nobody
decides it under pressure at the moment a deploy is blocked.

**The gate, as a list a pipeline can run.**

*Blocking — a failure here means no deploy:*

1. `npm run typecheck` — `tsc --noEmit`, non-zero exit blocks.
2. `npm test` — all **878** tests pass. A failure blocks. So does a drop in the
   number of test **files**, which catches a suite deleted to make a build
   green.
3. **`tests/public.test.ts` must be present and must have run.** It is the
   control that keeps member-identifying fields off public pages; a pipeline
   that can be green without it is not a gate.
4. **Dev-affordance scan.** The headline check, described below.
5. Secret scan over the diff and the full history (`gitleaks` or equivalent).
   Any hit blocks, including in a deleted file.
6. `npm audit --omit=dev --audit-level=high` — high or critical in a
   **production** dependency blocks. Today that is 5 findings, so the gate
   lands with a dated, itemised waiver file naming each advisory, the accepting
   officer and an expiry date, or it blocks the first deploy. A waiver with no
   expiry is not a waiver.
7. **Dependency addition check.** Any change to `dependencies` in
   `package.json` blocks pending Webmaster approval. The module brief forbids
   adding dependencies and three of today's six advisories arrived through
   transitive ones.
8. `opennextjs-cloudflare build` succeeds, and `wrangler deploy --dry-run`
   succeeds.
9. **Header assertion** against the deployed preview: `X-Content-Type-Options`,
   `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, and — once E69
   lands — `Content-Security-Policy` and `Strict-Transport-Security`. A missing
   header blocks. Asserted on an HTML route **and** on a static asset path,
   because those are served by two different layers.
10. **Stage assertion.** The `vars.STAGE` about to be deployed matches the
    value the branch is supposed to carry. A commit that flips `public-beta` to
    `live` is a go-live decision and must not reach production as a side effect
    of a merge.

*Warning only — recorded on the run, reviewed at the next board meeting, never
blocks:*

- `npm audit` moderate and low findings.
- Outdated-dependency report.
- Accessibility scan (`axe` or Lighthouse). **Warn for now, blocking once the
  current contrast backlog is cleared** — see E69. A gate that is red on day
  one for a known, scheduled issue teaches everyone to ignore it.
- Lighthouse performance and SEO scores, and the bundle-size delta.
- Internal link check across the public tier.
- `next build` warnings.

**The dev-affordance scan, which is the whole point.** On 23 October the
member-only storefront was openable by anyone who appended
`?viewer=good-standing` to `/store/members`, and the dev role switcher rendered
in production. The test that would have caught it is this one, and it is six
lines:

> For each function that can resolve a privileged identity — a `Subject`, a
> `RoleAssignment`, or a storefront `CatalogueViewer` — force
> `NODE_ENV=production`, call it with its **most privileged** argument, and
> assert the result is the anonymous subject or the visitor, or that the call
> throws.

Run that against the four such functions today and three pass:
`resolveDevViewer` (`src/lib/store/dev.ts`) now falls back to the visitor in
production, `getCurrentPersona` throws via `assertDevOnly()`, and
`getCurrentSubject` throws `NotSignedIn`. One fails. **`subjectFromParam` in
`src/lib/donations/devSubject.ts` is reached by `resolveScreenViewer` in
`src/lib/donations/screenSubject.ts`, which honours an explicit `?as=` before
it ever consults the session, and returns a subject carrying real role
assignments with `mfaSatisfied: true` and no production guard whatsoever.**
It is not exploitable today only because `src/app/board/layout.tsx` calls
`getCurrentPersona()` first and that throws in production — so the guard
protecting nine donations screens lives in a sibling file that could be
refactored by someone who has never read this paragraph. That is the same
defect as `?viewer=`, in a different module, still open. A CI gate finds it on
the next push. I will not find it reliably by reading.

A second, cheaper form of the same rule, worth running alongside because it
catches the class rather than the instances: no file under `src/app/` may read
a role, a persona, a membership state or a subject from `searchParams` or from
a cookie that is not `SESSION_COOKIE`, unless the reading module also exports a
production guard asserted by the test above.

**Acceptance criteria.** A pull request that deletes a test file fails. A pull
request that adds a dependency fails. A pull request that reintroduces
`?viewer=`-shaped identity resolution fails. A pull request with a high
advisory in a production dependency and no current waiver fails. A pull request
that drops a security header fails. Each of those is a pull request I can open
to demonstrate the gate works, and I should have to.

**Edge cases.** A gate everyone learns to bypass is worse than none, so the
warn list exists and is genuinely non-blocking. The advisory check will go red
on a day when nobody changed anything, because a new CVE is published against a
dependency we already shipped — that is the gate working, and the pipeline
should therefore also run on a **weekly schedule**, not only on push, so we
hear about it on a Monday rather than mid-deploy. And the gate must run against
a pull request from a fork without exposing secrets, which means the
header-assertion step needs a deploy preview and cannot run on an untrusted
branch.

---

# E68 — Pre-production security sign-off

**Nothing exists.**

**What it must do.** One dated document, naming one commit, signed by a named
person, stating that the platform may go to production. It is the artefact that
makes the other eleven lines checkable at a single moment.

**Acceptance criteria.** The sign-off exists, is dated, names the commit SHA,
and carries:

1. The **five go-live conditions**, each marked met or not met:
   - E66 ASVS review complete, with its worksheet attached.
   - E67 gate in place and green on the signed commit.
   - E69 SSL and headers verified against the live hostname.
   - E63 authentication live, with the dev persona switcher proven absent.
   - E65 rollback plan written and the cutover window scheduled.
2. The open-finding register, with every accepted risk naming the accepting
   officer and a review date.
3. The blocking items from `docs/BOARD-REVIEW.md` — R1 through R12 — marked
   closed or explicitly carried, because several of them are statements about
   tax and solicitation on live pages and are not mine to close.
4. The statement that **the sign-off is void if the deployed commit differs
   from the reviewed commit.** This is the clause that stops a sign-off
   becoming a permanent licence.
5. A signature, and a named deputy who can sign if the Webmaster is
   unavailable. One signature with no deputy is a single point of failure on a
   volunteer board.

**What already exists.** The raw material: `docs/BOARD-REVIEW.md` with
numbered, stable recommendations R1–R35, and an honest "already fixed" section.
That is the right shape for the finding register — it just has never been
turned into a gate anybody has to pass.

**What is missing or undecided.** All of it. The template is mine to write. Who
signs is the board's: I will sign for the technical conditions, and I will not
sign that a page's tax statements are correct, because R5 and R6 are explicitly
matters for counsel. A sign-off whose signer is implicitly certifying things
outside their competence is worth nothing when it is tested.

**Edge cases.** An emergency fix after the sign-off and before the cutover
changes the commit and voids the document — so the process needs a short
re-sign path (gate green, diff reviewed, re-dated) rather than a full repeat,
or people will batch fixes to avoid triggering it, which is exactly the
behaviour to avoid. And `STAGE` is a deployed variable, not a code change:
flipping `public-beta` to `live` is itself the go-live act and must be listed
as a step **inside** the sign-off rather than as a deploy that happens
afterwards.

---

# E69 — SSL and hardened security headers

**What it must do.** Every page is served over HTTPS, a browser cannot be
talked into reaching it over HTTP, and the response headers remove the easy
classes of attack.

**Acceptance criteria**, each verifiable with one `curl -I`:

- `https://` serves a valid certificate on the apex and on `www`; plain
  `http://` redirects to `https://` with a 301.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — added
  **after** the cutover is confirmed stable, never before, because HSTS is not
  quickly reversible.
- `Content-Security-Policy` present and restrictive. The one external origin
  the product loads is the Google Fonts stylesheet in `src/app/layout.tsx`, so
  the policy is writable today: `default-src 'self'`, `script-src 'self'`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src
  'self' https://fonts.gstatic.com`, `img-src 'self'`, `media-src 'self'`,
  `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`,
  `object-src 'none'`. Ship it as `Content-Security-Policy-Report-Only` for two
  weeks first, read the reports, then enforce — Next inlines styles and may
  need a nonce on scripts, and a CSP that breaks the donate flow is worse than
  a fortnight's delay.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **The same headers present on a static asset path**, not only on an HTML
  route.
- `/_next/static/**` served `immutable` with a one-year `max-age`; `/media/**`
  served with a real `max-age`.
- A CAA record restricting which authorities may issue for the domain.
- Cloudflare TLS mode set to Full (strict) once the origin is ours, with a
  minimum TLS version of 1.2, and both recorded in the E66 evidence pack.

**What already exists.** `next.config.ts` sets four of the headers above plus
`poweredByHeader: false`, and gives `/drop/:path*` an `X-Robots-Tag` of
`noindex, nofollow, noarchive` — a header rather than only page metadata,
because a crawler reads the header first. Session cookies are `httpOnly`,
`secure`, `sameSite: lax`. `thejsof.org` is served by Cloudflare with TLS
terminated there. No analytics or session-replay tag ships by default, and
`src/app/(public)/public-safety.ts` holds a forbidden-host list that
`tests/public.test.ts` enforces — which matters more than it sounds, since
analytics tags are being litigated as wiretapping under California's CIPA with
no nonprofit exemption.

**What is missing.** CSP, HSTS and CAA, all three. And a structural gap:
`next.config.ts` headers are applied by the Next pipeline, while static files
are served by the Workers `assets` binding in `wrangler.jsonc`, which does not
go through it. That is why `/_next/static/**` is currently served `max-age=0,
must-revalidate` despite content-hashed filenames — about ten pointless
conditional requests per navigation — and it means the four security headers
we think we have are very likely **absent on every asset path too**. The fix is
in the Workers asset headers, not in Next config, and the E67 header assertion
must test both layers or it will certify a half-covered site.

Still open from the accessibility side, and mine: `/jsof/scholarships` fails
WCAG AA at **3.04:1** against a 4.5:1 requirement on the deadline label, caused
by `opacity: .85` layered over `--mute` on a tinted card. The colour token is
fine; the opacity is the fault.

**Edge cases.** HSTS with `includeSubDomains` applies to every subdomain
including any that Google Workspace or a future vendor needs over plain HTTP —
inventory them (E64, item 6) before enabling, because the `max-age` cannot be
called back from browsers that have already cached it. And a CSP that is
correct for the public tier may break the board workspaces, which use client
components and server actions; the Report-Only period must exercise the board
screens as well as the public ones, which means it has to happen while `STAGE`
still gates them.

---

# E70 — Public content architecturally separated from member-sensitive content

**What it must do.** It must be structurally impossible — not merely against
policy — for a member's name, rank, unit, member ID, service dates or face to
appear on a page that requires no login.

**This line is genuinely satisfied for the pages it covers, and it is the best
work in the repository.** `src/app/(public)/public-safety.ts` expresses the
rule as data: 31 member-identifying field names, a member-ID pattern
(`JSOA-YYYY-NNNN`), a rank-token pattern covering 44 abbreviations and titles, a
consumer-mail-host pattern, and a forbidden third-party host list.
`tests/public.test.ts` — 57 tests — walks every content module and every route
file under `src/app/(public)`, `src/app/jsoa` and `src/app/jsof` against it and
**fails the build**, not warns. It asserts, among other things, that the field
list actually covers the keys the shared membership types carry, so the guard
cannot quietly drift behind the data model. It rejects all nine board members
named on the live Wix site by name, holding those names in the test file and
nowhere in `src/`, so the repository asserts their absence without being the
thing that republishes them. The contact type has no field for a person at all:
`slug`, `role`, `entity`, `remit`, `mailbox`, `mailboxLive`, `respondsWithin`,
and the test asserts that exact key set. And every image resolves through a
manifest in `src/app/(public)/media.ts` where each entry carries a dated OPSEC
review, a note, and a `depicts` field that may not be `MEMBERS`; only two
components may render an `<img>` at all, and `next/image` is barred outright.

**Acceptance criteria.** `npm test` fails if a member-identifying field name is
introduced into public content at any nesting depth; if a member ID or a rank
token appears in any public source file; if any of the nine live-site names
appears; if a page renders an image from a literal path instead of through the
manifest; or if a manifest entry lacks a dated review.

**What is missing, and it is a real gap.** The sweep covers **three**
directories. `/store`, `/donate`, `/apply` and `/drop` all render HTML to
unauthenticated visitors and **none of them is in `PUBLIC_TIER_DIRS`**. The
donate flow carries donor-facing copy, the store will carry order and
fulfilment fields once R19 lands, and the drop pages render event photographs.
The guard should sweep every route reachable without a session, with the page's
own gate — not its directory — deciding whether it is in scope. Extending it is
mine. The judgement call that comes with it is the board's: event photographs
on `/drop` are reached by a QR code at an event and are `noindex`, but "hard to
find" is not an access control, and whether a member's face may appear there is
the same board decision the image manifest already refuses to make on the
board's behalf.

**Edge cases.** **A page that is public today and member-only tomorrow** is the
harder direction and it is the one that leaks: the content was indexed, cached
by search engines and possibly archived while it was public, so gating the
route does not retract it. The rule is that gating a page is three changes in
one commit — the gate, the sitemap removal, and a request for removal from the
search engines that indexed it — plus an honest note to the board that anything
already archived is gone. The other direction, member-only becoming public, is
easier but must not be a copy-paste: content moving into the public tier enters
the `public.test.ts` sweep, and under
`docs/ARCHITECTURE.md`'s third invariant anything carrying a name, unit or face
needs a second approver holding `APPROVE_RELEASE` who is not the author.

---

# E71 — Role-based access enforced on the server, not in the browser

**What it must do.** Every decision about what a person may see or do is made
on the server, from the session, before the data is read. Nothing a visitor
controls — a query parameter, a cookie they set, a hidden form field, a
JavaScript variable — changes the answer.

**This is true in pattern.** `src/lib/authz/model.ts` holds the data: 2
entities, 6 data classes, 4 ordered levels, and the capabilities.
`src/lib/authz/policy.ts` holds the enforcement, called at **74** sites in
`src/lib`, and it throws `AuthzError` rather than returning a flag that a
caller can forget to check. Board screens are React server components, so a
refusal is a refusal to *read*, not a hidden `<div>` — `/board/donations/gifts`
calls `readDonationRegister`, which calls `authorize()` for row-level
`FINANCIAL READ` before it touches the repository, so a role holding only
`AGGREGATE` lands on a refusal page and no rows are fetched. The two CSV export
routes authorize inside the library function, so the handler cannot skip the
check: there is no path from handler to repository that avoids it. Three
invariants are asserted in `tests/invariants.test.ts` (45 tests): no `WRITE` on
both `FINANCIAL` and `APPLICANT` for one entity, no self-approval, and a
second-approver release gate. `tests/reviewer-boundary.test.ts` (21 tests)
enumerates every read in the scholarships module and decides, per read, whether
a scorer may reach it — written after three such reads were found one at a
time. `tests/dashboard-access.test.ts` (21 tests) asserts every role dashboard
refuses a role holding nothing, and that a withheld figure is `null` and never
`0`. The MFA gate is separate from the session, so proving an email is not
proving identity.

**And it was recently false in fact.** Until 23 October, `/store/members` was
openable by anyone who appended `?viewer=good-standing`, and the dev role
switcher rendered in production. A member-only catalogue was readable by the
internet because a demo affordance keyed on a query parameter was honoured in
production. The page's own comment said the switcher "must not survive contact
with real records" — the comment was right and the code did not enforce it.

**The test that would have caught it** is the dev-affordance scan specified in
E67: force `NODE_ENV=production`, call the identity resolver with its most
privileged argument, assert it returns the anonymous subject or throws. Three
of four such functions pass that test today. **`subjectFromParam` in
`src/lib/donations/devSubject.ts` does not** — `resolveScreenViewer` honours an
explicit `?as=TREASURER:JSOF` ahead of the session and returns real role
assignments with `mfaSatisfied: true`. It is shielded today only because
`src/app/board/layout.tsx` calls `getCurrentPersona()` first and that throws in
production. That is a guard in a different file from the hole, which is the
arrangement that produced the `?viewer=` incident. **This is E67's job, and it
is the clearest justification for the $550 of scope the board is being asked
to fund: the same bug class is open right now, and I found it by reading, which
is not a method that scales.**

**Acceptance criteria.**

- For every function that can produce a `Subject`, a `RoleAssignment` or a
  storefront viewer: with `NODE_ENV=production`, the most privileged input
  yields the anonymous result or throws. No exceptions, no allowlist.
- No file under `src/app/` resolves identity from `searchParams` or from any
  cookie other than `SESSION_COOKIE`.
- For every board screen, a request by a role holding nothing returns a
  refusal, and the refusal contains no figure — not even a zero.
- A role denied at row level never receives a redacted table; it receives the
  refusal.
- Both CSV export routes return **403 and zero bytes** of report to a
  wrong-role request.
- No authorization decision exists in a `"use client"` component. There are 13
  client components; all 13 take their data from a server component that has
  already authorized.

**What is missing or undecided.** Closing `subjectFromParam`, and wiring the
storefront to real sessions (E63) so `grantsMemberAccess` is evaluated against
a membership record and not a switcher. Both are mine. What is the board's: who
holds `ADMIN_ROLES`, and therefore who can grant a role to anybody else.
`grantRole` records a `granted_by`, which is the right design and currently has
no policy behind it saying who may call it.

**Edge cases.** The `treasurer-store` persona exists because one person on the
live site holds both Treasurer and Store and Sales — a real dual hat, and the
separation-of-duties case the invariants are written against; the policy
refuses the combination rather than trusting the person, which is correct and
will be unpopular the first time it bites. A role revoked mid-session takes
effect on the next request, since `assignmentsFor` is read per request and not
baked into the cookie — that is the behaviour I want and it needs an explicit
test. And `getLiveSession` deliberately returns `null` for a missing database
binding as well as for a bad session, because a caller must not be able to
distinguish them; the cost is that an infrastructure failure looks like a
signed-out user, so the audit log is the only place that difference is visible.

---

# E72 — Full data export available to the board on request at any time

**What it must do.** Any time the board asks, it gets everything the platform
holds, in a form it can read without this office and without this vendor. The
board should never be in a position where leaving the platform means losing the
records.

**Acceptance criteria.**

- A board member holding the President or Secretary role can request an export
  and receive it within **5 business days**.
- The export is: a SQL dump of the D1 database, **plus** one CSV per table,
  **plus** a manifest listing every table with its row count and the schema
  version, **plus** the contents of the R2 event-photo bucket.
- Row counts in the manifest reconcile exactly to the CSVs. An export that
  silently drops a table is worse than no export.
- The request and the delivery are both written to the audit log, naming the
  requester and the approver.
- Delivery is to a named person over a channel the board controls. **Never to a
  consumer mailbox** — two currently appear on the live site, and
  `tests/public.test.ts` already refuses to republish them.
- The runbook is in the repository and can be followed by somebody who is not
  me.
- The export is reproducible from the repository alone: the ten migrations in
  `migrations/` are the schema, so a restore does not depend on a vendor
  console.

**What already exists.** Partly, and well, for what it covers. Two
authorization-gated CSV exports:
`src/app/board/scholarships/disbursement/export/route.ts` (the cheque run,
which deliberately carries no applicant name — the payee is the school and the
student appears only as an award reference, which is why a Treasurer holding no
applicant grant can open it) and
`src/app/board/store/receipts/export/route.ts` (the member versus non-member
receipts report, 403 to a wrong role). Both set `Cache-Control: no-store`.
Underneath, D1 is a single store with all ten migrations version-controlled in
`migrations/`, and the audit log is append-only with no delete path in code or
schema — which is what makes a full export meaningful rather than a snapshot of
whatever survived.

**What is missing.** There is no whole-platform export and no runbook. The
mechanism is not hard — `wrangler d1 export jsoa-platform --remote` plus an R2
sync — but "not hard" is how something ends up undocumented and dependent on
one volunteer. The harder part is the authorization question, and it is the
board's: **a full export crosses every data class at once**, so no role on the
current table holds it. `MEMBER_PII`, `FINANCIAL`, `APPLICANT`,
`APPLICANT_SENSITIVE` and `AUDIT_LOG` in one file is a shape the policy layer
is specifically built to prevent, and the right model is therefore
`BREAK_GLASS`: two named officers, logged, and notified to the President and
Secretary, exactly as the architecture already specifies for break-glass
access. The board decides, on the Secretary's recommendation, and it goes in
the minutes.

The second board decision: **whether a routine export includes
`APPLICANT_SENSITIVE`** — the medical and disability evidence inside
scholarship applications. My recommendation is that the default export redacts
that class to a row count, and an unredacted export is a separate,
second-approver action with a stated reason recorded. A board member asking for
"everything" is usually asking for the records, not for a family's medical
documentation, and the export should not be the one place that distinction
stops being enforced.

**Edge cases.**

- **The export file itself is now the most sensitive object the organization
  owns**, and it is outside every control in this repository the moment it is
  delivered. The runbook must say where it may be stored, how long it is kept,
  and who deletes it. An export with no retention rule is a breach with a
  delay.
- **A departing Webmaster.** The requirement says "at any time", and that has
  to mean without me. The runbook must be executable by a board member with
  Cloudflare access, which in turn means at least two board members hold that
  access — the same lesson as the Network Solutions login in E64, and the
  reason `docs/CLOUDFLARE-MIGRATION.md` says to create the account under a role
  address with MFA and two administrators.
- **A legal demand.** A subpoena or a records request is an export too, and it
  arrives with a deadline and goes through counsel, not through this office.
  The runbook should say that out loud so the first person who receives one
  does not simply run the command.
- **A member who asks for their own data** is a different request with a
  different scope, and conflating it with the board export is how someone ends
  up sending one member the whole roster.

---

# Where this leaves go-live

Five conditions. Of those, E63 is most of the way there and has one storefront
gap and no mail queue; E65 has good source material and no plan document; and
**E66, E67 and E68 are at zero.** E64 is blocked on a credential the
organization does not hold, and that block has a 2028-06-01 deadline attached
to it.

E70 and E71 are the two lines I would defend in front of anybody: the public
tier is held by 57 prohibition tests that fail the build, and authorization
resolves on the server at 74 enforcement points. Both are strong, and one of
them was still bypassable by a query string four days ago, in a second module
that is bypassable today. That is not an argument against the work. It is the
argument for E67, and I would rather the board bought the gate than bought my
assurance that I will keep reading carefully.
