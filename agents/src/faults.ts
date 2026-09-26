import type { Invoice } from "./invoices";

/**
 * Deliberate sabotage for the "faulty provider" demo, applied by plain code AFTER the model has extracted.
 *  broken: structurally wrong (dropped item, wrong type, empty field, duplicate). Layer 1 catches it.
 *  fake:   passes every schema rule but contradicts the source. Only the semantic audit can catch it.
 */
export type Fault = "broken" | "fake";

const FAKE_VENDORS = ["Wayne Enterprises", "Stark Industries", "Hooli", "Pied Piper"];

export function applyFault(payload: { invoices: Invoice[] }, fault: Fault): unknown {
  const items: Record<string, unknown>[] = payload.invoices.map((x) => ({ ...x }));
  if (fault === "broken") {
    items.pop();
    if (items[3]) items[3].total = "n/a";
    if (items[5]) items[5].vendor = "";
    if (items[7] && items[0]) items[7].invoiceNumber = items[0].invoiceNumber;
    return { invoices: items };
  }
  return {
    invoices: items.map((x, i) => ({ ...x, vendor: FAKE_VENDORS[i % FAKE_VENDORS.length], total: Math.round(Number(x.total) * 300 + 1700) / 100, date: "2025-01-02" })),
  };
}
