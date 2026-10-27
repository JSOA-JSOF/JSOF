# Build order

Consolidated from the seven offices' requirements, the ten-office board
review, and what porting to a database exposed. Measured against the
repository on 27 October 2026.

Seven officers wrote independently and arrived at the same shape, which
is the most useful thing in all 7,800 lines:

> **The libraries are built. The doors to them are not.**

Six modules, 169 repository methods, 881 passing tests, a role matrix
enforced at module load, separation of duties that is mechanical rather
than procedural. And no way to create a board account, no way to add a
product, no way to send an email, and eleven of seventeen offices with
no screen at all.

That diagnosis sets the order. Almost nothing below is hard. It is a
small number of missing connections, and they are in a chain.

---

## The chain

Four things block almost everything else, in this order. Nothing further
down the page is worth starting before these, because each one makes the
next testable.

```
  1. Email sending ──→ 2. Accounts and roles ──→ 3. The board shell
                                                        │
                                   4. Create paths ─────┘
```

### 1. Email sending. The keystone.

`resend` is in `package.json` and imported by nothing. The consequence
is not that notifications are missing; it is that **authentication does
not work**. `requestLink` writes the sign-in token into the audit log
behind a `TODO(E46)`, so the only way to sign in is to read the
database.

Everything behind sign-in is therefore unreachable, which is most of the
platform. Also waiting on it: the applicant confirmation (E07), renewal
reminders (E19), order confirmations (E38), and the scholarship outcome
letter (E52) that the Chair named as one of her two worst tasks.

**Cheapest real unblock on the whole list.** `thejsof.org` is on
Cloudflare and can send today. The Communications Chair argued against
the tempting shortcut of sending Association mail from the Foundation's
identity, because entity separation is a compliance control, and
proposed one carve-out worth taking to the board: a sign-in link makes
no tax claim and speaks in no entity's voice.

Two things must be true before the first send:
- The legacy Mailchimp list's unsubscribed, cleaned and bounced segments
  are imported **before any subscriber is**. Mailing people who opted out
  years ago, from a cold domain, is the reliable way to get blocked at
  Gmail.
- Transactional and bulk are separate streams with separate suppression.
  A member who unsubscribes from the newsletter still gets their receipt.

### 2. Accounts and role grants

`grantRole()` and `invite()` exist, are correct, and have **zero
callers**. `ADMIN_ROLES` is defined, granted to the President, and
checked nowhere. So the only way to create a board account today is
hand-written SQL against production, which is how this account was
created.

Until this exists, E03 is not operable, E05 has nobody to serve, and
E11's "automatic member account creation on approval" writes a literal
`NULL` into `person_id`.

### 3. The board shell

Thirteen board route files still resolve the viewer through
`getCurrentPersona()`, which throws on `NODE_ENV=production`. One of
them is the board layout itself, so **in production the whole board
layer fails before any page renders.**

This is also where the `?as=` escalation was hiding: it was shielded by
that layout throwing, and wiring real sessions in is exactly what would
have removed the shield. The guard is now in the resolver and there is a
rule over all of them (`tests/identity-resolvers.test.ts`), so this is
safe to do now and was not before.

### 4. Create paths for reference data

Found independently by three offices. No `saveProduct`, no way to create
a `fund` or a `sponsorship`, no `createCycle` or `createSchool`, no
`saveSubscription`. Against a real database the storefront is empty, the
donate form offers no funds, the apply form throws `"No scholarship
cycle is configured"`, and the subscription register cannot record the
audit it exists for.

Invisible until now because `seed.ts` filled the arrays. **It must not
be fixed by loading the seed**: that data is deliberately realistic and
deliberately false, and it would put invented products in a live
storefront.

---

## After the chain: the workflows that have libraries and no screens

Roughly in order of how much volunteer time each returns.

