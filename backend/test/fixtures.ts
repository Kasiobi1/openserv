import { hashCanonical, type JobSpec, type Submission } from "@atl/shared";

export const BUYER = "0x00000000000000000000000000000000000000b1";
export const HONEST = "0x00000000000000000000000000000000000000a1";
export const FAULTY = "0x00000000000000000000000000000000000000a2";

export const invoiceSchema = {
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

export function invoiceSpec(id: string, maxPrice = "10000000"): JobSpec {
  return {
    id,
    buyer: BUYER,
    task: "Extract structured fields from 20 invoices",
    outputSchema: invoiceSchema,
    completeness: {
      itemsKey: "invoices",
      expectedItemCount: 20,
      requiredFields: ["invoiceNumber", "vendor", "date", "total", "currency"],
      uniqueBy: "invoiceNumber",
    },
    maxPrice,
    stakeRequired: "0",
    verificationTier: "schema",
  };
}

export function invoices(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    invoiceNumber: `INV-${1000 + i}`,
    vendor: `Vendor ${i % 4}`,
    date: "2026-08-15",
    total: 100 + i,
    currency: "USD",
  }));
}

export function submissionFor(jobId: string, provider: string, payload: unknown): Submission {
  return { jobId, provider, payload, payloadHash: hashCanonical(payload) };
}

export const honestPayload = () => ({ invoices: invoices(20) });

export function faultyPayload() {
  const list: Record<string, unknown>[] = invoices(19); // one short
  list[3] = { ...list[3], total: "n/a" }; // wrong type
  list[5] = { ...list[5], vendor: "" }; // empty required field
  list[7] = { ...list[7], invoiceNumber: "INV-1000" }; // duplicate
  return { invoices: list };
}
