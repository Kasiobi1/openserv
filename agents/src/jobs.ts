import type { JobSpec } from "@atl/shared";
import { makeInvoices } from "./invoices";

export const TOKEN = 1_000_000n; // one mock token (6 decimals)

const schema = {
  type: "object",
  required: ["invoices"],
  properties: {
    invoices: {
      type: "array",
      items: {
        type: "object",
        required: ["invoiceNumber", "vendor", "date", "total", "currency"],
        properties: {
          invoiceNumber: { type: "string" },
          vendor: { type: "string" },
          date: { type: "string", format: "date" },
          total: { type: "number" },
          currency: { type: "string", minLength: 3, maxLength: 3 },
        },
      },
    },
  },
};

/** The buyer's job. Money terms (price, stake, tier) are set by deterministic code, never by a model. */
export function invoiceJob(o: { id: string; buyer: string; price: bigint; stake: bigint; tier: "schema" | "auditor"; count?: number }) {
  const count = o.count ?? 20;
  const { truth, texts } = makeInvoices(count);
  const spec: JobSpec = {
    id: o.id,
    buyer: o.buyer,
    task: `Extract invoiceNumber, vendor, date (YYYY-MM-DD), total (number) and currency (ISO code) from each of the ${count} invoice texts in the inputs.`,
    outputSchema: schema,
    completeness: {
      itemsKey: "invoices",
      expectedItemCount: count,
      requiredFields: ["invoiceNumber", "vendor", "date", "total", "currency"],
      uniqueBy: "invoiceNumber",
    },
    inputs: texts,
    maxPrice: o.price.toString(),
    stakeRequired: o.stake.toString(),
    verificationTier: o.tier,
  };
  return { spec, truth };
}