| | What | Why here |
| --- | --- | --- |
| 5 | **Scholarship state transitions** | Nothing outside seed data ever sets `AWARDED` or `NOT_AWARDED`. So ~31 applicants a cycle have no recorded outcome, the retention clock never starts, and E49, E51, E52 and E53 all have nothing to act on. One gap, four contracted lines. |
| 6 | **Scholarship screens** | Eight tested functions are unreachable, including `declareRelationship` — so the conflict block, the best-written control in the module, currently protects nothing. |
| 7 | **The checkout delivery step** | Checkout collects no name, email or address, so E37 and E38 cannot exist. One step unblocks both. |
| 8 | **Ledger write path** | `TreasuryRepository` can read the ledger and cannot post to it. E20 and E24 both depend on it. |
| 9 | **Member self-service** | E28–E30. Needs 1–3 first; E30 has no repository method at all today, so correcting a typo means a hand-edit that bypasses the audit trail. |
| 10 | **The member storefront door** | Closing the `?viewer=` leak on 23 October left this welded shut: a real paying member cannot reach the member catalogue, because nothing there consults a session. My fix closed the hole without adding a door. |

---

## Go-live conditions, which are not features

These gate launch regardless of how much of the above is finished.

**E66, E67, E68 have nothing.** No reference to OWASP or ASVS anywhere,
no CI, no `.github/`. That is three of the five go-live conditions.
`npm audit --omit=dev` reports six advisories today, five of them high,
and nothing in the repository would have told anybody.

The pipeline is the higher priority of the two, because it is what stops
the next regression. Three bugs in the last day were found by people
reading code, not by tests: two un-awaited separation-of-duties
controls, and an identity resolver with no production guard. All three
would have been caught by a gate.

**E12 / R12, demo against live.** The footer says "Demo build, no live
member data" on pages soliciting $200 dues and $2,500 sponsorships,
while `robots: { index: true }`. It cannot be both.

**No rollback, no staging, one person can deploy, migrations applied by
hand from a laptop.**

---

## The decision track

None of this is build work and most of it blocks build work. It should
run from the first day, not after.

**Counsel**
- The scholarship eligibility rule. Blocks E08 and E50 and the public copy.
- The sponsor advertising and deduction wording, and the paver quid pro quo.

**Board, one minute each**
- **Does membership recur?** Four incompatible statements exist today: the
  code says one-time lifetime, the treasury seed posts quarterly renewals,
  the site says "One payment, no renewal", and `/apply/submitted` says
  "$200 a year". People may already have been sold a lifetime membership.
  Blocks E17, E19 and half of E24.
- Which entity owns the memorial and what the golf fund pays for.
- Grace period, renewal anniversary, fiscal year, write-off policy.
- Whether officer names are published, or cited to the Form 990.
- Member pricing: a discount in basis points, a second price list, or neither.

**Organisational, and genuinely blocking**
- **Who holds the Network Solutions login.** It blocks the DNS move, the
  mailboxes, DKIM, and the Wix cancellation. The Webmaster found the sharp
  edge: the MX records live in the Wix-hosted zone, so a lockout makes the
  Wix subscription a *mail* dependency, and the domain expires 2028-06-01.
- **Two payment processor accounts**, neither of which exists. Blocks E16,
  E21, E22 and E35.
- **Both EINs.** Without them a donor cannot verify the charity, use a
  matching-gift portal, or route a donor-advised fund.

**Cheapest thing on this page**: `support@` and `connect@` need **no DNS
change at all**. The MX already points at Google, so creating them is a
Workspace admin task. Every published reply-time commitment on the site
currently rests on two mailboxes that do not exist.

---

## What is already done, and should stop being re-litigated

Said plainly so effort does not go here:

- The public tier, 32 pages, with 57 prohibition tests that fail the build
  if a member-identifying field reaches it.
- Authorization resolved server-side on every board page, 74 call sites.
- The role matrix, enforced at module load, with separation of duties that
  refuses the Treasurer attesting their own count.
- Sign-in's cryptography: hashed single-use tokens, and TOTP checked
  against every published vector in RFC 4226 and RFC 6238.
- Six repositories on D1 behind unchanged interfaces, with the controls that
  matter enforced by database trigger rather than by convention.
- The event photo drop, the gallery, and the sponsor wall — none of which
  is in Annex A.

---

## If there is one week

In this order, because each makes the next testable:

1. Send one real email from `thejsof.org`, and sign in with the link.
2. Call `invite()` and `grantRole()` from a screen, so an account can be
   made without SQL.
3. Replace `getCurrentPersona()` in those thirteen board files and open
   the board tier to a real session.
4. Add a CI workflow: typecheck, test, `npm audit`, and the identity-resolver
   rule. It would have caught all three of this week's bugs.
5. Write `saveProduct`.

That is the difference between a platform that demonstrates well and one
a volunteer can use on a Tuesday.
