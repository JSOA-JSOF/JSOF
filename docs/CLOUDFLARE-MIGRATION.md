# Leaving Wix for Cloudflare

Written 2026-10-19 against the DNS state recorded in `docs/DNS-AND-EMAIL.md`.

## There are two moves here, and they should not happen together

1. **Move DNS to Cloudflare.** Low risk, reversible, can happen this week, and
   Wix keeps serving the website the entire time.
2. **Move hosting to Cloudflare.** This is the real project. It is blocked on
   work that has nothing to do with Cloudflare, described below.

Doing them together means that if the site breaks, there are two candidate
causes and no way to roll one back without the other. Do the first, let it sit
for a week, then do the second.

---

## Phase 1: DNS to Cloudflare, Wix still serving

The whole point of this phase is that **nothing visible changes.** Cloudflare
becomes the authoritative nameserver and answers with exactly the records Wix
was answering with. The website still comes from Wix. Mail still goes to
Google. Nobody notices.

That is also the safety property worth understanding. During a nameserver
change, some resolvers use Wix and some use Cloudflare for a period of hours.
**If both answer identically, there is no outage window at all.** Every risk
in this phase reduces to one thing: a record that exists at Wix and does not
exist at Cloudflare.

### Before touching anything

Open the Wix DNS panel and write down **every** record, not just the ones we
already measured. Cloudflare's import scan is best effort and cannot read a
zone it has no access to, so it will find the common records and may silently
miss anything unusual. A probe of fifteen common subdomains found none in use,
which is a good sign, but it is not the same as a list from the source.

These must be present in Cloudflare before the switch:

    A     thejsoa.org      185.230.63.107
    A     thejsoa.org      185.230.63.186
    A     thejsoa.org      185.230.63.171
    CNAME www              cdn3.wixdns.net
    MX    10 aspmx.l.google.com.
    MX    20 alt1.aspmx.l.google.com.
    MX    30 alt2.aspmx.l.google.com.
    MX    40 aspmx2.googlemail.com.
    MX    50 aspmx3.googlemail.com.
    TXT   "v=spf1 include:_spf.google.com ~all"
    TXT   "google-site-verification=5bJKYDUBYoYO1XOg1fQwnk9gSA-mDRXPKpk6H7dBvsM"

### Set the website records to DNS-only, not proxied

In Cloudflare this is the grey cloud rather than the orange one.

Wix serves its own TLS certificate. Putting Cloudflare's proxy in front of it
on the default SSL mode causes a redirect loop, and on Full (strict) it causes
a certificate error. Neither is hard to fix, but both are an outage caused by
a setting that buys nothing while Wix is still the origin. Leave the proxy off
until hosting actually moves, then turn it on deliberately.

MX and TXT records are never proxied, so they need no decision.

### The switch

1. Create the Cloudflare account. See the account note at the bottom first.
2. Add `thejsoa.org` on the Free plan. Let it scan, then correct the result
   against the list above and against the Wix panel.
3. Cloudflare assigns two nameservers. Change the nameservers at **Network
   Solutions** from `ns0.wixdns.net` and `ns1.wixdns.net` to those two.
4. Wait for Cloudflare to report the zone active. Usually minutes to a few
   hours for `.org`.

The registrar lock (`clientTransferProhibited`) stays on. It prevents the
domain being transferred away and does not block a nameserver change, so there
is nothing to unlock for this.

There is no DS record to remove, because the zone is not actually signed
despite what WHOIS claims. Re-check that immediately before the switch anyway.

### Confirm afterwards

Check the nameservers moved, the mail records survived, and the site loads.
Then **send a test email in both directions**, because mail is the thing that
fails quietly and the thing people actually need.

### While the DNS panel is open anyway

Add DKIM and DMARC. `docs/DNS-AND-EMAIL.md` has the reasoning: the domain can
currently be spoofed by anyone, and this organization emails donation receipts
and scholarship outcomes to a community that is a standing phishing target.
Enable DKIM in Google Workspace, publish the key, then add DMARC at `p=none`
to collect reports before tightening. This is unrelated to Cloudflare and
worth doing whether or not the hosting ever moves.

