-- Scholarships: cycles, applications, review, awards, cheques.
--
-- The most sensitive module on the platform. The applicants are
-- children and young adults, some of them with a disability record and
-- some of them a board member's dependent, and the Foundation promises
-- never to publish a recipient's name. Three things follow, and they
-- are the shape of this schema.
--
-- The application is split into sections rather than one wide table.
-- Merit and Wounded Patriot ask for different things, and a single
-- table would mean nullable columns for disability evidence sitting on
-- every merit application that never needed them.
--
-- A reviewer's relationship to an applicant is a first-class row, not
-- a flag. It is declared before scoring, it is what the conflict block
-- reads, and it has to be auditable years later.
--
-- `selection_record` is the only table here with a retention date on
-- it. It exists so the Foundation can answer "how was this decided"
-- after the application itself has been destroyed.

CREATE TABLE scholarship_cycle (
  id           TEXT PRIMARY KEY,
  entity       TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  label        TEXT NOT NULL,
  state        TEXT NOT NULL,
  opens_at     TEXT NOT NULL,
  closes_at    TEXT NOT NULL,
  decisions_by TEXT NOT NULL,
  closed_at    TEXT
);

-- Schools are payees, not applicants. The award is paid to the
-- institution and never to the student, which is both the Foundation's
-- policy and what keeps the payment outside the student's income.
CREATE TABLE school (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  payable_to  TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  office      TEXT
);

CREATE TABLE scholarship_application (
  id                       TEXT PRIMARY KEY,
  entity                   TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  cycle_id                 TEXT NOT NULL REFERENCES scholarship_cycle(id),
  reference                TEXT NOT NULL UNIQUE,
  state                    TEXT NOT NULL,
  created_at               TEXT NOT NULL,
  submitted_at             TEXT,
  step                     INTEGER NOT NULL DEFAULT 0,

  applicant_full_name      TEXT NOT NULL DEFAULT '',
  applicant_email          TEXT NOT NULL DEFAULT '',
  applicant_phone          TEXT NOT NULL DEFAULT '',
  -- Drives the guardian consent requirement, so it is required before
  -- an application can be submitted rather than collected later.
  applicant_dob            TEXT,
  applicant_residence_state TEXT NOT NULL DEFAULT '',

  -- How the router sent them: our programme, or a partner's. The
  -- explanation is stored because an applicant told they are not
  -- eligible deserves to know on what basis, and because the rule
  -- changes between cycles.
  routing_outcome          TEXT,
  routing_explanation      TEXT NOT NULL DEFAULT '',
  routing_referral_name    TEXT,
  routing_decided_at       TEXT,

  -- The version of the eligibility rule this was judged against.
  -- Without it, a decision cannot be explained once the rule moves,
  -- and the rule is currently with counsel.
  eligibility_outcome      TEXT NOT NULL DEFAULT '',
  eligibility_rule_version TEXT NOT NULL DEFAULT '',

  -- Set when the applicant is a board member's dependent. Not a flag
  -- the committee can clear: it forces the board review below.
  board_member_person_id   TEXT,
  withdrawn_at             TEXT,
  decided_at               TEXT
);
CREATE INDEX scholarship_app_cycle ON scholarship_application(cycle_id, state);
CREATE INDEX scholarship_app_email ON scholarship_application(applicant_email);

CREATE TABLE scholarship_application_flag (
  application_id TEXT NOT NULL REFERENCES scholarship_application(id),
  flag           TEXT NOT NULL,
  PRIMARY KEY (application_id, flag)
);

CREATE TABLE scholarship_enrolment (
  application_id        TEXT PRIMARY KEY REFERENCES scholarship_application(id),
  school_id             TEXT NOT NULL REFERENCES school(id),
  level                 TEXT NOT NULL,
  accredited_institution INTEGER NOT NULL DEFAULT 0,
  academic_year         TEXT NOT NULL DEFAULT '',
  expected_completion   TEXT NOT NULL DEFAULT '',
  student_number        TEXT NOT NULL DEFAULT ''
);

