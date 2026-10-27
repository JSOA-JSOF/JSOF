-- Treasury: the ledger, inter-entity transfers, reimbursements, and
-- the subscription register.
--
-- The approval tables are the substance here. Two of these workflows
-- exist because of a control rather than because of a feature: a
-- transfer between the entities needs both treasurers, and a
-- reimbursement cannot be approved by the person claiming it. Both are
-- modelled as rows, so "who approved this" survives a staff change,
-- and neither is a boolean on the parent that one UPDATE can flip.

CREATE TABLE treasury_fund (
  id                    TEXT PRIMARY KEY,
  entity                TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  name                  TEXT NOT NULL,
  restriction           TEXT NOT NULL,
  purpose               TEXT NOT NULL DEFAULT '',
  opening_balance_cents INTEGER NOT NULL DEFAULT 0
);

-- Append-only, like the audit log and for the same reason. A ledger
-- that can be edited is a spreadsheet. A correction is a reversing
-- entry that cites the one it reverses.
CREATE TABLE ledger_entry (
  id            TEXT PRIMARY KEY,
  entity        TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  date          TEXT NOT NULL,
  fund_id       TEXT NOT NULL REFERENCES treasury_fund(id),
  account       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  memo          TEXT NOT NULL DEFAULT '',
  -- Signed. A debit is negative and a credit positive; storing the
  -- sign in a separate column is how a total comes out wrong.
  amount_cents  INTEGER NOT NULL,
  -- The minute that authorised it, where one was needed.
  minute_ref    TEXT,
  entered_by_id TEXT NOT NULL
);
CREATE INDEX ledger_fund ON ledger_entry(entity, fund_id, date);
CREATE INDEX ledger_date ON ledger_entry(entity, date);

CREATE TRIGGER ledger_entry_no_update
BEFORE UPDATE ON ledger_entry
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append-only; post a reversing entry');
END;

CREATE TRIGGER ledger_entry_no_delete
BEFORE DELETE ON ledger_entry
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append-only; post a reversing entry');
END;

-- Money crossing between the two entities. The riskiest routine thing
-- the organization does, which is why it carries a restriction
-- statement and a minute reference on both sides.
CREATE TABLE transfer (
  id                    TEXT PRIMARY KEY,
  created_by_id         TEXT NOT NULL,
  entity                TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  from_entity           TEXT NOT NULL CHECK (from_entity IN ('JSOA', 'JSOF')),
  to_entity             TEXT NOT NULL CHECK (to_entity IN ('JSOA', 'JSOF')),
  amount_cents          INTEGER NOT NULL CHECK (amount_cents > 0),
  from_fund_id          TEXT REFERENCES treasury_fund(id),
  to_fund_id            TEXT REFERENCES treasury_fund(id),
  -- Both minute books, because a transfer has to appear in both.
  minute_ref_from       TEXT,
  minute_ref_to         TEXT,
  -- Whether the restriction travels with the money. A restricted gift
  -- moved into an unrestricted fund is the failure this records.
  restriction_statement TEXT NOT NULL DEFAULT '',
  purpose               TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL,
  -- The entities must differ. An internal move within one entity is a
  -- ledger entry, not a transfer, and conflating them is how a
  -- transfer escapes the two-treasurer rule.
  CHECK (from_entity <> to_entity)
);

CREATE TABLE transfer_approval (
  transfer_id TEXT NOT NULL REFERENCES transfer(id),
  -- The entity whose treasurer this approval is for. Both are needed,
  -- which is why the key is the pair and not the person.
  entity      TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  approver_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (transfer_id, entity)
);

CREATE TABLE reimbursement (
  id                 TEXT PRIMARY KEY,
  entity             TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  created_by_id      TEXT NOT NULL,
  claimant_name      TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  fund_id            TEXT NOT NULL REFERENCES treasury_fund(id),
  purpose            TEXT NOT NULL DEFAULT '',
  incurred_on        TEXT NOT NULL,
  receipt_on_file    INTEGER NOT NULL DEFAULT 0,
  -- A claim from a board member or their family. Not a refusal, but it
  -- changes who may approve it and it has to be visible in the report.
  related_party      INTEGER NOT NULL DEFAULT 0,
  related_party_note TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL,
  refusal_reason     TEXT
);
CREATE INDEX reimbursement_status ON reimbursement(entity, status);

CREATE TABLE reimbursement_approval (
  reimbursement_id TEXT NOT NULL REFERENCES reimbursement(id),
  approver_id      TEXT NOT NULL,
  approved_at      TEXT NOT NULL,
  PRIMARY KEY (reimbursement_id, approver_id)
);

-- Nobody approves their own claim. The service layer checks this too;
-- it is here as well because it is one line and because the cost of
-- the check being missed is somebody paying themselves.
CREATE TRIGGER reimbursement_no_self_approval
BEFORE INSERT ON reimbursement_approval
BEGIN
  SELECT RAISE(ABORT, 'a claim cannot be approved by the person who raised it')
  WHERE NEW.approver_id =
    (SELECT created_by_id FROM reimbursement WHERE id = NEW.reimbursement_id);
END;

-- What the organization pays for monthly, and what this platform
-- replaces. The register the subscription audit is written from.
CREATE TABLE subscription (
  id                             TEXT PRIMARY KEY,
  tool                           TEXT NOT NULL,
  vendor                         TEXT NOT NULL,
  -- How the cost is divided between the entities, as rows below.
  split_basis                    TEXT,
  owning_role                    TEXT NOT NULL,
  -- A tool with one administrator is a tool the organization loses
  -- when that person leaves.
  second_administrator_person_id TEXT,
  cost_cents                     INTEGER,
  cadence                        TEXT NOT NULL,
  -- What the bank actually shows, where it differs from the list
  -- price. The gap is usually the finding.
  observed_annual_cents          INTEGER,
  renewal_date                   TEXT,
  justification                  TEXT NOT NULL DEFAULT '',
  nonprofit_rate_applied         INTEGER NOT NULL DEFAULT 0,
  nonprofit_rate_note            TEXT NOT NULL DEFAULT '',
  last_reviewed_on               TEXT,
  last_review_decision           TEXT
);

CREATE TABLE subscription_split (
  subscription_id TEXT NOT NULL REFERENCES subscription(id),
  entity          TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  -- Basis points of the total, so two entities sum to 10000 exactly
  -- and a 1/3 split does not drift.
  share_basis_points INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, entity)
);
