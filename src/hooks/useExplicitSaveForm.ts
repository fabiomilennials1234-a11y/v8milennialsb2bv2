import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Explicit-save form helper for sections where multiple fields must commit
 * together (meeting date + status, orçamento items + total + status, etc).
 *
 * Tracks dirty state by shallow JSON comparison against the latest baseline,
 * so reverting a single field back to its initial value also clears dirty.
 * `save()` calls the mutation with the current state and adopts the saved
 * state as the new baseline on success. `cancel()` rolls back to baseline.
 * `reset(next)` adopts a fresh baseline — call this after refetch to keep
 * the form in sync with server data.
 *
 * On error: surfaces `sonner` toast, keeps state intact so the user does
 * not lose their edits, exposes `lastError`. Caller can also `await save()`
 * and `.catch()` to react locally.
 */

export interface UseExplicitSaveFormOptions<T> {
  initial: T;
  save: (value: T) => Promise<unknown>;
  isEqual?: (a: T, b: T) => boolean;
}

export interface UseExplicitSaveFormResult<T> {
  state: T;
  setState: (next: T | ((prev: T) => T)) => void;
  dirty: boolean;
  save: () => Promise<void>;
  cancel: () => void;
  reset: (next: T) => void;
  isPending: boolean;
  lastError: Error | null;
}

const defaultEqual = <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

export function useExplicitSaveForm<T>({
  initial,
  save,
  isEqual = defaultEqual,
}: UseExplicitSaveFormOptions<T>): UseExplicitSaveFormResult<T> {
  const [baseline, setBaseline] = useState<T>(initial);
  const [state, setStateRaw] = useState<T>(initial);
  const [isPending, setIsPending] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);

  const saveRef = useRef(save);
  saveRef.current = save;
  const equalRef = useRef(isEqual);
  equalRef.current = isEqual;

  const dirty = !equalRef.current(state, baseline);

  const setState = useCallback((next: T | ((prev: T) => T)) => {
    setStateRaw((prev) => (typeof next === "function" ? (next as (p: T) => T)(prev) : next));
  }, []);

  const doSave = useCallback(async () => {
    setIsPending(true);
    setLastError(null);
    const snapshot = state;
    try {
      await saveRef.current(snapshot);
      setBaseline(snapshot);
      setIsPending(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setLastError(error);
      setIsPending(false);
      toast.error(error.message || "Erro ao salvar");
      throw error;
    }
  }, [state]);

  const cancel = useCallback(() => {
    setStateRaw((prev) => baseline);
    setLastError(null);
  }, [baseline]);

  const reset = useCallback((next: T) => {
    setBaseline(next);
    setStateRaw(next);
    setLastError(null);
  }, []);

  return { state, setState, dirty, save: doSave, cancel, reset, isPending, lastError };
}
