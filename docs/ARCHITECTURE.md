# Architecture and build spec

Binding on all module work. If a module needs to depart from this, change this
file first and say so in the commit.

## The two entities

| | JSOA | JSOF |
| --- | --- | --- |
| Name | Joint Special Operations Association | Joint Special Operations Foundation |
| Subsection | 501(c)(19) | 501(c)(3) |
| Owns | membership, dues, events, store, memorial | scholarships, charitable giving |
| Treasurer | its own | its own |

They share infrastructure and never share a ledger, a donor record, or a receipt
template. Every persisted row that can belong to an entity carries `entity`.
Any aggregate spanning both must be rendered as two labelled columns, never summed
into one figure.

## Access tiers

    public          no auth, search-indexed, contains nothing that identifies a member
    member          auth + MFA, JSOA members
    donor           auth + MFA, JSOF donors and sponsors
    board           auth + MFA, scoped per role per data class per entity

## The six data classes

    MEMBER_PII       roster, contact, service history, good-standing status
    FINANCIAL        ledgers, donations, dues, sales, reimbursements, budgets
    APPLICANT        scholarship applicants, family-support cases, dependents
    APPLICANT_SENSITIVE  medical and disability evidence inside an application,
                     and family-support case detail. Scorers read the
                     application and never this.
    PUBLIC_CONTENT   anything that will become publicly visible
    AUDIT_LOG        who saw and changed what

Access levels, ordered: `NONE` < `AGGREGATE` < `READ` < `WRITE`.
`AGGREGATE` means counts and totals only, no row-level identity.

Capabilities are separate from levels and granted explicitly:
`APPROVE_RELEASE`, `APPROVE_SPEND`, `PUBLISH`, `BREAK_GLASS`, `ADMIN_ROLES`.

## The three invariants

Enforced in `src/lib/authz/policy.ts`, asserted in `tests/invariants.test.ts`.
These are requirements, not warnings.

1. **No write on FINANCIAL and APPLICANT for the same entity.** Checked when a
   grant set is constructed; an offending role definition fails at module load.
2. **No self-approval.** Any approval where `approverId === subject.createdById`
   throws. Not a warning, not a soft block.
3. **Second-approver release gate.** Content flagged as carrying a person's name,
   unit, or face cannot transition to `APPROVED` unless the approver differs from
   the author and holds `APPROVE_RELEASE`.

## Membership state machine

    DRAFT ──submit──> AWAITING_VOUCH ──confirm──> AWAITING_PAYMENT ──paid──> PROBATIONARY
                            │                           ▲                        │
                      decline/expire                    │                   30-day audit
                            │                      chair approve                 │
                            └──────> CHAIR_QUEUE ───────┘                        v
                                          │                              GOOD_STANDING
                                          └──chair deny──> DECLINED
                                                           (no payment taken)

Rules:

- Payment is never taken before a vouch or a chair approval. There is no state
  where money is held for an unvouched applicant.
- The sponsor is identified by member ID only. The application form never
  confirms whether an ID is valid, never echoes a sponsor name back, and returns
  an identical acknowledgment in every case. **The form must not be usable to
  test whether a person is a member.** See the enumeration test.
- Vouch window is 72 hours, then the application moves to `CHAIR_QUEUE`.
- `PROBATIONARY` and `GOOD_STANDING` grant identical member access. The audit is
  a check on the record, not a probation the member experiences.
- Augmentee cases go to `CHAIR_QUEUE` regardless of vouch outcome.

## Money

- Integer cents everywhere. Never a float.
- Every inbound payment carries `entity` and at least one fund allocation.
- A donation may split across funds; allocations must sum exactly to the total.
- Inter-entity transfers are their own transaction type and cannot persist
  without two treasurer approvals (one per entity) and a minute reference on
  both sides. The President is recused on the receiving side.
- Receipt templates are per entity and must never be shared.

## Audit log

Append-only. No delete path exists in code, and the table grants no delete.
Every read of `MEMBER_PII` or `APPLICANT` at row level is logged, not only writes:
for this organization, who opened the roster matters more than who edited it.
Break-glass access logs and notifies the President and Secretary.

## Stack

- Next.js (app router), TypeScript, React
- Cloudflare D1 (SQLite), US region ENAM. See the note below.
- Email link plus TOTP, implemented directly. See the note below.
- Stripe, separate accounts per entity, for dues and donations
- Resend for transactional mail (vouch requests, receipts, notices)
- US-hosted. Confirm before adding any vendor.

