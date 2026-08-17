"use client";

import { useEffect, useState } from "react";

/** Live-updating current time (ms epoch), driven by an effect — never read `Date.now()` in render. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
