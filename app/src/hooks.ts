import { useEffect, useRef, useState } from "react";

const reduceMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Tweens an integer display value toward `value` whenever it changes. Shows the real value immediately on first mount. */
export function useAnimatedNumber(value: number, ms = 650): number {
  const [shown, setShown] = useState(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      setShown(value);
      return;
    }
    if (reduceMotion() || value === shown) {
      setShown(value);
      return;
    }
    const from = shown;
    const delta = value - from;
    const start = performance.now();
    let raf: number;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - (1 - p) * (1 - p); // ease-out
      setShown(Math.round(from + delta * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return shown;
}

/** True for `ms` right after `value` changes (never on first mount). For flashing a row/card when real data changes. */
export function useJustChanged<T>(value: T, ms = 1400): boolean {
  const [flash, setFlash] = useState(false);
  const prev = useRef(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      prev.current = value;
      return;
    }
    if (value !== prev.current) {
      prev.current = value;
      if (!reduceMotion()) {
        setFlash(true);
        const t = setTimeout(() => setFlash(false), ms);
        return () => clearTimeout(t);
      }
    }
  }, [value, ms]);

  return flash;
}
