/**
 * The store's repository against Cloudflare D1.
 *
 * Same interface as the in-memory one, same behaviour where the schema allows
 * it. Four things in `migrations/0004_store.sql` are decisions rather than
 * storage details, and this file is where they are kept or broken:
 *
 *   1. **Every amount is an integer of cents and every rate is basis points.**
 *      There is no REAL column in the migration and there is no arithmetic on
 *      money in this file at all: a figure goes to the column it came from and
 *      back, and nothing here divides, multiplies or rounds. The tax
 *      calculation lives in `tax.ts`, on integers, and the order carries the
 *      result.
 *
 *   2. **An order line copies the product, it does not join to it.** No read
 *      here resolves a line's name or price through `product`, because a
 *      receipt has to keep saying what it said on the day. The consequence is
 *      that `order_line` is written with the values the order was priced with,
 *      and a later edit to the catalogue cannot reach a sold order.
 *
 *   3. **The order and its lines are one write.** `saveOrder` goes through
 *      `atomic`, so an order never exists without its lines. Two awaits would
 *      leave an order with no lines whenever the second one failed, and nothing
 *      would ever say so.
 *
 *   4. **The sale snapshot is frozen.** `buyer_type_at_sale`,
 *      `membership_state_at_sale` and `member_id_at_sale` are written from the
 *      order as given and never recomputed from a membership record. This file
 *      has no access to one, which is the point.
 */

import {
  atomic,
  int,
  many,
  nextInSequence,
  one,
  orNull,
  text,
  toBool,
} from "../db";
import type { Entity, Role } from "../authz/model";
import type { MembershipState } from "../membership/state";

import type { OrderFilter, StoreRepository } from "./repository";
import type {
  BuyerType,
  Currency,
  Fulfilment,
  MovementKind,
  Order,
  OrderLine,
  OrderStatus,
  PhysicalCount,
  Product,
  ProductCategory,
  Refund,
  RefundStatus,
  StockMovement,
  TaxTreatment,
} from "./types";

/* ------------------------------------------------------------------ *
 * Rows, as SQLite hands them over
 * ------------------------------------------------------------------ */

type ProductRow = {
  sku: string;
  entity: string;
  name: string;
  blurb: string;
  category: string;
  price_cents: number;
  currency: string;
  publicly_purchasable: number;
  fulfilment: string;
  collection: string | null;
  tax_treatment: string;
  active: number;
};

type OrderRow = {
  id: string;
  entity: string;
  placed_at: string;
  buyer_ref: string;
  buyer_type_at_sale: string;
  membership_state_at_sale: string | null;
  member_id_at_sale: string | null;
  subtotal_cents: number;
  shipping_cents: number;
  taxable_base_cents: number;
  tax_jurisdiction_code: string;
  tax_rate_basis_points: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  ship_state: string;
  ship_county: string;
  ship_postal_code: string;
  status: string;
  checkout_session_ref: string | null;
  refunded_cents: number;
};

type OrderLineRow = {
  order_id: string;
  line_no: number;
  sku: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
  line_subtotal_cents: number;
  tax_treatment: string;
  fulfilment: string;
};

type MovementRow = {
  id: string;
  entity: string;
  sku: string;
  kind: string;
  units: number;
  occurred_at: string;
  note: string;
};

type CountRow = {
  id: string;
  entity: string;
  sku: string;
  quarter: string;
  counted_at: string;
  counted_by_person_id: string;
  counted_units: number;
};

type RefundRow = {
  id: string;
  entity: string;
  order_id: string;
  amount_cents: number;
  tax_portion_cents: number;
  reason: string;
  created_by_id: string;
  requested_at: string;
  approved_by_person_id: string | null;
  approved_at: string | null;
  status: string;
};

