# Domain, DNS and email

Current state as measured on 2026-10-19, plus what has to happen in what order
when the site leaves Wix. Measured values are from `dig` against the public
resolvers and against the authoritative nameservers. The WHOIS record supplied
the registrar facts.

## Who holds what

| Thing | Vendor | Note |
| --- | --- | --- |
| Domain registration | Network Solutions | Created 2016-06-01, expires 2028-06-01 |
| DNS zone | Wix (`ns0/ns1.wixdns.net`) | This is what moves |
| Web hosting | Wix (`185.230.63.x`, `www` to `cdn3.wixdns.net`) | This is what we replace |
| Email | **Google Workspace** | `aspmx.l.google.com` and friends |

**The registrar and the DNS host are two different vendors with two different
logins.** The board needs both to leave Wix. Only the second one changes.

**Email is the good news.** Mail is already at Google, not at Wix. Moving the
website does not move the mailbox, so nobody loses email during the cutover,
provided the records below are carried across before the nameservers change.

## Records that must survive the move

Copy these into the new DNS host before switching nameservers, not after.

    MX   10 aspmx.l.google.com.
    MX   20 alt1.aspmx.l.google.com.
    MX   30 alt2.aspmx.l.google.com.
    MX   40 aspmx2.googlemail.com.
    MX   50 aspmx3.googlemail.com.
    TXT  "v=spf1 include:_spf.google.com ~all"
    TXT  "google-site-verification=5bJKYDUBYoYO1XOg1fQwnk9gSA-mDRXPKpk6H7dBvsM"

Losing the MX records stops mail. Losing the SPF record does not stop mail, it
makes outbound mail start failing other people's spam checks, which is worse
because it is silent and looks like nothing happened.

## DNSSEC is not actually on

The WHOIS record says `DNSSEC: Signed`. It is not. Three checks agree:

- No DS record at the `.org` parent, from two independent resolvers.
- No `DNSKEY` at the authoritative nameserver.
- No `AD` flag on a validating query.

So the registrar's WHOIS field is stale or simply wrong, and **there is no DS
record to remove before changing nameservers.** Had the zone genuinely been
signed, pointing the nameservers away while a DS record still referenced Wix's
keys would have taken the domain dark for anyone behind a validating resolver,
web and mail together. That step is not needed here. Re-check immediately
before the cutover anyway, because this is cheap to check and expensive to get
wrong.

## Cutover order

1. Stand up the new site and confirm it serves on its own hostname.
2. Re-check DS and DNSKEY. Expect both still empty.
3. Recreate every record above at the new DNS host, MX first.
4. Lower TTLs at Wix and wait out the old TTL.
5. Change the nameservers at Network Solutions.
6. Confirm mail delivery before confirming anything else.

The registrar lock (`clientTransferProhibited`) is correct and should stay on.
It prevents the domain being transferred away. It does **not** block a
nameserver change, so there is no reason to unlock anything for this work.

## Two findings that are not about the migration

**No DMARC record, and no DKIM on the default selector.** There is nothing at
`_dmarc.thejsoa.org`, and nothing at `google._domainkey.thejsoa.org`, which
suggests DKIM was never switched on in Google Workspace. The SPF record ends
in `~all`, a softfail, which asks receivers to accept suspicious mail anyway.

Taken together, anyone can send mail that appears to come from
`@thejsoa.org` and a good share of it will be delivered. For an organization
that emails donation receipts, scholarship outcomes and membership notices to
a community that is a standing phishing target, that is worth closing on its
own schedule, ahead of anything on the website. The fix is ordinary work:
enable DKIM in Google Workspace, publish the key, add DMARC at `p=none` to
collect reports, read the reports, then tighten to quarantine and reject.

**Registrant privacy is a proxy.** WHOIS shows Perfect Privacy, LLC rather
than a person, which is fine and normal. The consequence is that account
recovery runs entirely through the Network Solutions login. Who holds that
login, and who else can get it if that person is unavailable, is an open
question for the intake, alongside the Wix and Google Workspace accounts.

**Renewal is 2028-06-01.** Nineteen months out, so no urgency, but it belongs
on the compliance calendar with the filings rather than in somebody's memory,
and the card on file needs to outlive the date.
