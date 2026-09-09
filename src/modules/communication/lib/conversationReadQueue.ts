// Order personal read/unread writes even when the user reopens during a slow request.
const pending = new Map<string, Promise<unknown>>();
export function queueConversationReadChange<T>(key: string, write: () => PromiseLike<T>): Promise<T> {
  const result = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(write);
  pending.set(key, result);
  const cleanup = () => { if (pending.get(key) === result) pending.delete(key); };
  void result.then(cleanup, cleanup);
  return result;
}