-- The sponsor check, stored as it was answered on the day. Whether the
-- sponsor was in good standing then is the fact that matters, not
-- whether they are now.
CREATE TABLE scholarship_sponsor_check (
  application_id    TEXT PRIMARY KEY REFERENCES scholarship_application(id),
  sponsor_member_id TEXT NOT NULL,
  checked_at        TEXT NOT NULL,
  roster_member_id  TEXT,
  on_roster         INTEGER NOT NULL DEFAULT 0,
  in_good_standing  INTEGER NOT NULL DEFAULT 0,
  sponsor_name      TEXT,
  sponsor_email     TEXT
);

CREATE TABLE scholarship_merit (
  application_id      TEXT PRIMARY KEY REFERENCES scholarship_application(id),
  -- Hundredths, so 3.87 is 387. No floats anywhere near a score.
  gpa_hundredths      INTEGER NOT NULL DEFAULT 0,
  transcript_summary  TEXT NOT NULL DEFAULT '',
  essay               TEXT NOT NULL DEFAULT '',
  activities          TEXT NOT NULL DEFAULT '',
  recommendation_from TEXT NOT NULL DEFAULT ''
);

CREATE TABLE scholarship_wounded_patriot (
  application_id             TEXT PRIMARY KEY REFERENCES scholarship_application(id),
  service_member_relationship TEXT NOT NULL DEFAULT '',
  disability_evidence        TEXT NOT NULL DEFAULT ''
);

-- Guardian consent for an applicant under eighteen. Captured as its own
-- step with the guardian's own contact details, rather than a box the
-- student ticks.
CREATE TABLE guardian_consent (
  id                TEXT PRIMARY KEY,
  entity            TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  application_id    TEXT NOT NULL UNIQUE REFERENCES scholarship_application(id),
  guardian_name     TEXT NOT NULL,
  guardian_email    TEXT NOT NULL,
  guardian_phone    TEXT NOT NULL DEFAULT '',
  relationship      TEXT NOT NULL,
  -- Which wording they agreed to. A consent that cannot name what was
  -- consented to is not a consent.
  statement_version TEXT NOT NULL,
  consented_at      TEXT NOT NULL
);

-- Declared before scoring. This is what the conflict block reads.
CREATE TABLE reviewer_relationship (
  id                    TEXT PRIMARY KEY,
  entity                TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  reviewer_person_id    TEXT NOT NULL,
  application_id        TEXT NOT NULL REFERENCES scholarship_application(id),
  kind                  TEXT NOT NULL,
  declared_at           TEXT NOT NULL,
  declared_by_person_id TEXT NOT NULL,
  note                  TEXT,
  UNIQUE (reviewer_person_id, application_id)
);
CREATE INDEX relationship_application ON reviewer_relationship(application_id);

CREATE TABLE score_sheet (
  id                 TEXT PRIMARY KEY,
  entity             TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  application_id     TEXT NOT NULL REFERENCES scholarship_application(id),
  reviewer_person_id TEXT NOT NULL,
  total              INTEGER NOT NULL,
  comment            TEXT NOT NULL DEFAULT '',
  scored_at          TEXT NOT NULL,
  -- One sheet per reviewer per application. A second opinion from the
  -- same reviewer is an edit, not another score.
  UNIQUE (application_id, reviewer_person_id)
);

CREATE TABLE score_point (
  score_sheet_id TEXT NOT NULL REFERENCES score_sheet(id),
  criterion      TEXT NOT NULL,
  points         INTEGER NOT NULL,
  PRIMARY KEY (score_sheet_id, criterion)
);

CREATE TABLE disability_verification (
  id                   TEXT PRIMARY KEY,
  entity               TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  application_id       TEXT NOT NULL REFERENCES scholarship_application(id),
  outcome              TEXT NOT NULL,
  verified_by_person_id TEXT NOT NULL,
  verified_at          TEXT NOT NULL,
  -- How it was checked, not what was seen. The evidence itself is not
  -- stored: the Foundation needs to know somebody verified it, not to
  -- hold a medical record.
  method               TEXT NOT NULL,
  note                 TEXT NOT NULL DEFAULT ''
);

