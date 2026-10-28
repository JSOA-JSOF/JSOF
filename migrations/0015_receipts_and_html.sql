-- Two gaps the Foundation giving lane found and correctly refused to
-- work around.

-- 1. There was no record that a receipt was issued.
--
-- The only trace was an outbox row, so nothing stopped a second send
-- allocating a second number for the same gift. Two receipts with
-- different numbers for one donation is the kind of thing that is
-- discovered by a donor's accountant rather than by us, and the
-- statutory acknowledgment is the single document this organization
-- most needs to be able to stand behind.
--
-- One row per donation, enforced by the primary key: issuing is
-- idempotent because a second attempt collides rather than counting.
CREATE TABLE receipt (
  donation_id     TEXT PRIMARY KEY REFERENCES donation(id),
  entity          TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  -- JSOF-R-00001. Allocated from the counter, never recomputed.
  reference       TEXT NOT NULL UNIQUE,
  sequence        INTEGER NOT NULL,
  -- What the donor may deduct, after the value of anything they
  -- received. Stored rather than derived, because the figures behind
  -- it can change and a receipt must keep saying what it said.
  amount_cents    INTEGER NOT NULL,
  benefit_fmv_cents INTEGER NOT NULL DEFAULT 0,
  deductible_cents  INTEGER NOT NULL,
  issued_at       TEXT NOT NULL,
  issued_by       TEXT NOT NULL,
  -- The outbox row that carried it, so "was it sent" is answerable.
  message_id      TEXT
);
CREATE INDEX receipt_entity ON receipt(entity, issued_at);

-- A receipt is never reissued under a new number and never deleted.
-- A correction is a new donation record and a new receipt that says
-- what it replaces, the same way the ledger handles a mistake.
CREATE TRIGGER receipt_no_update
BEFORE UPDATE ON receipt
BEGIN
  SELECT RAISE(ABORT, 'a receipt is issued once; correct it with a new one');
END;

CREATE TRIGGER receipt_no_delete
BEFORE DELETE ON receipt
BEGIN
  SELECT RAISE(ABORT, 'a receipt is never deleted');
END;

-- 2. The outbox could not carry a compliant receipt.
--
-- outbound_message had body_text and nothing else, so what left the
-- queue was plain text. N.C.G.S. 131F-9(c) wants the solicitation
-- disclosure conspicuous -- underlined, bordered, or bold -- in type
-- no smaller than nine points, and plain text has none of the three.
-- The module already renders a compliant document and had nowhere to
-- put it.
--
-- Nullable, because most mail is better as text and a sign-in link
-- in particular should never be HTML: a link styled to look like
-- something else is the shape of every phishing email anybody has
-- seen.
ALTER TABLE outbound_message ADD COLUMN body_html TEXT;
