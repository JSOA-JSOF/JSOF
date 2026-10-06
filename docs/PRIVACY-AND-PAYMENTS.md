# Privacy and payments: hard rules

Companion to ARCHITECTURE.md. Research-sourced, not legal advice; items marked
COUNSEL need sign-off. The rules here are binding on module work.

## What actually creates obligation

North Carolina has **not** enacted a comprehensive privacy law. The 2025 bill
died; its successor is still in committee. Ignore any source claiming a NC
privacy act took effect in January 2026 — that is a proposed date in an
unenacted bill.

Six state comprehensive laws do not exempt nonprofits (CO, OR, DE, NJ, MD, MN),
but each has a per-state resident threshold of 35,000 or 100,000. A nationwide
membership base almost certainly falls below all of them. Document the actual
per-state member counts and re-run annually rather than assuming. COUNSEL.

So the enforceable obligations are:

1. NC Identity Theft Protection Act (expressly covers nonprofits)
2. Vendor contracts (DPAs) and PCI (contractual, not statutory in NC)
3. **The organization's own published privacy policy**

Item 3 is the largest exposure, because statutory duty is thin. Over-promising
is the risk: "we never share your data" or "military-grade encryption" converts
marketing copy into a deception claim. The policy must be accurate and modest.
Never write a security claim into the policy that the code does not deliver.

## Rule: the platform never ingests a DD-214

Separation documents issued before roughly 2015 carry the member's **full
Social Security number**. NC treats them as sensitive enough that, when filed
with a register of deeds, they are exempt from public inspection.

- No DD-214 upload path. No "attach your discharge paperwork" field. Ever.
- Service dates and war-veteran status are **attested** by the member, not
  documented to the platform.
- The sponsor-vouch flow is what makes this possible: verification comes from a
  named member's confirmation, not from a document.

If a future requirement demands documentary proof, it is reviewed as a change
to this file first. Do not add it in a module.

## Rule: hosted checkout only (PCI SAQ A)

The short PCI questionnaire requires that **every** element of the payment page
originate directly from the payment provider. A single merchant-side script on
the payment page pushes the organization to SAQ A-EP, which is dramatically
larger.

- Use Stripe hosted Checkout (redirect or true iframe).
- No custom fields, no analytics tags, no session-replay, no chat widget on any
  payment page.
- Document the integration type and get the acquirer to confirm the applicable
  SAQ. Do not assert SAQ A without it.
- Card data never touches our servers or our logs.

## Rule: no tracking tags without consent

Analytics, session-replay and advertising pixels are being litigated as
wiretapping under California's CIPA: $5,000 statutory damages per violation,
private right of action, **no nonprofit exemption**, roughly a thousand filings
in 2025.

- Ship no third-party tag by default.
- Any tag added later requires a consent gate and an entry in a tag inventory.
- Someone should audit the existing Wix site's tags now; that is separate work.

## Rule: minors

- Do not collect data from anyone under 13.
- Applicants under 18 require affirmative guardian consent as a **separate
  step**, captured with the guardian's own contact details. Not a checkbox the
  student can tick.
- Separate the **eligibility** dataset (relationship, age, enrollment) from the
  **selection** dataset (essays, activities). A reviewer sees only what their
  decision requires.
- Set and enforce a retention period for unsuccessful applicants. Purge on
  schedule, in code, not by intention.
- Never publish a minor's name, school, photo or likeness without separate
  written guardian consent.

## Membership revocation

NC's nonprofit statute has **no** notice period and **no** hearing requirement
for expulsion. The 15-day/5-day language in many templates comes from a model
act NC declined to adopt. There *is* a one-year limitation on challenging an
expulsion.

Consequence: the revocation procedure comes from the bylaws, not the statute.
The platform must not ship a revoke button until the bylaws say what it does.
COUNSEL.

## Data handling defaults

- Encrypt MEMBER_PII and APPLICANT at rest. Under NC's ITPA encryption is built
  into the definition of a breach, so it functions as an effective safe harbour.
- Collect only what a named workflow requires. Every field must trace to a
  purpose in ARCHITECTURE.md.
- Retention period per data class, enforced by a scheduled job.
- The privacy policy's sharing disclosure must name the actual subprocessor
  chain. Submittable, for reference, names sixteen subprocessors including
  identity-verification and authentication services.

## Unverified

A new annual reporting duty for NC nonprofits reportedly begins 2027-01-01
under a 2026 session law. **Not confirmed.** Verify before putting it on the
compliance calendar or in front of the board.
