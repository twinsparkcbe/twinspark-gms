"use client";

import { useEffect, useState } from "react";

import { formatRelativeTime } from "@/lib/format";

/**
 * Renders a "3 hours ago"-style timestamp. formatRelativeTime() reads
 * Date.now(), so calling it directly during render is exactly the kind of
 * "variable input" React's hydration-mismatch warning calls out — the
 * server renders it at request time, the client re-renders it at hydration
 * time, and if those cross a minute boundary (very likely on anything but
 * an instant round trip) the text won't match.
 *
 * Same fix already used for Header's utcDate: render nothing until mounted,
 * then compute the value client-side only — hydration always sees an empty
 * match, so there's nothing to mismatch. Refreshes every 60s so a
 * long-open page doesn't go stale.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText(formatRelativeTime(iso));
    const interval = setInterval(() => setText(formatRelativeTime(iso)), 60_000);
    return () => clearInterval(interval);
  }, [iso]);

  return text;
}