/* ------------------------------------------------------------------ *
 * Row to domain
 * ------------------------------------------------------------------ *
 *
 * The casts on the union-typed columns are the honest shape of a text
 * column holding a closed set. SQLite's CHECK covers `entity` and
 * nothing else, so a bad `status` would arrive here as a string the
 * domain type says cannot exist. Widening the domain types to `string`
 * to be safe would push the problem into every screen; the repository
 * is the one place that knows a row came from a table, so the cast
 * lives here and nowhere above it.
 */

function toProduct(row: ProductRow): Product {
  return {
    sku: text(row.sku),
    entity: text(row.entity) as Entity,
    name: text(row.name),
    blurb: text(row.blurb),
    category: text(row.category) as ProductCategory,
    priceCents: int(row.price_cents),
    currency: text(row.currency) as Currency,
    publiclyPurchasable: toBool(row.publicly_purchasable),
    fulfilment: text(row.fulfilment) as Fulfilment,
    collection: orNull(row.collection),
    taxTreatment: text(row.tax_treatment) as TaxTreatment,
    active: toBool(row.active),
  };
}

function toOrderLine(row: OrderLineRow): OrderLine {
  return {
    sku: text(row.sku),
    name: text(row.name),
    unitPriceCents: int(row.unit_price_cents),
    quantity: int(row.quantity),
    lineSubtotalCents: int(row.line_subtotal_cents),
    taxTreatment: text(row.tax_treatment) as TaxTreatment,
    fulfilment: text(row.fulfilment) as Fulfilment,
  };
}

function toOrder(row: OrderRow, lines: OrderLine[]): Order {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    placedAt: text(row.placed_at),
    buyerRef: text(row.buyer_ref),
    buyerTypeAtSale: text(row.buyer_type_at_sale) as BuyerType,
    membershipStateAtSale: orNull(row.membership_state_at_sale) as MembershipState | null,
    memberIdAtSale: orNull(row.member_id_at_sale),
    lines,
    subtotalCents: int(row.subtotal_cents),
    shippingCents: int(row.shipping_cents),
    taxableBaseCents: int(row.taxable_base_cents),
    taxJurisdictionCode: text(row.tax_jurisdiction_code),
    taxRateBasisPoints: int(row.tax_rate_basis_points),
    taxCents: int(row.tax_cents),
    totalCents: int(row.total_cents),
    currency: text(row.currency) as Currency,
    shipTo: {
      state: text(row.ship_state),
      county: text(row.ship_county),
      postalCode: text(row.ship_postal_code),
    },
    status: text(row.status) as OrderStatus,
    checkoutSessionRef: orNull(row.checkout_session_ref),
    refundedCents: int(row.refunded_cents),
  };
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    sku: text(row.sku),
    kind: text(row.kind) as MovementKind,
    units: int(row.units),
    occurredAt: text(row.occurred_at),
    note: text(row.note),
  };
}

function toCount(row: CountRow): PhysicalCount {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    sku: text(row.sku),
    quarter: text(row.quarter),
    countedAt: text(row.counted_at),
    countedByPersonId: text(row.counted_by_person_id),
    countedUnits: int(row.counted_units),
  };
}

function toRefund(row: RefundRow): Refund {
  return {
    id: text(row.id),
    entity: text(row.entity) as Entity,
    orderId: text(row.order_id),
    amountCents: int(row.amount_cents),
    taxPortionCents: int(row.tax_portion_cents),
    reason: text(row.reason),
    createdById: text(row.created_by_id),
    requestedAt: text(row.requested_at),
    approvedByPersonId: orNull(row.approved_by_person_id),
    approvedAt: orNull(row.approved_at),
    status: text(row.status) as RefundStatus,
  };
}

/* ------------------------------------------------------------------ *
 * The repository
 * ------------------------------------------------------------------ */

const PRODUCT_COLUMNS =
  "sku, entity, name, blurb, category, price_cents, currency, " +
  "publicly_purchasable, fulfilment, collection, tax_treatment, active";

