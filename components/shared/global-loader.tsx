"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { FullScreenLoader } from "./full-screen-loader";

interface GlobalLoaderContextValue {
  /** True whenever at least one tracked operation is in flight. */
  isLoading: boolean;
  /** Marks one operation as started/finished. Prefer runWithLoader() below —
   * these are exposed for the rare case a start/stop pair can't be expressed
   * as a single awaited call. */
  startLoading: () => void;
  stopLoading: () => void;
  /** Wraps any async call: shows the overlay for its duration and always
   * hides it again — even if it throws — via finally. This is what every
   * table refetch, dialog submit, and page action should use. */
  runWithLoader: <T,>(fn: () => Promise<T>) => Promise<T>;
}

const GlobalLoaderContext = createContext<GlobalLoaderContextValue | null>(null);

export function GlobalLoaderProvider({ children }: { children: React.ReactNode }) {
  // Ref-counted rather than a single boolean — several loads can legitimately
  // overlap (e.g. a table refetch and a stats refresh firing together from
  // the same filter change), and the overlay must stay up until every one of
  // them has finished, not just the first to resolve.
  const countRef = useRef(0);
  const [isLoading, setIsLoading] = useState(false);

  const startLoading = useCallback(() => {
    countRef.current += 1;
    setIsLoading(true);
  }, []);

  const stopLoading = useCallback(() => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current === 0) setIsLoading(false);
  }, []);

  const runWithLoader = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      startLoading();
      try {
        return await fn();
      } finally {
        stopLoading();
      }
    },
    [startLoading, stopLoading]
  );

  const value = useMemo(
    () => ({ isLoading, startLoading, stopLoading, runWithLoader }),
    [isLoading, startLoading, stopLoading, runWithLoader]
  );

  return (
    <GlobalLoaderContext.Provider value={value}>
      {children}
      {isLoading && <FullScreenLoader />}
    </GlobalLoaderContext.Provider>
  );
}

export function useGlobalLoader(): GlobalLoaderContextValue {
  const ctx = useContext(GlobalLoaderContext);
  if (!ctx) throw new Error("useGlobalLoader must be used within a GlobalLoaderProvider");
  return ctx;
}
