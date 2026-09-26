import type { SbClient } from "../src/store/supabase";

export interface Call {
  table: string;
  op: "select" | "insert" | "update";
  payload?: unknown;
  filters: { method: string; args: unknown[] }[];
}

export type Handler = (call: Call) => { data: unknown; error: { code?: string; message: string } | null };

/**
 * Minimal stand-in for the subset of the Supabase JS client this adapter uses: `.from(table)` then a chain of
 * select/insert/update/eq/ilike/order/maybeSingle, awaited directly (real supabase-js query builders are
 * thenable). Records every call so tests can assert exactly what was sent, and resolves via a caller-supplied
 * handler instead of a network request — this proves the adapter's mapping and query shape, not the live API.
 */
export class FakeSupabase implements SbClient {
  readonly calls: Call[] = [];
  constructor(private readonly handler: Handler) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any {
    const call: Call = { table, op: "select", filters: [] };
    this.calls.push(call);
    const chain = {
      select: () => { call.op = "select"; return chain; },
      insert: (payload: unknown) => { call.op = "insert"; call.payload = payload; return chain; },
      update: (payload: unknown) => { call.op = "update"; call.payload = payload; return chain; },
      eq: (...args: unknown[]) => { call.filters.push({ method: "eq", args }); return chain; },
      ilike: (...args: unknown[]) => { call.filters.push({ method: "ilike", args }); return chain; },
      order: (...args: unknown[]) => { call.filters.push({ method: "order", args }); return chain; },
      maybeSingle: () => Promise.resolve(this.handler(call)),
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => resolve(this.handler(call)),
    };
    return chain;
  }
}