const ORDER_COLUMNS =
  "id, entity, placed_at, buyer_ref, buyer_type_at_sale, " +
  "membership_state_at_sale, member_id_at_sale, subtotal_cents, shipping_cents, " +
  "taxable_base_cents, tax_jurisdiction_code, tax_rate_basis_points, tax_cents, " +
  "total_cents, currency, ship_state, ship_county, ship_postal_code, status, " +
  "checkout_session_ref, refunded_cents";

export class D1StoreRepository implements StoreRepository {
  constructor(private readonly db: D1Database) {}

  /* --- Products ------------------------------------------------- */

  async listProducts(entity: Entity): Promise<Product[]> {
    const rows = await many<ProductRow>(
      this.db
        .prepare(`SELECT ${PRODUCT_COLUMNS} FROM product WHERE entity = ? ORDER BY name, sku`)
        .bind(entity),
    );
    return rows.map(toProduct);
  }

  async findProduct(sku: string): Promise<Product | null> {
    const row = await one<ProductRow>(
      this.db.prepare(`SELECT ${PRODUCT_COLUMNS} FROM product WHERE sku = ?`).bind(sku),
    );
    return row ? toProduct(row) : null;
  }

  /* --- Orders --------------------------------------------------- */

  async listOrders(entity: Entity, filter: OrderFilter = {}): Promise<Order[]> {
    const where = ["entity = ?"];
    const binds: unknown[] = [entity];

    if (filter.buyerType && filter.buyerType !== "ALL") {
      where.push("buyer_type_at_sale = ?");
      binds.push(filter.buyerType);
    }
    if (filter.status) {
      where.push("status = ?");
      binds.push(filter.status);
    }
    // Inclusive from, exclusive to. The same half-open window the in-memory
    // implementation uses and the same one `reports.ts` builds periods with.
    if (filter.from) {
      where.push("placed_at >= ?");
      binds.push(filter.from);
    }
    if (filter.to) {
      where.push("placed_at < ?");
      binds.push(filter.to);
    }

    const rows = await many<OrderRow>(
      this.db
        .prepare(
          `SELECT ${ORDER_COLUMNS} FROM store_order WHERE ${where.join(" AND ")} ` +
            "ORDER BY placed_at DESC, id DESC",
        )
        .bind(...binds),
    );
    if (rows.length === 0) return [];

    const lines = await this.linesFor(rows.map((r) => r.id));
    return rows.map((row) => toOrder(row, lines.get(row.id) ?? []));
  }

  async findOrder(id: string): Promise<Order | null> {
    const row = await one<OrderRow>(
      this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM store_order WHERE id = ?`).bind(id),
    );
    if (!row) return null;
    const lines = await this.linesFor([id]);
    return toOrder(row, lines.get(id) ?? []);
  }

  /**
   * One write, or none.
   *
   * The lines are replaced rather than merged, because the order as handed in
   * is the whole order; a line that is no longer on it must not survive. The
   * order row goes first so the lines' foreign key always has something to
   * point at, and the delete sits between the two so a re-save of an order
   * with fewer lines cannot leave an orphan behind.
   */
  async saveOrder(order: Order): Promise<Order> {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO store_order (${ORDER_COLUMNS}) VALUES (` +
            "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET " +
            // The sale snapshot is absent from this list on purpose. Once an
            // order exists, buyer_type_at_sale, membership_state_at_sale and
            // member_id_at_sale are the tax record of the day it was placed,
            // and a later save must not move them.
            "subtotal_cents = excluded.subtotal_cents, " +
            "shipping_cents = excluded.shipping_cents, " +
            "taxable_base_cents = excluded.taxable_base_cents, " +
            "tax_jurisdiction_code = excluded.tax_jurisdiction_code, " +
            "tax_rate_basis_points = excluded.tax_rate_basis_points, " +
            "tax_cents = excluded.tax_cents, " +
            "total_cents = excluded.total_cents, " +
            "currency = excluded.currency, " +
            "ship_state = excluded.ship_state, " +
            "ship_county = excluded.ship_county, " +
            "ship_postal_code = excluded.ship_postal_code, " +
            "status = excluded.status, " +
            "checkout_session_ref = excluded.checkout_session_ref, " +
            "refunded_cents = excluded.refunded_cents",
        )
        .bind(
          order.id,
          order.entity,
          order.placedAt,
          order.buyerRef,
          order.buyerTypeAtSale,
          order.membershipStateAtSale,
          order.memberIdAtSale,
          order.subtotalCents,
          order.shippingCents,
          order.taxableBaseCents,
          order.taxJurisdictionCode,
          order.taxRateBasisPoints,
          order.taxCents,
          order.totalCents,
          order.currency,
          order.shipTo.state,
          order.shipTo.county,
          order.shipTo.postalCode,
          order.status,
          order.checkoutSessionRef,
          order.refundedCents,
        ),
      this.db.prepare("DELETE FROM order_line WHERE order_id = ?").bind(order.id),
    ];

