// Module-local promises exist only while transport is pending. Never log keys:
// callers may include authentication credentials to isolate session lifetimes.
const pendingReads = new Map<string, Promise<unknown>>();

export function sharePendingRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const existing = pendingReads.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(read).finally(() => {
    pendingReads.delete(key);
  });
  pendingReads.set(key, pending);
  return pending;
}
