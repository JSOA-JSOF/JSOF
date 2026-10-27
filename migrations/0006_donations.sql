-- Foundation giving: funds, gifts, and sponsorship.
--
-- The entity column on every table is doing real work here and is not
-- a convenience. JSOA and JSOF have separate finances and separate
-- audit requirements, and the board review found the site contradicting
-- itself about which entity owns which programme. The database is where
-- that stops being arguable: a fund belongs to one entity, an
-- allocation can only point at a fund in the same entity as its
-- donation, and the trigger below refuses anything else.

CREATE TABLE fund (
  id            TEXT PRIMARY KEY,
  entity        TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  name          TEXT NOT NULL,
  restriction   TEXT NOT NULL CHECK (restriction IN ('UNRESTRICTED', 'RESTRICTED')),
  purpose       TEXT NOT NULL,
  currency      TEXT NOT NULL,
  -- False closes a fund to new gifts without hiding it from reporting.
  open_to_gifts INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX fund_entity ON fund(entity, open_to_gifts);

CREATE TABLE donation (
  id                   TEXT PRIMARY KEY,
  entity               TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  donor_display_name   TEXT NOT NULL,
  donor_email          TEXT NOT NULL,
  amount_cents         INTEGER NOT NULL,
  currency             TEXT NOT NULL,
  -- Required once any benefit is recorded. A gift carrying benefits
  -- with no fair market value cannot produce a lawful receipt, so the
  -- receipt code refuses rather than guessing.
  benefit_fmv_cents    INTEGER,
  -- Set when this gift is the charitable portion of a sponsorship.
  sponsorship_id       TEXT,
  status               TEXT NOT NULL,
  received_at          TEXT NOT NULL,
  -- Opaque provider reference. Never a token, never card data.
  checkout_session_ref TEXT,
  -- The actor that recorded it, for the no-self-approval rule.
  created_by_id        TEXT NOT NULL
);
CREATE INDEX donation_received ON donation(entity, received_at);
CREATE INDEX donation_status ON donation(entity, status);

CREATE TABLE donation_allocation (
  donation_id  TEXT NOT NULL REFERENCES donation(id),
  fund_id      TEXT NOT NULL REFERENCES fund(id),
  amount_cents INTEGER NOT NULL,
  PRIMARY KEY (donation_id, fund_id)
);

-- A gift to one entity cannot be allocated to the other's fund. This
-- is the single most consequential rule in the module and it is the
-- one most easily lost in an afternoon's refactor, so it lives here
-- rather than only in the service layer.
CREATE TRIGGER allocation_entity_must_match
BEFORE INSERT ON donation_allocation
BEGIN
  SELECT RAISE(ABORT, 'a donation cannot be allocated to the other entity''s fund')
  WHERE (SELECT entity FROM donation WHERE id = NEW.donation_id)
     IS NOT (SELECT entity FROM fund WHERE id = NEW.fund_id);
END;

CREATE TABLE donation_benefit (
  donation_id            TEXT NOT NULL REFERENCES donation(id),
  line_no                INTEGER NOT NULL,
  kind                   TEXT NOT NULL,
  description            TEXT NOT NULL,
  quantity               INTEGER NOT NULL,
  unit_fmv_cents         INTEGER NOT NULL,
  PRIMARY KEY (donation_id, line_no)
);

CREATE TABLE sponsorship (
  id              TEXT PRIMARY KEY,
  entity          TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  sponsor_name    TEXT NOT NULL,
  event_name      TEXT NOT NULL,
  tier            TEXT NOT NULL,
  payment_cents   INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  -- A fee tied to attendance or impressions is not a sponsorship
  -- payment at all, it is advertising income. The column exists so the
  -- answer is recorded rather than assumed, and the check keeps the
  -- only lawful answer.
  contingent_on_attendance INTEGER NOT NULL DEFAULT 0 CHECK (contingent_on_attendance = 0),
  exclusivity     TEXT NOT NULL CHECK (exclusivity IN ('NONE', 'EXCLUSIVE_SPONSOR')),
  received_at     TEXT NOT NULL,
  created_by_id   TEXT NOT NULL
);
CREATE INDEX sponsorship_entity ON sponsorship(entity, received_at);

-- What a sponsor's money actually bought, in words somebody approved.
CREATE TABLE sponsor_placement (
  id                      TEXT PRIMARY KEY,
  sponsorship_id          TEXT NOT NULL REFERENCES sponsorship(id),
  entity                  TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  kind                    TEXT NOT NULL,
  -- The exact wording, stored rather than generated. One adjective
  -- turns an acknowledgment into advertising and converts the whole
  -- payment, so the board approves a string and that string is what
  -- gets published.
  approved_acknowledgment TEXT NOT NULL,
  benefit_fmv_cents       INTEGER NOT NULL DEFAULT 0,
  publication_state       TEXT NOT NULL,
  -- Author and approver are separate columns because they must be
  -- separate people.
  authored_by_id          TEXT NOT NULL,
  approved_by_id          TEXT,
  notes                   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX placement_sponsorship ON sponsor_placement(sponsorship_id);
