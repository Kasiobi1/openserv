import type { JobSpec } from "@atl/shared";

export const M = 1_000_000n; // one mock token (6 decimals)

const vendors = ["Acme Ltd", "Globex", "Initech", "Umbrella Corp"];

/** Raw source records the buyer hands over (what the auditor compares the output against). */
export const sourceRecords = Array.from({ length: 20 }, (_, i) => ({
  invoiceNumber: `INV-${2000 + i}`,
  vendor: vendors[i % 4]!,
  date: "2026-08-15",
  total: 250 + i * 10,
  currency: "USD",
}));

export const sourceLines = sourceRecords.map((r) => `${r.invoiceNumber} | ${r.vendor} | ${r.date} | ${r.total} ${r.currency}`);

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

export function specFor(o: { id: string; buyer: string; maxPrice: bigint; tier: "schema" | "auditor" }): JobSpec {
  return {
    id: o.id,
    buyer: o.buyer,
    task: "Extract invoice number, vendor, date, total and currency from each of the 20 invoice records in the inputs.",
    outputSchema: schema,
    completeness: {
      itemsKey: "invoices",
      expectedItemCount: 20,
      requiredFields: ["invoiceNumber", "vendor", "date", "total", "currency"],
      uniqueBy: "invoiceNumber",
    },
    ...(o.tier === "auditor" && { inputs: sourceLines }),
    maxPrice: o.maxPrice.toString(),
    stakeRequired: (5n * M).toString(),
    verificationTier: o.tier,
  };
}

/** Correct output. */
export const honestPayload = () => ({ invoices: sourceRecords.map((r) => ({ ...r })) });

/** Structurally broken: 19 items, a wrong type, an empty field, a duplicate. Layer 1 catches this. */
export function brokenPayload() {
  const list: Record<string, unknown>[] = sourceRecords.slice(0, 19).map((r) => ({ ...r }));
  list[3] = { ...list[3], total: "n/a" };
  list[5] = { ...list[5], vendor: "" };
  list[7] = { ...list[7], invoiceNumber: "INV-2000" };
  return { invoices: list };
}

/** Passes every schema and completeness rule but contradicts the inputs. Only the semantic audit can catch this. */
export const plausibleFakePayload = () => ({
  invoices: sourceRecords.map((r, i) => ({
    ...r,
    vendor: ["Wayne Enterprises", "Stark Industries", "Hooli", "Pied Piper"][i % 4]!,
    total: r.total * 3 + 17,
    date: "2025-01-02",
  })),
});
