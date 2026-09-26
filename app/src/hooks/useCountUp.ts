import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Animates a number from its previous value to `value` over `ms`. Jumps instantly on first render
 * (nothing to animate from) and whenever the viewer prefers reduced motion.
 */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      prev.current = value;
      return;
    }
    const from = prev.current;
    prev.current = value;
    if (from === value || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) * (1 - t);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);

  return shown;
}