    order.lines.forEach((line, index) => {
      statements.push(
        this.db
          .prepare(
            "INSERT INTO order_line (order_id, line_no, sku, name, unit_price_cents, " +
              "quantity, line_subtotal_cents, tax_treatment, fulfilment) " +
              "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            order.id,
            index + 1,
            line.sku,
            // Copied, not joined. See the note at the top of this file.
            line.name,
            line.unitPriceCents,
            line.quantity,
            line.lineSubtotalCents,
            line.taxTreatment,
            line.fulfilment,
          ),
      );
    });

    await atomic(statements);
    return order;
  }

  private async linesFor(orderIds: string[]): Promise<Map<string, OrderLine[]>> {
    const byOrder = new Map<string, OrderLine[]>();
    if (orderIds.length === 0) return byOrder;

    const placeholders = orderIds.map(() => "?").join(", ");
    const rows = await many<OrderLineRow>(
      this.db
        .prepare(
          "SELECT order_id, line_no, sku, name, unit_price_cents, quantity, " +
            "line_subtotal_cents, tax_treatment, fulfilment FROM order_line " +
            `WHERE order_id IN (${placeholders}) ORDER BY order_id, line_no`,
        )
        .bind(...orderIds),
    );
    for (const row of rows) {
      const list = byOrder.get(row.order_id);
      if (list) list.push(toOrderLine(row));
      else byOrder.set(row.order_id, [toOrderLine(row)]);
    }
    return byOrder;
  }

  /* --- Inventory ------------------------------------------------ */

  async listMovements(entity: Entity): Promise<StockMovement[]> {
    const rows = await many<MovementRow>(
      this.db
        .prepare(
          "SELECT id, entity, sku, kind, units, occurred_at, note FROM stock_movement " +
            "WHERE entity = ? ORDER BY occurred_at, id",
        )
        .bind(entity),
    );
    return rows.map(toMovement);
  }

  async saveMovement(movement: StockMovement): Promise<StockMovement> {
    await this.db
      .prepare(
        "INSERT INTO stock_movement (id, entity, sku, kind, units, occurred_at, note) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        movement.id,
        movement.entity,
        movement.sku,
        movement.kind,
        // Signed by kind, not by the number. The sign arrives decided; this
        // does not normalise it, because a negative receipt is a bug upstream
        // and silently flipping it would reconcile and hide it.
        movement.units,
        movement.occurredAt,
        movement.note,
      )
      .run();
    return movement;
  }

  async listCounts(entity: Entity): Promise<PhysicalCount[]> {
    const rows = await many<CountRow>(
      this.db
        .prepare(
          "SELECT id, entity, sku, quarter, counted_at, counted_by_person_id, " +
            "counted_units FROM physical_count WHERE entity = ? ORDER BY counted_at, id",
        )
        .bind(entity),
    );
    return rows.map(toCount);
  }

  /**
   * A count is an observation. There is no upsert here and no ON CONFLICT
   * clause: `physical_count` is UNIQUE on (entity, sku, quarter) and the
   * migration says a count is never overwritten, so a second count for the
   * same quarter is refused by the constraint rather than quietly replacing
   * the first.
   *
   * The in-memory implementation appends a second observation instead, which
   * is a real divergence rather than a shortcut: the constraint is the
   * migration's decision and papering over it with an upsert would overwrite
   * the record the migration says must not be overwritten.
   */
  async saveCount(count: PhysicalCount): Promise<PhysicalCount> {
    await this.db
      .prepare(
        "INSERT INTO physical_count (id, entity, sku, quarter, counted_at, " +
          "counted_by_person_id, counted_units) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        count.id,
        count.entity,
        count.sku,
        count.quarter,
        count.countedAt,
        count.countedByPersonId,
        count.countedUnits,
      )
      .run();
    return count;
  }

  /* --- Refunds -------------------------------------------------- */

  async listRefunds(entity: Entity): Promise<Refund[]> {
    const rows = await many<RefundRow>(
      this.db
        .prepare(
          "SELECT id, entity, order_id, amount_cents, tax_portion_cents, reason, " +
            "created_by_id, requested_at, approved_by_person_id, approved_at, status " +
            "FROM refund WHERE entity = ? ORDER BY requested_at DESC, id DESC",
        )
        .bind(entity),
    );
    return rows.map(toRefund);
  }

  async findRefund(id: string): Promise<Refund | null> {
    const row = await one<RefundRow>(
      this.db
        .prepare(
          "SELECT id, entity, order_id, amount_cents, tax_portion_cents, reason, " +
            "created_by_id, requested_at, approved_by_person_id, approved_at, status " +
            "FROM refund WHERE id = ?",
        )
        .bind(id),
    );
    return row ? toRefund(row) : null;
  }

  /**
   * `created_by_id` is never in the update list. Who raised a refund is the
   * fact the second-approver control is checked against, so an approval may
   * write `approved_by_person_id` and must not be able to rewrite the
   * requester into somebody else.
   */
  async saveRefund(refund: Refund): Promise<Refund> {
    await this.db
      .prepare(
        "INSERT INTO refund (id, entity, order_id, amount_cents, tax_portion_cents, " +
          "reason, created_by_id, requested_at, approved_by_person_id, approved_at, status) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET " +
          "amount_cents = excluded.amount_cents, " +
          "tax_portion_cents = excluded.tax_portion_cents, " +
          "reason = excluded.reason, " +
          "approved_by_person_id = excluded.approved_by_person_id, " +
          "approved_at = excluded.approved_at, " +
          "status = excluded.status",
      )
      .bind(
        refund.id,
        refund.entity,
        refund.orderId,
        refund.amountCents,
        refund.taxPortionCents,
        refund.reason,
        refund.createdById,
        refund.requestedAt,
        refund.approvedByPersonId,
        refund.approvedAt,
        refund.status,
      )
      .run();
    return refund;
  }

  /* --- Who holds the office ------------------------------------- */

  /**
   * Read-only, and out of this module's own tables: office holders live in
   * `role_grant` from `0001_identity_and_audit.sql`, which is the spine's
   * single register of who holds what. A revoked grant is excluded, because
   * this answers "who chairs the store now" and the row is kept only so an
   * old audit entry stays readable.
   */
  async personsHolding(role: Role, entity: Entity): Promise<string[]> {
    const rows = await many<{ person_id: string }>(
      this.db
        .prepare(
          "SELECT person_id FROM role_grant WHERE role = ? AND entity = ? " +
            "AND revoked_at IS NULL ORDER BY granted_at, person_id",
        )
        .bind(role, entity),
    );
    return rows.map((row) => text(row.person_id));
  }

  /**
   * `nextInSequence` rather than counting rows. Reading the highest and adding
   * one is a race two concurrent checkouts both win, and the duplicate shows
   * up later as two orders with one id.
   */
  async nextId(prefix: string): Promise<string> {
    const value = await nextInSequence(`store:${prefix}`);
    return `${prefix}-${String(value).padStart(4, "0")}`;
  }
}
