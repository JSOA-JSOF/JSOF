# Security review against OWASP ASVS

**Standard**: OWASP Application Security Verification Standard **5.0.0**.
**Level**: **Level 1 throughout, plus Level 2** on authentication,
session management, authorization, cryptography, communications,
configuration, data protection and logging.

The edition and the level are written down on purpose. A sign-off that
says only "reviewed against ASVS" moves whenever a new edition is
published, and a control that was adequate in one edition can be
inadequate in the next without anybody deciding anything. If the board
signs this, it signs against 5.0.0 at these levels, and a later edition
is a new review.

Level 2 on those chapters rather than throughout, because the data
classes that justify it are concentrated there: `APPLICANT_SENSITIVE`
holds information about children and about disability, and
`MEMBER_PII` is a roster of people in a special operations community.
The store's catalogue does not need the same bar as the scholarship
reviewer's queue.

Dated 27 October 2026. Measured against the repository, not against
intentions.

---

## Summary

| Chapter | State |
| --- | --- |
| V1 Encoding and sanitisation | Mostly met |
| V2 Validation and business logic | Met, and unusually strong |
| V3 Web frontend security | Met |
| V4 API and web service | Partly met |
| V6 Authentication | Met at L1, gaps at L2 |
| V7 Session management | Met |
| V8 Authorization | **Met, and the best part of this system** |
| V9 Self-contained tokens | Not applicable |
| V10 OAuth and OIDC | Not applicable |
| V11 Cryptography | Met |
| V12 Secure communication | Met |
| V13 Configuration | Partly met |
| V14 Data protection | Partly met |
| V15 Secure coding and architecture | Met |
| V16 Security logging and error handling | Met |
| V17 WebRTC | Not applicable |

Nothing below is a finding somebody else reported. Each was checked
against the code on the date above.

---

## What is strong, and why it is worth saying

**V8, authorization.** Every board page resolves authorization on the
server, at 74 call sites, against a role and capability matrix that is
validated at module load — `assertRoleTableValid()` throws rather than
starting with an invalid table. Two invariants are mechanical rather
than procedural: no actor may hold write on both FINANCIAL and
APPLICANT for the same entity, checked both per role and per person's
combined assignments at request time, because two separately legal
roles can combine into an illegal pair. A reimbursement cannot be
approved by the person who raised it, enforced by a database trigger.
This is above what L2 asks for.

**V2, business logic.** The controls that matter are in the database
and not only in the service layer: append-only audit, ledger and minute
book; a gift cannot be allocated to the other entity's fund; a transfer
must cross between entities. Each was verified against the live
database by attempting the forbidden write and watching it abort.

**V11, cryptography.** Tokens are 256 bits from a CSPRNG, stored as
SHA-256 so a dump of `login_token` or `session` is not a set of working
credentials, and compared by hash. TOTP is checked against every
published vector in RFC 4226 and RFC 6238.

**V16, logging.** Reads are logged, not just writes, because for this
organization who opened the roster matters more than who edited it. The
log cannot be rewritten by the application.

---

## Findings

### 1. No rate limiting anywhere. V6.2, L2. **Open.**

Nothing limits sign-in link requests, TOTP attempts, or the photo
drop. A six-digit TOTP with a one-step window is 10^6 over 90 seconds,
which is not brute-forceable by hand and is trivially so by a script.
The sign-in form is also an unrestricted way to make the platform send
mail to any address.

**Fix**: a per-address and per-IP limit on link requests, a per-session
attempt counter on TOTP that locks the session after a small number,
and a per-IP limit on the drop upload.

### 2. The TOTP secret is stored as written. V6.4 / V14, L2. **Open.**

`migrations/0001` says the secret is "encrypted at rest with a key held
as a Worker secret, never the raw base32", and `beginEnrolment` binds
the raw base32. The schema comment is a claim the code does not keep,
which is worse than not making the claim.

**Fix**: encrypt with a key from a Worker secret, or change the comment.
The comment is right about what it should be, so the code should move.

### 3. No account recovery, and no way to revoke a credential. V6.5. **Open.**

`beginEnrolment` correctly refuses to replace a confirmed credential,
nothing revokes one, and `revokeAllSessions` exists with zero callers.
Lose the phone, lose the account permanently.

**Fix**: administrative reset by a second officer holding `ADMIN_ROLES`,
logged and notified. Not printed recovery codes: a code in a drawer is
a second password with none of the controls.

### 4. Sensitive routes are not `noindex` as a class. V13. **Partly fixed.**

`/drop` and `/sign-in` carry headers; `/board` and `/apply` rely on
metadata per page. `robots.txt` now disallows all four, which is a
request and not a control.

**Fix**: one header rule covering every non-public prefix.

### 5. No Content-Security-Policy. V3. **Open.**

`next.config.ts` sets nosniff, Referrer-Policy, X-Frame-Options and
Permissions-Policy. There is no CSP. The site loads Google Fonts and
nothing else third-party, so a strict policy is achievable now and gets
harder with every addition.

**Fix**: `default-src 'self'`, fonts allowed explicitly, `frame-ancestors
'none'`, report-only first.

### 6. The store's member gate has no door. V8. **Open, and mine.**

Closing the `?viewer=` escalation on 23 October left `/store/members`
resolving every viewer to a visitor in production, so a real paying
member cannot reach the member catalogue. The hole is closed and the
function is gone.

**Fix**: resolve membership from the session. In the store lane now.

### 7. No dependency gate existed until today. V13. **Fixed.**

Six advisories were shipping and nothing reported them. Three came from
dependencies nothing imported. Now two, both waived with a dated,
expiring entry, checked by `scripts/audit-gate.mjs` in CI.

### 8. Uploads are not scanned and are served back. V1 / V14. **Accepted, with reasons.**

The photo drop accepts images and the gallery serves them. They are
re-encoded by the browser before upload, which strips EXIF including
GPS, and are served from an origin that holds no session and runs no
script. They are not scanned for malware.

**Accepted** for a drop that is open for a fortnight behind a printed
code. Revisit if uploads become a standing feature.

---

## What this review does not cover

- **No penetration test.** This is a code and configuration review.
- **No D1 repository has run inside a Worker.** The SQL is exercised
  against SQLite; the driver path is not.
- **No third-party review of the cryptography.** The TOTP matches the
  RFC vectors, which proves agreement with the standard and not that
  the surrounding code uses it correctly.
- **Nothing in production has been tested with real data**, because
  there is none.

## Before go-live

1, 2 and 3 block. 5 and 6 should land with them. 4 is an hour. 7 is
done and 8 is accepted.

None of these is a reason to stop building. All of them are reasons
not to put a member's record in it yet.