CREATE TABLE award (
  id                   TEXT PRIMARY KEY,
  entity               TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  cycle_id             TEXT NOT NULL REFERENCES scholarship_cycle(id),
  application_id       TEXT NOT NULL REFERENCES scholarship_application(id),
  program              TEXT NOT NULL,
  amount_cents         INTEGER NOT NULL,
  currency             TEXT NOT NULL,
  status               TEXT NOT NULL,
  basis                TEXT NOT NULL DEFAULT '',
  proposed_at          TEXT NOT NULL,
  decided_by_person_id TEXT,
  decided_at           TEXT,
  notified_at          TEXT
);
CREATE INDEX award_cycle ON award(cycle_id, status);

-- An award to a board member's dependent goes to the full board with
-- that member recused. Its own table because it has to carry who
-- recused, who approved, and the minute it was recorded in.
CREATE TABLE award_board_review (
  award_id                TEXT PRIMARY KEY REFERENCES award(id),
  reason                  TEXT NOT NULL,
  recused_person_id       TEXT NOT NULL,
  requested_at            TEXT NOT NULL,
  requested_by_person_id  TEXT NOT NULL,
  minute_ref              TEXT,
  decided_at              TEXT,
  outcome                 TEXT CHECK (outcome IN ('APPROVED', 'DECLINED'))
);

CREATE TABLE award_board_approver (
  award_id  TEXT NOT NULL REFERENCES award(id),
  person_id TEXT NOT NULL,
  PRIMARY KEY (award_id, person_id)
);

-- Payable to the institution. The address is copied from the school at
-- the moment of issue, because a cheque has to say where it was sent.
CREATE TABLE cheque (
  id                 TEXT PRIMARY KEY,
  entity             TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  cycle_id           TEXT NOT NULL REFERENCES scholarship_cycle(id),
  award_id           TEXT NOT NULL REFERENCES award(id),
  payee_school_id    TEXT NOT NULL REFERENCES school(id),
  payable_to         TEXT NOT NULL,
  address            TEXT NOT NULL DEFAULT '',
  city               TEXT NOT NULL DEFAULT '',
  state              TEXT NOT NULL DEFAULT '',
  postal_code        TEXT NOT NULL DEFAULT '',
  office             TEXT,
  amount_cents       INTEGER NOT NULL,
  currency           TEXT NOT NULL,
  -- What the school needs to apply it to the right student account,
  -- and deliberately not the student's name.
  memo_reference     TEXT NOT NULL,
  status             TEXT NOT NULL,
  mailed_at          TEXT,
  mailed_by_person_id TEXT,
  note               TEXT
);
CREATE INDEX cheque_award ON cheque(award_id);

-- How a decision was reached, kept after the application is destroyed.
-- Carries a reference rather than a name, and a retention date.
CREATE TABLE selection_record (
  id                       TEXT PRIMARY KEY,
  entity                   TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  cycle_id                 TEXT NOT NULL REFERENCES scholarship_cycle(id),
  application_ref          TEXT NOT NULL,
  outcome                  TEXT NOT NULL,
  total_score              INTEGER,
  scores_recorded          INTEGER NOT NULL DEFAULT 0,
  eligibility_rule_version TEXT NOT NULL,
  school_state             TEXT,
  decided_at               TEXT NOT NULL,
  retain_until             TEXT NOT NULL
);
CREATE INDEX selection_cycle ON selection_record(cycle_id);

CREATE TABLE selection_record_award (
  selection_record_id TEXT NOT NULL REFERENCES selection_record(id),
  program             TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  PRIMARY KEY (selection_record_id, program)
);

CREATE TABLE scholarship_audit (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  person_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  data_class  TEXT NOT NULL,
  entity      TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  row_level   INTEGER NOT NULL DEFAULT 0,
  subject_ref TEXT
);
CREATE INDEX scholarship_audit_at ON scholarship_audit(at);

CREATE TRIGGER scholarship_audit_no_update
BEFORE UPDATE ON scholarship_audit
BEGIN
  SELECT RAISE(ABORT, 'scholarship_audit is append-only');
END;

CREATE TRIGGER scholarship_audit_no_delete
BEFORE DELETE ON scholarship_audit
BEGIN
  SELECT RAISE(ABORT, 'scholarship_audit is append-only');
END;
