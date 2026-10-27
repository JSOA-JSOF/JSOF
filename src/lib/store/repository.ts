/**
 * The reads and writes this module needs, the in-memory implementation backed
 * by the seed, and the choice between that and D1.
 *
 * Every method returns a Promise. That is not decoration: D1 is async, and the
 * interface used to be synchronous, so the whole module above this file had to
 * learn to wait. The in-memory implementation is still here and still backed by
 * the seed, because it is what the test suite runs against and what keeps the
 * suite fast; it is now async and otherwise unchanged.
 *
 * Nothing in here authorizes anything. Authorization is in `board.ts`, which
 * is the layer the routes call, so a repository method can never be the thing
 * that decided somebody was allowed to read an order.
 */

import type { Entity, Role } from "../authz/model";
import type { RoleAssignment } from "../authz/policy";
import { database } from "../db";

import { D1StoreRepository } from "./repository.d1";
import {
  SEED_BOARD_ASSIGNMENTS,
  SEED_COUNTS,
  SEED_MOVEMENTS,
  SEED_ORDERS,
  SEED_PRODUCTS,
  SEED_REFUNDS,
} from "./seed";
import type {
  BuyerType,
  Order,
  PhysicalCount,
  Product,
  Refund,
  StockMovement,
} from "./types";

export type OrderFilter = {
  buyerType?: BuyerType | "ALL";
  status?: Order["status"];
  from?: string;
  to?: string;
};

export interface StoreRepository {
  listProducts(entity: Entity): Promise<Product[]>;
  findProduct(sku: string): Promise<Product | null>;

  listOrders(entity: Entity, filter?: OrderFilter): Promise<Order[]>;
  findOrder(id: string): Promise<Order | null>;
  saveOrder(order: Order): Promise<Order>;

  listMovements(entity: Entity): Promise<StockMovement[]>;
  saveMovement(movement: StockMovement): Promise<StockMovement>;

  listCounts(entity: Entity): Promise<PhysicalCount[]>;
  saveCount(count: PhysicalCount): Promise<PhysicalCount>;

  listRefunds(entity: Entity): Promise<Refund[]>;
  findRefund(id: string): Promise<Refund | null>;
  saveRefund(refund: Refund): Promise<Refund>;

  /**
   * Who is recorded as holding a role, for display. The separation-of-duties
   * check itself reads the signed-in subject's own assignments, not this.
   */
  personsHolding(role: Role, entity: Entity): Promise<string[]>;

  nextId(prefix: string): Promise<string>;
}

export class InMemoryStoreRepository implements StoreRepository {
  private products: Product[];
  private orders: Order[];
  private movements: StockMovement[];
  private counts: PhysicalCount[];
  private refunds: Refund[];
  private assignments: Record<string, RoleAssignment[]>;
  private sequence = 0;

  constructor() {
    this.products = SEED_PRODUCTS.map((p) => ({ ...p }));
    this.orders = SEED_ORDERS.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) }));
    this.movements = SEED_MOVEMENTS.map((m) => ({ ...m }));
    this.counts = SEED_COUNTS.map((c) => ({ ...c }));
    this.refunds = SEED_REFUNDS.map((r) => ({ ...r }));
    this.assignments = structuredClone(SEED_BOARD_ASSIGNMENTS);
  }

  async listProducts(entity: Entity): Promise<Product[]> {
    return this.products.filter((p) => p.entity === entity).map((p) => ({ ...p }));
  }

  async findProduct(sku: string): Promise<Product | null> {
    const found = this.products.find((p) => p.sku === sku);
    return found ? { ...found } : null;
  }

  async listOrders(entity: Entity, filter: OrderFilter = {}): Promise<Order[]> {
    return this.orders
      .filter((o) => o.entity === entity)
      .filter((o) =>
        filter.buyerType && filter.buyerType !== "ALL"
          ? o.buyerTypeAtSale === filter.buyerType
          : true,
      )
      .filter((o) => (filter.status ? o.status === filter.status : true))
      .filter((o) => (filter.from ? o.placedAt >= filter.from : true))
      .filter((o) => (filter.to ? o.placedAt < filter.to : true))
      .map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) }))
      .sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  }

  async findOrder(id: string): Promise<Order | null> {
    const found = this.orders.find((o) => o.id === id);
    return found ? { ...found, lines: found.lines.map((l) => ({ ...l })) } : null;
  }

  async saveOrder(order: Order): Promise<Order> {
    const index = this.orders.findIndex((o) => o.id === order.id);
    if (index >= 0) this.orders[index] = order;
    else this.orders.push(order);
    return order;
  }

  async listMovements(entity: Entity): Promise<StockMovement[]> {
    return this.movements.filter((m) => m.entity === entity).map((m) => ({ ...m }));
  }

  async saveMovement(movement: StockMovement): Promise<StockMovement> {
    this.movements.push(movement);
    return movement;
  }

  async listCounts(entity: Entity): Promise<PhysicalCount[]> {
    return this.counts.filter((c) => c.entity === entity).map((c) => ({ ...c }));
  }

  async saveCount(count: PhysicalCount): Promise<PhysicalCount> {
    this.counts.push(count);
    return count;
  }

  async listRefunds(entity: Entity): Promise<Refund[]> {
    return this.refunds
      .filter((r) => r.entity === entity)
      .map((r) => ({ ...r }))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  async findRefund(id: string): Promise<Refund | null> {
    const found = this.refunds.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  async saveRefund(refund: Refund): Promise<Refund> {
    const index = this.refunds.findIndex((r) => r.id === refund.id);
    if (index >= 0) this.refunds[index] = refund;
    else this.refunds.push(refund);
    return refund;
  }

  async personsHolding(role: Role, entity: Entity): Promise<string[]> {
    return Object.entries(this.assignments)
      .filter(([, list]) => list.some((a) => a.role === role && a.entity === entity))
      .map(([personId]) => personId);
  }

  async nextId(prefix: string): Promise<string> {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(4, "0")}`;
  }
}

/**
 * Held on `globalThis` rather than in a module variable. A server action and
 * the page it redirects to are bundled separately, so a module-level singleton
 * gives each of them its own copy and an order written by the action is not
 * found by the page. Dev-mode hot reloads have the same effect. With a real
 * database behind the binding the problem disappears; without one, this is
 * still what makes a walkthrough hang together.
 */
const SINGLETON_KEY = "__jsoaStoreRepository";

type WithRepo = typeof globalThis & { [SINGLETON_KEY]?: StoreRepository };

function inMemorySingleton(): StoreRepository {
  const scope = globalThis as WithRepo;
  if (!scope[SINGLETON_KEY]) scope[SINGLETON_KEY] = new InMemoryStoreRepository();
  return scope[SINGLETON_KEY];
}

/* ------------------------------------------------------------------ *
 * Choosing the implementation
 * ------------------------------------------------------------------ *
 *
 * D1 when there is a binding, the seed when there is not. The decision
 * is made per call rather than cached, because the binding belongs to
 * the request and a decision cached across requests is a decision made
 * for somebody else.
 *
 * `database()` returning null is a normal state, not an error: `next
 * dev` with no Worker behind it has no binding, and the test runner has
 * no Cloudflare context at all. Both land on the seed.
 */
export function storeRepository(): StoreRepository {
  const db = database();
  if (db) return new D1StoreRepository(db);
  return inMemorySingleton();
}

/** Tests want a clean one. Always the seed, never the database. */
export function freshStoreRepository(): StoreRepository {
  return new InMemoryStoreRepository();
}