Two departures from what this section used to say, recorded here rather
than left to be discovered.

**Postgres became D1.** The Worker already runs on Cloudflare, so
Postgres would have meant a third-party host to clear as US-hosted, a
second bill, and a network hop to the database on every request. D1 is
SQLite rather than Postgres and its reporting is weaker, which at a few
hundred members and a decade of minutes does not bite. Reconsider if
cross-entity reporting ever needs real window functions.

**Auth.js became our own session layer.** Auth.js brings its own session
model, and we had already designed `session`, `login_token` and
`credential` around single-use hashed tokens and a separate MFA gate.
Running both would have meant two notions of a session, with the policy
layer reading one and the adapter writing the other. What is not
hand-rolled is the hard part: HMAC comes from WebCrypto, and the TOTP
implementation is checked against every published vector in RFC 4226 and
RFC 6238 in `tests/auth.test.ts`. If that stops being true, replace it
with a dependency.

## Module ownership

| Module | Owner | Phase |
| --- | --- | --- |
| Data model, authz, audit | integration | week 1 |
| Public tier + split front door | public | week 1 |
| Identity, MFA, role grants | integration | week 1 |
| Membership intake and vouch | membership | week 2 |
| Board layer: membership queue, roster, audit view | membership | week 3 |
| Subscription and budget register | treasury | week 3 |
| Meetings: agenda, minutes, decisions | secretary | week 3 |
| Donations, funds, receipts, sponsor tiers | foundation | week 4 |
| Store front with member gating | store | week 4 |
| Release queue and OPSEC gate | integration | week 4 |

Deferred past the 30 days: scholarship cycle, photo bank, newsletter builder,
donor portal, store inventory and shipping, family-support intake.

## Conventions

- Money: `amountCents: number`, integer, and a `currency` column defaulted to USD.
- Dates: UTC in the database; render in America/New_York.
- Member ID: `JSOA-YYYY-NNNN`. Human-readable on purpose. It is a lookup key and
  carries no security weight, because the sponsor click is the authentication.
- No secret, token, or third-party credential is ever persisted in a readable
  column or rendered to any user.
- Every module ships with permission assertions for its data classes. A feature
  is not done until a wrong-role request to it fails in a test.

## Compliance-driven data requirements

Sourced to the statutes, IRS Pub. 3386, and NCDOR's 2026 bulletins. Research,
not advice: items marked COUNSEL or CPA need sign-off before the dependent
feature ships. These are requirements on the data model, not reporting nice-to-haves.

### Member record (drives JSOA's exemption and deductibility)

Two separate tests, easy to conflate:

| Test | Threshold | Governs |
| --- | --- | --- |
| Past or present armed forces members | >= 75% of members | exemption |
| Members, cadets, or qualifying relatives | >= 97.5% | exemption |
| War veterans | >= 90% | whether gifts to JSOA are deductible |

Required fields, per Pub. 3386 ch. 9:

- `membershipCategory` — veteran, qualifying relative (with degree of relation),
  or non-qualifying. Must mirror the bylaws exactly, not the UI's convenience.
- `serviceDatesFrom` / `serviceDatesTo`
- `isWarVeteran` — derived from service dates against the statutory wartime
  periods. The Persian Gulf period beginning 1990-08-02 has never been
  terminated, so most of this roster will qualify.
- `qualifyingRelationship` — when not a veteran

A non-qualifying member class above 2.5% of the roster destroys exemption, so
the composition report is a compliance control. Build it in week 3, not later.

Do NOT build eligibility logic from Treas. Reg. 1.501(c)(19)-1: it still says
75% must be *war* veterans, which Congress deleted in 1982. Use the statute and
Pub. 3386.

### Member versus non-member receipts

Every sale, ticket, and registration records whether the buyer was a member
**at the time of the transaction**. Pub. 3386: if adequate records of
non-member income are not kept, *all* income from activities open to the public
is taxed as unrelated business income. This makes the store's member gating a
tax control, not a feature.

### Volunteer hours

The volunteer-labour exception is what most likely keeps the golf tournament,
ball and triathlon untaxed, and it is a records exception. Events must capture
volunteer count, hours spent planning, hours spent running, and any paid help.

### Sponsorship

Store per sponsor per placement:

- `approvedAcknowledgmentString` — the exact approved wording. A single message
  containing both advertising and acknowledgment is *entirely* advertising, so
  one adjective converts the placement. Sponsor-supplied copy passes the
  release gate before publication.
