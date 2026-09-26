import { describe, expect, it } from "vitest";
import { hashCanonical } from "@atl/shared";
import { runLayer1 } from "../src/verifier/layer1";
import { faultyPayload, honestPayload, invoiceSpec, HONEST, submissionFor } from "./fixtures";

const spec = invoiceSpec("j1");
const failed = (r: ReturnType<typeof runLayer1>) => r.checks.filter((c) => !c.passed).map((c) => c.name);

describe("verifier layer 1", () => {
  it("passes a complete, valid payload", () => {
    const r = runLayer1(spec, submissionFor("j1", HONEST, honestPayload()));
    expect(r.passed).toBe(true);
    expect(failed(r)).toEqual([]);
  });

  it("reports every failure of a faulty payload, not just the first", () => {
    const r = runLayer1(spec, submissionFor("j1", HONEST, faultyPayload()));
    expect(r.passed).toBe(false);
    expect(failed(r)).toEqual(expect.arrayContaining(["schema_valid", "item_count", "required_fields", "unique_items"]));
  });

  it("fails when the payload does not match the committed hash", () => {
    const sub = submissionFor("j1", HONEST, honestPayload());
    const tampered = { ...sub, payload: { invoices: [] } };
    expect(failed(runLayer1(spec, tampered))).toContain("payload_hash_matches");
  });

  it("fails cleanly when the items container is missing", () => {
    const payload = { rows: [] };
    const r = runLayer1(spec, { jobId: "j1", provider: HONEST, payload, payloadHash: hashCanonical(payload) });
    expect(failed(r)).toEqual(expect.arrayContaining(["schema_valid", "items_present"]));
  });

  it("fails (does not throw) on an uncompilable schema", () => {
    const bad = { ...spec, outputSchema: { type: "not-a-type" } };
    const r = runLayer1(bad, submissionFor("j1", HONEST, honestPayload()));
    expect(r.passed).toBe(false);
  });
});
