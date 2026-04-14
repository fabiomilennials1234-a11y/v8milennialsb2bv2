/**
 * Mock Deno global for testing _shared modules that use Deno.env.get()
 * Import this BEFORE importing any _shared module that uses Deno.
 */

if (typeof globalThis.Deno === 'undefined') {
  const envStore: Record<string, string> = {};

  (globalThis as any).Deno = {
    env: {
      get: (key: string) => envStore[key] ?? undefined,
      set: (key: string, value: string) => { envStore[key] = value; },
      delete: (key: string) => { delete envStore[key]; },
      toObject: () => ({ ...envStore }),
    },
    resolveDns: async () => [],
  };
}

export function setDenoEnv(key: string, value: string) {
  (globalThis as any).Deno.env.set(key, value);
}

export function clearDenoEnv() {
  const env = (globalThis as any).Deno.env;
  const obj = env.toObject();
  for (const key of Object.keys(obj)) {
    env.delete(key);
  }
}