---

## Phase 2: hosting the platform on Cloudflare

### The adapter

Next.js 15 runs on Cloudflare Workers through **`@opennextjs/cloudflare`**, the
OpenNext adapter. Cloudflare Pages is no longer where new full-stack projects
should start; Cloudflare has been steering Pages users to Workers, and the
OpenNext adapter is the supported path for server-rendered Next.js. The
adapter covers App Router, React Server Components, Route Handlers, SSR, ISR,
Server Actions, streaming and Middleware, which is everything this app uses.

Roughly: install the adapter and Wrangler, add a Wrangler config with
`nodejs_compat` enabled and a current compatibility date, build through the
adapter, deploy with Wrangler.

### The blocker, which is not Cloudflare's fault

**Six modules keep their state in `globalThis`, and `prisma/` contains no
schema at all.**

    src/lib/scholarships/repository.ts
    src/lib/scholarships/notify.ts
    src/lib/membership/repository.ts
    src/lib/membership/notify.ts
    src/lib/meetings/repository.ts
    src/lib/store/repository.ts

On a single long-lived Node process this works, which is why the demo works.
On Workers it does not. Isolates are ephemeral and distributed, so state
written by one request is not reliably there for the next one.

The failure mode is the dangerous kind. Nothing throws. The site looks fine in
testing. Then an applicant submits a scholarship application, the isolate
recycles, and the application is simply gone, with no error anywhere. For a
scholarship system handling a deadline, that is far worse than an outage,
because an outage is visible and this is not.

**So persistence has to land before hosting moves.** Not because Cloudflare
demands it, but because this app currently has no durable storage of any kind
and that was always going to block a real deployment.

### Two ways to do the persistence, and they are a real decision

**Cloudflare D1.** Cloudflare's own SQLite. Simplest, cheapest, no second
vendor, generous free tier, and genuinely sufficient at this organization's
scale, which is hundreds of members and roughly 150 applications a cycle.
Prisma supports it through a driver adapter.

**Managed Postgres through Hyperdrive.** Neon or Supabase as the database,
Hyperdrive as the connection pooler that makes Postgres workable from Workers.
This is what `docs/ARCHITECTURE.md` already assumes. More capable, better
suited to the audit log and the compliance reporting, and it adds a vendor and
a cost.

D1 is very likely the right answer on the merits for an all-volunteer board.
The architecture document says Postgres. That contradiction should be settled
deliberately rather than by whoever writes the first migration.

### Also before anything is public

The dev persona switcher is a cookie. It stands in for authentication and
must not ship. Real auth is a prerequisite for a public deployment, separate
from both the hosting move and the persistence work.

Any secrets go in Workers secrets, never in a committed env file.

---

## Phase 3, optional: move the registrar too

Cloudflare Registrar sells domains at wholesale cost with no markup, which for
`.org` is a meaningful annual saving against Network Solutions, and it puts
the domain and the DNS behind one login instead of two.

It requires the domain to be on Cloudflare DNS first, so it can only happen
after Phase 1. Unlock the domain at Network Solutions, get the auth code,
start the transfer at Cloudflare. The sixty day rule is satisfied, since the
domain has been registered since 2016. A transfer adds a year to the
registration rather than losing the time already paid for.

This is genuinely optional. It saves money and reduces vendor count. It does
not make anything work that does not already work.

---

## Do not cancel Wix yet

Wix has no clean content export. The pages, the images, the event history and
anything else worth keeping has to be captured by hand before the subscription
lapses, and losing the account means losing the only copy. Keep paying for it
until the replacement is live and the content has been pulled.

## The account itself

Create the Cloudflare account under a role address that the organization
controls, such as a shared board mailbox, **not** under a personal account.
Turn on MFA. Give at least two board members administrative access.

This is the same lesson as the registrar privacy proxy in
`docs/DNS-AND-EMAIL.md`. Recovery for that domain currently runs entirely
through one Network Solutions login, and nobody has written down who holds it.
Starting the Cloudflare account the same way would repeat a problem this
project already found.
