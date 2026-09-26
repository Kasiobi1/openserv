import type { Check } from "../api";
import { Check as CheckIcon, X } from "lucide-react";
import { checkLabel, fmtAmount } from "../format";

/** Backend details quote raw token units; show them as amounts. Only long bare integers are touched (not hashes). */
const humanize = (detail: string, decimals?: number) =>
  decimals === undefined ? detail : detail.replace(/(?<![\w.])\d{7,}(?![\w.])/g, (m) => fmtAmount(m, decimals));

export function CheckList({ checks, onlyFailed = false, decimals }: { checks: Check[]; onlyFailed?: boolean; decimals?: number }) {
  const shown = onlyFailed ? checks.filter((c) => !c.passed) : checks;
  if (shown.length === 0) return null;
  return (
    <ul className="checks">
      {shown.map((c) => (
        <li key={c.name} className={c.passed ? "ok" : "no"}>
          <span className="mark" aria-label={c.passed ? "passed" : "failed"}>{c.passed ? <CheckIcon size={15} /> : <X size={15} />}</span>
          <span>
            <span className="check-name">{checkLabel(c.name)}</span>
            <span className="check-detail">{humanize(c.detail, decimals)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
