import { useCountUp } from "../hooks/useCountUp";

/** Animates between values; formats with `format` (defaults to a plain integer). */
export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const shown = useCountUp(value);
  return <>{format ? format(shown) : shown}</>;
}
