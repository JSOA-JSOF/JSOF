/**
 * The reads and writes this module needs, and an in-memory implementation
 * backed by the seed. Persistence is deferred by design; swapping to Prisma
 * later should be one new file implementing this interface.
 *
 * Nothing in here authorizes anything. Authorization is in `board.ts`, which
 * is the layer the routes call, so a repository method can never be the thing
 * that decided somebody was allowed to read an order.
 */

import type { Entity, Role } from "../authz/model";
import type { RoleAssignment } from "../authz/policy";

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
  listProducts(entity: Entity): Product[];
  findProduct(sku: string): Product | null;

  listOrders(entity: Entity, filter?: OrderFilter): Order[];
  findOrder(id: string): Order | null;
  saveOrder(order: Order): Order;

  listMovements(entity: Entity): StockMovement[];
  saveMovement(movement: StockMovement): StockMovement;

  listCounts(entity: Entity): PhysicalCount[];
  saveCount(count: PhysicalCount): PhysicalCount;

  listRefunds(entity: Entity): Refund[];
  findRefund(id: string): Refund | null;
  saveRefund(refund: Refund): Refund;

  /**
   * Who is recorded as holding a role, for display. The separation-of-duties
   * check itself reads the signed-in subject's own assignments, not this.
   */
  personsHolding(role: Role, entity: Entity): string[];

  nextId(prefix: string): string;
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

  listProducts(entity: Entity): Product[] {
    return this.products.filter((p) => p.entity === entity).map((p) => ({ ...p }));
  }

  findProduct(sku: string): Product | null {
    const found = this.products.find((p) => p.sku === sku);
    return found ? { ...found } : null;
  }

  listOrders(entity: Entity, filter: OrderFilter = {}): Order[] {
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

  findOrder(id: string): Order | null {
    const found = this.orders.find((o) => o.id === id);
    return found ? { ...found, lines: found.lines.map((l) => ({ ...l })) } : null;
  }

  saveOrder(order: Order): Order {
    const index = this.orders.findIndex((o) => o.id === order.id);
    if (index >= 0) this.orders[index] = order;
    else this.orders.push(order);
    return order;
  }

  listMovements(entity: Entity): StockMovement[] {
    return this.movements.filter((m) => m.entity === entity).map((m) => ({ ...m }));
  }

  saveMovement(movement: StockMovement): StockMovement {
    this.movements.push(movement);
    return movement;
  }

  listCounts(entity: Entity): PhysicalCount[] {
    return this.counts.filter((c) => c.entity === entity).map((c) => ({ ...c }));
  }

  saveCount(count: PhysicalCount): PhysicalCount {
    this.counts.push(count);
    return count;
  }

  listRefunds(entity: Entity): Refund[] {
    return this.refunds
      .filter((r) => r.entity === entity)
      .map((r) => ({ ...r }))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  findRefund(id: string): Refund | null {
    const found = this.refunds.find((r) => r.id === id);
    return found ? { ...found } : null;
  }

  saveRefund(refund: Refund): Refund {
    const index = this.refunds.findIndex((r) => r.id === refund.id);
    if (index >= 0) this.refunds[index] = refund;
    else this.refunds.push(refund);
    return refund;
  }

  personsHolding(role: Role, entity: Entity): string[] {
    return Object.entries(this.assignments)
      .filter(([, list]) => list.some((a) => a.role === role && a.entity === entity))
      .map(([personId]) => personId);
  }

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(4, "0")}`;
  }
}

/**
 * One instance for the demo. Writes made through the UI last until the dev
 * server restarts, which is the right amount of persistence for a walkthrough
 * and is honest about being a stub.
 */
/**
 * Held on `globalThis` rather than in a module variable. A server action and
 * the page it redirects to are bundled separately, so a module-level singleton
 * gives each of them its own copy and an order written by the action is not
 * found by the page. Dev-mode hot reloads have the same effect. Once this is a
 * real database the problem disappears with the variable.
 */
const SINGLETON_KEY = "__jsoaStoreRepository";

type WithRepo = typeof globalThis & { [SINGLETON_KEY]?: StoreRepository };

export function storeRepository(): StoreRepository {
  const scope = globalThis as WithRepo;
  if (!scope[SINGLETON_KEY]) scope[SINGLETON_KEY] = new InMemoryStoreRepository();
  return scope[SINGLETON_KEY];
}

/** Tests want a clean one. */
export function freshStoreRepository(): StoreRepository {
  return new InMemoryStoreRepository();
}
