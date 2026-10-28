-- Columns the build needs, written ahead of the lanes that need them.
--
-- migrations/ has one owner, which is what stops six agents writing
-- six incompatible 0012 files. These are the gaps the requirements
-- documents named, added now so the lanes are not blocked waiting for
-- me to answer a question they already asked.

-- Membership -------------------------------------------------------

-- E09, reviewer assignment. There was no column, no type and no
-- screen; an application could be in a queue and belong to nobody.
ALTER TABLE application ADD COLUMN assigned_to TEXT REFERENCES person(id);
ALTER TABLE application ADD COLUMN assigned_at TEXT;
CREATE INDEX application_assigned ON application(assigned_to);

-- Store ------------------------------------------------------------

-- E33. A catalogue nobody can photograph is a catalogue of text, and
-- the store sells a $78 quarter-zip on prose today.
ALTER TABLE product ADD COLUMN image_key TEXT;
ALTER TABLE product ADD COLUMN image_alt TEXT;

-- A variant is a thing somebody has to pick before an order can be
-- filled. The catalogue promises "sizes S to 3XL" and the checkout
-- never asks, which is why a polo arrives in the wrong size.
CREATE TABLE product_variant (
  sku          TEXT NOT NULL REFERENCES product(sku),
  -- 'size', 'colour'. Kept open rather than an enum, because the next
  -- product will have an axis nobody predicted.
  axis         TEXT NOT NULL,
  value        TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  -- Null means it costs what the product costs. A variant that
  -- changes the price is rare and real: 3XL often does.
  price_delta_cents INTEGER,
  active       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (sku, axis, value)
);

-- What was chosen, frozen onto the line like everything else on an
-- order. A receipt has to keep saying what it said on the day.
ALTER TABLE order_line ADD COLUMN variant_summary TEXT;

-- Where an order actually goes.
--
-- Its own table and not columns on store_order, deliberately. The
-- order row holds only the state, county and postcode that the tax
-- figure has to be justified by, and that rule is worth keeping: a
-- postal address has a different retention period and a different
-- audience from a tax record, and merging them makes the shorter one
-- inherit the longer one.
CREATE TABLE shipment_address (
  order_id      TEXT PRIMARY KEY REFERENCES store_order(id),
  recipient     TEXT NOT NULL,
  email         TEXT NOT NULL,
  line1         TEXT NOT NULL,
  line2         TEXT,
  city          TEXT NOT NULL,
  state         TEXT NOT NULL,
  postal_code   TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'US',
  created_at    TEXT NOT NULL,
  -- Set when the order is delivered and the address is no longer
  -- needed. The retention sweep reads this; the order and its tax
  -- record outlive it.
  purge_after   TEXT
);

-- Scholarships -----------------------------------------------------

-- A cheque can come back. CHEQUE_STATUSES was QUEUED and MAILED, so a
-- returned cheque had nowhere to go and the money was recorded as
-- disbursed.
ALTER TABLE cheque ADD COLUMN returned_at TEXT;
ALTER TABLE cheque ADD COLUMN returned_reason TEXT;
ALTER TABLE cheque ADD COLUMN reissued_as TEXT REFERENCES cheque(id);

-- Treasury ---------------------------------------------------------

-- A correction is a reversing entry that cites what it reverses. The
-- ledger is append-only, so without this column the relationship
-- between a mistake and its correction lives only in a memo somebody
-- wrote by hand.
ALTER TABLE ledger_entry ADD COLUMN reverses_entry_id TEXT REFERENCES ledger_entry(id);

-- Communications ---------------------------------------------------

-- A one-click unsubscribe needs a token, because a URL carrying a
-- plain address is an unsubscribe anybody can perform for anybody.
CREATE TABLE unsubscribe_token (
  token_hash TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at    TEXT
);

-- A saved audience, named by criteria rather than by a list of people.
-- The Communications Chair holds MEMBER_PII: NONE and must never see
-- the roster, so a segment is a rule resolved server side at send
-- time, and what the chair sees is a count.
CREATE TABLE audience (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  entity      TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  -- JSON, read only by the resolver. Never a list of addresses.
  criteria    TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
