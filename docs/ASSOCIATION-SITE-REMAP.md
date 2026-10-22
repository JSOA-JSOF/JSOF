# The live Association site, remapped

Captured from thejsoa.org on 2026-10-19 by walking the navigation. Every URL
and quotation below is from the live site.

## What is actually there

| Nav label | Real URL | State |
| --- | --- | --- |
| Home | `/` | Mission, lines of effort, three CTAs |
| Mission > Family Support | `/family-support` | A fundraising pitch, not a help page |
| Mission > Memorial | `/memorial` | Good copy, ends in DONATE |
| Events > anniversary | `/jsoa42ndanniversary` | A dated one-off |
| Events > Golf Tournament | `/2021jsoagolftournament` | Live link, 2021 URL |
| Events > Sponsored Art | `/jsoasponsart` | |
| Events > 2025 JSOC Ball | `/copy-of-2022-jsoa-golf-tournament` | See below |
| Scholarships | `/scholarships` | Foundation content on the Association site |
| Donate | `/donate` | The tax claim and the even split |
| Membership | `/membership-1` | Guidelines, $200 fee, a named officer |
| Store | `/construction` | Not a store |
| Members | `/members-welcome` | |
| Partners | `/partners` | **Empty. The page contains the word PARTNERS.** |
| Contact | `/contact` | Ten people named with their offices |
| "BECOME A MEMBER" | `jsoa.submittable.com/submit` | Offsite |

## The URLs are a history of the site

Nobody renames a Wix page, so the slugs record what each page used to be.

- The **2025 JSOC Ball** lives at `/copy-of-2022-jsoa-golf-tournament`. It is a
  copy of a copy. Its text reads "The 2025 JSOC ball is already in the works
  come back here for updates," beneath an image captioned 2024. It is October
  2026. That ball has happened.
- The **Golf Tournament** is linked at its 2021 URL.
- **Membership** is `/membership-1`, so the original page was replaced rather
  than edited.
- The **Store** is `/construction` and says: send an email to sales@theJSOA.org.

This is the same pattern as the orphaned duplicate of the scholarship form
found earlier. It is not untidiness. It is how a volunteer site decays when
nobody owns what their function looks like from outside.

## Things that are broken right now

1. **"DONATE NOW" on the home page points at the home page.** The primary
   giving call to action on the site is a link to itself.
2. **The Partners page is empty.** For an organization that wants corporate
   money, the page a sponsor would check is blank.
3. **The store does not exist.** It is an email address.
4. **The scholarship deadline has passed.** "The deadline to apply for a
   2026/2027 merit scholarship is 2/15/26," published as live in October 2026.
5. **The 2025 Ball page still says come back for updates.**

## The serious one: scholarships are restricted to members' children

Both Foundation scholarships require, in the live text:

> Dependent child of a current JSOA member

So the charitable class of the 501(c)(3) is defined by **who has paid $200 to
the 501(c)(19)**. That is the private benefit problem in its clearest form: it
makes the Foundation look like a benefit of Association membership rather than
a charity, and it is the kind of fact that is read against an organization
rather than for it.

It also interacts badly with the board's working model that Foundation money
"directly supports the Association." Each on its own is arguable. Together
they describe a charity that raises corporate money to fund benefits for
dues-paying members, which is not a charity.

**This needs counsel before the new site republishes the eligibility rules.**
The platform already treats the eligibility statement as a marked placeholder
for this reason, and a test enforces that the rule under review appears
nowhere public.

## Entity confusion, in the site's own words

- `/scholarships` sits on the Association site and opens by saying the
  **Foundation** administers the programmes.
- `/donate` says "Donations to the JSOA are Tax-Deductible." Unsupportable as
  published; see `docs/ENTITY-SPLIT.md`.
- `/donate` says a general fund gift is "distributed evenly across the three
  lines of effort," which moves money across the entity boundary.
- `/memorial` and `/family-support` both end in a DONATE button on the
  Association's own pages.

## Privacy and OPSEC

The contact page names ten people against their offices, including the
President, Treasurer and Secretary. Two offices run organizational business
through personal Gmail accounts, `pavers.thejsoa@gmail.com` and
`info.thejsoa@gmail.com`.

One name holds both **Treasurer** and **Store and Sales**. That is the real
dual hat the platform's `treasurer-store` persona exists to model, and it is
the separation-of-duties case the control tests are written against.

---

# Outline for the new Association site

## The division of labour

**The Association is the membership and support side.** Its site exists so a
member can join, renew, turn up to things, get help, and know which office to
ask. It does not solicit donations.

**The Foundation is the giving side**, corporate-facing. Everything that asks
for money moves there, and it funds the charitable programmes directly rather
than passing money to the Association.

Practically: **every DONATE button leaves the Association site.**

## The structure

    /jsoa                     Mission. Built.
    /jsoa/mission             Statement, three lines of effort, governance
    /jsoa/membership          Eligibility, $200 lifetime, what it gets you
      /apply                  Application. Replaces Submittable
      /apply/vouch/[token]    Sponsor confirmation
    /jsoa/events              Index, with confirmed or not stated per event
      /jsoa/events/ball
      /jsoa/events/golf
      /jsoa/events/triathlon
      /jsoa/events/trunk-or-treat
    /jsoa/family-support      How to ask for help. Not a fundraising page
    /store                    An actual catalogue
      /store/members          Member pricing, behind sign-in
    /members                  Member area: card, renewal, tickets, documents
    /jsoa/contact             By office, never by name
    /jsoa/about               501(c)(19) status, board by office, filings

## What moves to the Foundation

    /scholarships      ->  /jsof/scholarships
    /memorial          ->  /jsof/memorial
    /donate            ->  /jsof, giving
    /partners          ->  /jsof/partners, and it needs content
    every DONATE CTA   ->  /jsof

## What each page must fix

- **Family support** stops being a pitch and becomes a help page: what it
  covers, how to ask, which office holds it, how long a reply takes.
- **Events** state a confirmed date or say the date is not set. Never last
  year's. Each carries a sponsorship handoff to the Foundation rather than a
  donate button.
- **Membership** states plainly that the $200 is not a charitable
  contribution, and runs sponsor confirmation before payment.
- **Contact** publishes offices and remits. No names, no personal Gmail.
- **Store** either exists or says plainly that it is not open yet, with the
  date it will be. Not "under construction".
- **Partners** is not the Association's page at all. It is the Foundation's,
  and it is the first thing a corporate sponsor will look at.

## Sequence

1. Membership and apply. It is the Association's reason to exist and it ends
   the Submittable dependency.
2. Events, because the Ball drives the calendar.
3. Family support and contact. Small, and both are currently misleading.
4. Store, once the board decides whether it is reopening.
