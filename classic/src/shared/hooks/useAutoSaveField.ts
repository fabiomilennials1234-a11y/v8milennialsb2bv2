import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  QueryClientContext,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Debounced auto-save for a single field/value. Skips the initial render so
 * the hook only persists *user-driven* changes — first commit lands when the
 * caller mutates the value above the hook.
 *
 * Pattern: parent owns local state for free typing; this hook watches the
 * value and fires `save(latest)` once the value has been stable for
 * `debounceMs` (default 1500ms). New keystrokes inside the window reset the
 * timer so we still issue exactly one mutation per "burst".
 *
 * On error: calls `onError` if provided, otherwise surfaces a `sonner` toast.
 * `lastError` is exposed so callers can render inline error state if they
 * want. Local value is owned by the caller, so we never mutate it back —
 * the caller decides what to do (keep the dirty value vs. roll back).
 */

export interface UseAutoSaveFieldOptions<T> {
  value: T;
  save: (value: T) => Promise<unknown>;
  debounceMs?: number;
  enabled?: boolean;
  invalidateKeys?: readonly QueryKey[];
  queryClient?: QueryClient;
  onError?: (err: unknown) => void;
}

export interface UseAutoSaveFieldResult {
  isSaving: boolean;
  lastError: Error | null;
  flush: () => Promise<void>;
  cancel: () => void;
}

export function useAutoSaveField<T>({
  value,
  save,
  debounceMs = 1500,
  enabled = true,
  invalidateKeys,
  queryClient,
  onError,
}: UseAutoSaveFieldOptions<T>): UseAutoSaveFieldResult {
  // Read context directly so the hook tolerates absence of QueryClientProvider
  // (callers outside the tree, isolated unit tests).
  const contextQc = useContext(QueryClientContext);
  const qc: QueryClient | null = queryClient ?? contextQc ?? null;

  const [isSaving, setIsSaving] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef<T>(value);
  const initialRef = useRef<T>(value);
  const hasMountedRef = useRef(false);
  // Keep callbacks fresh without re-running the effect on every render.
  const saveRef = useRef(save);
  const onErrorRef = useRef(onError);
  const invalidateRef = useRef(invalidateKeys);
  const qcRef = useRef(qc);
  saveRef.current = save;
  onErrorRef.current = onError;
  invalidateRef.current = invalidateKeys;
  qcRef.current = qc;

  const runSave = useCallback(async (toSave: T) => {
    setIsSaving(true);
    setLastError(null);
    try {
      await saveRef.current(toSave);
      const keys = invalidateRef.current;
      if (keys && qcRef.current) {
        for (const key of keys) {
          qcRef.current.invalidateQueries({ queryKey: key });
        }
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setLastError(error);
      if (onErrorRef.current) onErrorRef.current(err);
      else toast.error(error.message || "Erro ao salvar");
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Debounce effect: every value change resets the timer.
  useEffect(() => {
    latestValueRef.current = value;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      initialRef.current = value;
      return;
    }
    if (!enabled) return;
    if (Object.is(value, initialRef.current)) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSave(latestValueRef.current);
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, debounceMs, enabled, runSave]);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await runSave(latestValueRef.current);
  }, [runSave]);

  return { isSaving, lastError, flush, cancel };
}