- `benefitFairMarketValueCents` — required. The 2% safe harbour is all or
  nothing: if total benefit value exceeds 2% of the payment, the entire benefit
  value is carved out, not just the excess.
- Never persist a sponsorship fee tied to attendance or impressions: a
  contingent payment is not a qualified sponsorship payment at all.
- Exclusive *sponsor* is fine. Exclusive *provider* is not.

### Receipts

Per entity, never shared. A JSOA receipt carries a dues-not-deductible
disclaimer. Both entities' contribution receipts carry the NC Chapter 131F
disclosure statement: minimum nine-point type, made conspicuous by underlining,
border or bold, on every printed solicitation, written confirmation, receipt or
reminder of a contribution.

The statement is **verbatim statutory text**. Spell it "license", the US
statutory spelling, never "licence" — this is a quotation, not prose, so house
style does not apply. Canonical copy and the conspicuousness checker live in
`src/lib/donations/disclosure.ts`; import it, never retype it.

Two things about 131F still open, both COUNSEL:

- **Whether JSOA needs a 131F licence at all**, and therefore whether the
  statement is required on its receipts or merely harmless. The exemption
  research enumerated all thirteen statutory exemption categories and found
  **no** veterans' exemption and **no** members-only exemption; the only
  plausible route is the under-$50,000 category, which also requires that the
  organization compensate no officer, trustee, organizer, fundraiser or
  solicitor, and which must be **re-filed annually** rather than self-declared.
  Do not assume an exemption applies.
- If the statement **is** required, it is required on **solicitations** too, not
  only on receipts. The solicitation side is not built.

### Ticketing

- Golf and triathlon entry fees: payment to participate, outside the NC sales
  tax base. Price tee prizes, shirts and banquet as separate line items so
  bundling does not pull the fee into tax.
- Ball tickets: taxable admission unless the nonprofit-event exemption applies,
  and paying a band, DJ, emcee or producer defeats it for the whole event.
  Support splitting a ticket into fair-market-value admission plus a separately
  stated donation; the donation portion is exempt.

### Scholarships — build the machinery, keep the rule as configuration

REPRIORITISED after the Scholarships Chair's intake response (2026-09-27).
This is no longer a deferred module: the next cycle opens mid-December 2026
and it is the organization's most expensive workflow in volunteer time
(~40 hours a month, January to June; ~240 hours a cycle).

Confirmed scale, last cycle: 150 applications, 119 merit awards ($500-$2,500,
occasionally $5,000), 64 Wounded Patriot awards (flat amount). An applicant may
receive both, one, or neither.

The eligibility RULE is under legal review; the machinery around it is not.
Build intake, membership verification, scoring, notification and disbursement
so that the definition of the eligible class is a configuration value, not a
branch in code. When counsel reports, one rule changes.

Required by the chair's own account of the work:

- **Automatic membership check on application.** Today she opens a spreadsheet.
  This was her single biggest automation ask.
- **Copy the sponsoring member on every message to an applicant.** Students
  frequently do not read or answer email; she currently leaves the system to
  reach the sponsor.
- **An award-amount field on the record, merged into the notification.** She
  retypes 183 award amounts into emails by hand each cycle. This is the single
  most time-consuming task in the role.
- **Patriot Foundation routing, at the front of the form.** NC residents
  attending NC schools now apply directly to Patriot Foundation; everyone else
  applies here. Ask the three questions that decide it and route before the
  applicant fills anything in, instead of emailing them afterwards.
- **US-hosted. Explicitly required for scholarship applications.**

Access split, which they already enforce by hand and the platform must keep:
scorers see the transcript and application; scorers do NOT see disability
documentation. Checking disability status is named as the one step that must
never run without a person.

### Scholarships — do not build eligibility as currently published (COUNSEL)

The published rule is "dependent child of a current JSOA member." That is the
fact pattern the IRS uses to deny or revoke (c)(3) exemption: dues collected
from members, scholarships paid to members' children, is private benefit.
Approved analogues define the class by service connection and community, with
objective criteria and a committee excluding anyone related to an applicant.
The scholarship module is out of the 30 days for this reason. Do not encode the
current rule.

### Conflict blocking

A reviewer related to an applicant cannot open the file at all, and the block is
logged. Any award to a board member's dependent goes to the full board with
that member recused. Retain selection records five years.

### Encryption

Encrypt MEMBER_PII and APPLICANT at rest. Under NC's Identity Theft Protection
Act, encryption is built into the definition of a security breach, so it
functions as an effective safe harbour and materially changes the consequences
of an incident.
