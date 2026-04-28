/**
 * usePersistedState — UI preferences persistence with TTL
 *
 * Persists UI filter/preference state to localStorage, scoped per org and user.
 * Storage key format: v8:ui:{screen}:{organizationId}:{teamMemberId}
 * Values expire after ttlMs (default 24h); expired entries are auto-cleaned.
 *
 * API is intentionally close to useState:
 *   const [value, setValue, clearValue] = usePersistedState("screen-name", defaultValue)
 *
 * Rules:
 * - Only UI filters/preferences (search, selects, toggles, viewMode, etc.)
 * - Never modals, temporary selections, mutations in flight, heavy objects
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useOrganization } from "./useOrganization";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface StorageEntry<T> {
  value: T;
  savedAt: string;
  expiresAt: string;
}

function readEntry<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StorageEntry<T>;
    if (!parsed?.expiresAt) return undefined;
    if (new Date(parsed.expiresAt) < new Date()) {
      localStorage.removeItem(key);
      return undefined;
    }
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeEntry<T>(key: string, value: T, ttlMs: number): void {
  try {
    const now = new Date();
    const entry: StorageEntry<T> = {
      value,
      savedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Silently ignore (private browsing, storage full, serialization error)
  }
}

// Same-tab cross-instance broadcast. localStorage 'storage' event only fires
// in OTHER tabs, so we use a CustomEvent to keep every usePersistedState
// instance with the same storageKey in sync within the same tab.
const PERSISTED_STATE_EVENT = "v8:persisted-state-change";

interface PersistedStateChangeDetail<T> {
  key: string;
  value: T;
}

function broadcastChange<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PersistedStateChangeDetail<T>>(PERSISTED_STATE_EVENT, {
      detail: { key, value },
    }),
  );
}

function deleteEntry(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export interface UsePersistedStateOptions {
  /** Time-to-live in milliseconds. Default: 24 hours. */
  ttlMs?: number;
  /** When false the hook behaves exactly like useState (no persistence). Default: true. */
  enabled?: boolean;
}

/**
 * useState-compatible hook that persists UI state to localStorage with TTL.
 *
 * @param screen   Unique screen identifier (e.g. "confirmacao", "propostas")
 * @param defaultValue  Initial / reset value; should be a stable reference (defined outside the component)
 * @param options  Optional: ttlMs, enabled
 * @returns [value, setValue, clearValue]
 *   - clearValue() removes the key from storage and resets to defaultValue
 */
export function usePersistedState<T>(
  screen: string,
  defaultValue: T,
  options: UsePersistedStateOptions = {}
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const { ttlMs = DEFAULT_TTL_MS, enabled = true } = options;
  const { organizationId, teamMemberId } = useOrganization();

  // Build scoped key; null while org context is loading or disabled
  const storageKey =
    enabled && organizationId
      ? `v8:ui:${screen}:${organizationId}:${teamMemberId ?? "anon"}`
      : null;

  // Stable reference to the initial default (avoids stale-closure issues in clear())
  const defaultRef = useRef(defaultValue);

  // Track which key has already been loaded so we don't overwrite in-flight changes
  const loadedKeyRef = useRef<string | null>(null);

  const [state, setStateRaw] = useState<T>(defaultValue);

  // Hydrate from storage once per storageKey (runs when org context first loads)
  useEffect(() => {
    if (!storageKey || loadedKeyRef.current === storageKey) return;
    loadedKeyRef.current = storageKey;
    const persisted = readEntry<T>(storageKey);
    if (persisted !== undefined) {
      setStateRaw(persisted);
    }
  }, [storageKey]);

  // Subscribe to same-tab broadcasts so other instances of usePersistedState
  // with the same key stay in sync (filters, preferences, etc.).
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PersistedStateChangeDetail<T>>).detail;
      if (!detail || detail.key !== storageKey) return;
      setStateRaw(detail.value);
    };
    window.addEventListener(PERSISTED_STATE_EVENT, handler);
    return () => window.removeEventListener(PERSISTED_STATE_EVENT, handler);
  }, [storageKey]);

  // Wrapped setter: updates React state + persists to localStorage atomically
  const setState: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (valueOrUpdater) => {
      setStateRaw((prev) => {
        const next =
          typeof valueOrUpdater === "function"
            ? (valueOrUpdater as (prev: T) => T)(prev)
            : valueOrUpdater;
        if (storageKey) {
          writeEntry(storageKey, next, ttlMs);
          broadcastChange(storageKey, next);
        }
        return next;
      });
    },
    [storageKey, ttlMs]
  );

  // Removes the persisted key and resets to initial default
  const clear = useCallback(() => {
    if (storageKey) {
      deleteEntry(storageKey);
      broadcastChange(storageKey, defaultRef.current);
    }
    setStateRaw(defaultRef.current);
  }, [storageKey]);

  return [state, setState, clear];
}
