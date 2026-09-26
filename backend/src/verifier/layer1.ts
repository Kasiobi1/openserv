import Ajv from "ajv";
import addFormats from "ajv-formats";
import { hashCanonical, type CheckResult, type JobSpec, type Submission } from "@atl/shared";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function extractItems(payload: unknown, itemsKey?: string): unknown[] | null {
  const holder = itemsKey ? (payload as Record<string, unknown> | null)?.[itemsKey] : payload;
  return Array.isArray(holder) ? holder : null;
}

/**
 * Deterministic checks only. No model is involved, and nothing here can be talked out of a verdict.
 * Every check runs (no early exit) so the report explains all failures at once.
 */
export function runLayer1(spec: JobSpec, submission: Submission): { passed: boolean; checks: CheckResult[] } {
  const checks: CheckResult[] = [];

  // 1. The hash the provider committed on-chain must match the payload we were actually given.
  const actual = hashCanonical(submission.payload);
  const hashOk = actual.toLowerCase() === submission.payloadHash.toLowerCase();
  checks.push({
    name: "payload_hash_matches",
    passed: hashOk,
    detail: hashOk ? "payload hash matches committed hash" : `committed ${submission.payloadHash}, computed ${actual}`,
  });

  // 2. JSON Schema validation.
  try {
    const validate = ajv.compile(spec.outputSchema);
    const valid = validate(submission.payload);
    const errs = (validate.errors ?? []).slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}`);
    checks.push({
      name: "schema_valid",
      passed: valid === true,
      detail: valid ? "payload satisfies output schema" : `schema errors: ${errs.join("; ")}`,
    });
  } catch (e) {
    checks.push({ name: "schema_valid", passed: false, detail: `output schema could not be compiled: ${(e as Error).message}` });
  }

  // 3. Completeness rules (optional per job).
  const c = spec.completeness;
  if (c) {
    const items = extractItems(submission.payload, c.itemsKey);
    if (!items) {
      checks.push({
        name: "items_present",
        passed: false,
        detail: c.itemsKey ? `payload.${c.itemsKey} is not an array` : "payload is not an array",
      });
    } else {
      checks.push({
        name: "item_count",
        passed: items.length === c.expectedItemCount,
        detail: `expected ${c.expectedItemCount} items, got ${items.length}`,
      });

      if (c.requiredFields.length > 0) {
        const bad: string[] = [];
        items.forEach((item, i) => {
          for (const f of c.requiredFields) {
            const v = item && typeof item === "object" ? (item as Record<string, unknown>)[f] : undefined;
            if (isEmpty(v)) bad.push(`#${i}.${f}`);
          }
        });
        checks.push({
          name: "required_fields",
          passed: bad.length === 0,
          detail: bad.length === 0 ? "all required fields populated" : `missing/empty: ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? ` (+${bad.length - 8} more)` : ""}`,
        });
      }

      if (c.uniqueBy) {
        const seen = new Set<string>();
        const dupes = new Set<string>();
        for (const item of items) {
          const v = (item as Record<string, unknown> | null)?.[c.uniqueBy];
          if (isEmpty(v)) continue;
          const key = String(v);
          if (seen.has(key)) dupes.add(key);
          seen.add(key);
        }
        checks.push({
          name: "unique_items",
          passed: dupes.size === 0,
          detail: dupes.size === 0 ? `all ${c.uniqueBy} values unique` : `duplicate ${c.uniqueBy}: ${[...dupes].slice(0, 5).join(", ")}`,
        });
      }
    }
  }

  return { passed: checks.every((k) => k.passed), checks };
}
