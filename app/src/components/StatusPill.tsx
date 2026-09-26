import { CheckCircle2, CircleDashed, Clock3, ShieldAlert, ShieldX, XCircle } from "lucide-react";
import type { JobStatus } from "../api";
import { STATUS } from "../format";

const ICON: Record<JobStatus, typeof CheckCircle2> = {
  created: CircleDashed,
  submitted: Clock3,
  verified: Clock3,
  released: CheckCircle2,
  slashed: ShieldX,
  rejected: ShieldAlert,
};

export function StatusPill({ status }: { status: JobStatus }) {
  const s = STATUS[status];
  const Icon = ICON[status] ?? XCircle;
  return (
    <span className={`pill pill-${s.tone}`} title={s.hint}>
      <Icon size={13} aria-hidden="true" />
      {s.label}
    </span>
  );
}
