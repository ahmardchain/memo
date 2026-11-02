"use client";

import { useCallback, useState } from "react";
import { useToast } from "./Toast";

/** Wraps an async action with busy + error state and a success toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      setError(null);
      try {
        const r = await fn();
        if (success) toast(success);
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg.replace(/^.*Smart contract panicked: /, ""));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, error, run, setError };
}
