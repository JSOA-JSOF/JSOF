-- The store: catalogue, orders, inventory, refunds.
--
-- The money columns are the point of this one. Every amount is an
-- integer of cents and there is no REAL anywhere in this file. SQLite
-- will happily store a float in a column typed INTEGER, so the type is
-- a statement of intent and the application is what keeps it true; a
-- rate held as 0.07 instead of 700 basis points is how a tax figure
-- ends up a cent out on a thousand orders and nobody can say why.

CREATE TABLE product (
  sku                   TEXT PRIMARY KEY,
  entity                TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  name                  TEXT NOT NULL,
  blurb                 TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL,
  price_cents           INTEGER NOT NULL,
  currency              TEXT NOT NULL,
  -- False for the member-only lines. The gate is enforced in the
  -- service layer; this column is what it reads.
  publicly_purchasable  INTEGER NOT NULL DEFAULT 1,
  fulfilment            TEXT NOT NULL,
  collection            TEXT,
  -- Whether sales tax applies, and on what basis. A gift certificate
  -- is exempt at sale and taxed on what it is spent on.
  tax_treatment         TEXT NOT NULL,
  -- Retired rather than deleted, so an old order line still resolves.
  active                INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX product_entity ON product(entity, active);

CREATE TABLE store_order (
  id                        TEXT PRIMARY KEY,
  entity                    TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  placed_at                 TEXT NOT NULL,

  -- Who bought, as the store knows them. Not a person row: most buyers
  -- are the public and will never have an account.
  buyer_ref                 TEXT NOT NULL,
  -- Frozen at the moment of sale, all three. The Association has to
  -- keep separate records of what it takes from members and from the
  -- public, and a figure that changes when somebody renews is not a
  -- record.
  buyer_type_at_sale        TEXT NOT NULL,
  membership_state_at_sale  TEXT,
  member_id_at_sale         TEXT,

  subtotal_cents            INTEGER NOT NULL,
  shipping_cents            INTEGER NOT NULL DEFAULT 0,
  -- Shipping is inside the taxable base in North Carolina, which is
  -- why this is stored rather than recomputed from the lines.
  taxable_base_cents        INTEGER NOT NULL,
  tax_jurisdiction_code     TEXT NOT NULL,
  -- Basis points, never a decimal rate. 700 is 7.00 percent.
  tax_rate_basis_points     INTEGER NOT NULL,
  tax_cents                 INTEGER NOT NULL,
  total_cents               INTEGER NOT NULL,
  currency                  TEXT NOT NULL,

  -- Only what the tax figure has to be justified by. The rest of the
  -- address belongs to the fulfilment provider, not to this module.
  ship_state                TEXT NOT NULL DEFAULT '',
  ship_county               TEXT NOT NULL DEFAULT '',
  ship_postal_code          TEXT NOT NULL DEFAULT '',

  status                    TEXT NOT NULL,
  -- The provider's session. Written before the handoff, so an order
  -- always exists before money is asked for; only a webhook may move
  -- the status to paid.
  checkout_session_ref      TEXT,
  refunded_cents            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX store_order_placed ON store_order(entity, placed_at);
CREATE INDEX store_order_status ON store_order(entity, status);
CREATE INDEX store_order_buyer ON store_order(buyer_ref);

-- Lines copy the product's name, price and treatment rather than
-- pointing at them. A receipt has to keep saying what it said on the
-- day, whatever happens to the catalogue afterwards.
CREATE TABLE order_line (
  order_id            TEXT NOT NULL REFERENCES store_order(id),
  line_no             INTEGER NOT NULL,
  sku                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  unit_price_cents    INTEGER NOT NULL,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  line_subtotal_cents INTEGER NOT NULL,
  tax_treatment       TEXT NOT NULL,
  fulfilment          TEXT NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE stock_movement (
  id          TEXT PRIMARY KEY,
  entity      TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  sku         TEXT NOT NULL,
  kind        TEXT NOT NULL,
  -- Signed by `kind`, not by the number: a negative receipt and a
  -- positive shrinkage are both nonsense and both would reconcile.
  units       INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX stock_movement_sku ON stock_movement(entity, sku, occurred_at);

-- A count is an observation, not a correction. The difference between
-- it and the running total is the finding, so neither is overwritten.
CREATE TABLE physical_count (
  id                   TEXT PRIMARY KEY,
  entity               TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  sku                  TEXT NOT NULL,
  quarter              TEXT NOT NULL,
  counted_at           TEXT NOT NULL,
  counted_by_person_id TEXT NOT NULL,
  counted_units        INTEGER NOT NULL,
  UNIQUE (entity, sku, quarter)
);

CREATE TABLE refund (
  id                    TEXT PRIMARY KEY,
  entity                TEXT NOT NULL CHECK (entity IN ('JSOA', 'JSOF')),
  order_id              TEXT NOT NULL REFERENCES store_order(id),
  amount_cents          INTEGER NOT NULL,
  -- Carried separately because the tax has to be returned to the right
  -- jurisdiction, and a refund that nets it into one figure cannot be
  -- reported.
  tax_portion_cents     INTEGER NOT NULL DEFAULT 0,
  reason                TEXT NOT NULL,
  created_by_id         TEXT NOT NULL,
  requested_at          TEXT NOT NULL,
  -- Requested and approved are different people and different
  -- timestamps. A refund approved by the person who raised it is the
  -- control failing, so the columns are separate and both are kept.
  approved_by_person_id TEXT,
  approved_at           TEXT,
  status                TEXT NOT NULL
);
CREATE INDEX refund_order ON refund(order_id);
CREATE INDEX refund_status ON refund(entity, status);
