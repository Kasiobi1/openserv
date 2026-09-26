import { stubRails } from "./stub";
import type { PaymentRail, RailId } from "./types";

export class RailRegistry {
  private rails = new Map<RailId, PaymentRail>();

  constructor(rails: PaymentRail[] = []) {
    for (const r of rails) this.register(r);
  }

  register(rail: PaymentRail) {
    this.rails.set(rail.id, rail);
  }

  get(id: RailId): PaymentRail {
    const r = this.rails.get(id);
    if (!r) throw new Error(`unknown rail "${id}"`);
    return r;
  }

  /** Like get(), but refuses placeholders. Use when wiring a rail into the settlement path. */
  getImplemented(id: RailId): PaymentRail {
    const r = this.get(id);
    if (!r.implemented) throw new Error(`rail "${id}" is a placeholder and cannot be used yet`);
    return r;
  }

  list() {
    return [...this.rails.values()].map((r) => ({ id: r.id, implemented: r.implemented }));
  }
}

export const withStubs = (implemented: PaymentRail[]) => new RailRegistry([...stubRails(), ...implemented]);
