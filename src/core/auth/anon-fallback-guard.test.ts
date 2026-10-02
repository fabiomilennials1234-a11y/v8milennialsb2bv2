import { describe, it, expect, vi } from "vitest";
import { createAnonFallbackGuard, hasPersistedSupabaseSession } from "./anon-fallback-guard";

const ANON = "anon-key";
const REST = "https://x.supabase.co/rest/v1/leads?select=id";

function setup(persisted: boolean) {
  const base = vi.fn(async () => new Response("{}", { status: 200 }));
  const guarded = createAnonFallbackGuard(base as unknown as typeof fetch, {
    anonKey: ANON,
    hasPersistedSession: () => persisted,
  });
  return { base, guarded };
}

describe("createAnonFallbackGuard", () => {
  it("bloqueia como falha de rede a chamada anônima de quem tem sessão salva", async () => {
    const { base, guarded } = setup(true);
    await expect(guarded(REST, { headers: { Authorization: `Bearer ${ANON}` } })).rejects.toThrow(/failed to fetch/i);
    expect(base).not.toHaveBeenCalled();
  });

  it("vale para Edge Functions e Storage", async () => {
    const { guarded } = setup(true);
    const headers = { Authorization: `Bearer ${ANON}` };
    await expect(guarded("https://x.supabase.co/functions/v1/f", { headers })).rejects.toThrow();
    await expect(guarded("https://x.supabase.co/storage/v1/object/b/k", { headers })).rejects.toThrow();
  });

  it("deixa passar a chamada com token de usuário", async () => {
    const { base, guarded } = setup(true);
    await guarded(REST, { headers: { Authorization: "Bearer user-jwt" } });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("deixa passar anônimo quando não há sessão salva (login, páginas públicas)", async () => {
    const { base, guarded } = setup(false);
    await guarded(REST, { headers: { Authorization: `Bearer ${ANON}` } });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("nunca bloqueia o Auth, por onde a sessão se recupera", async () => {
    const { base, guarded } = setup(true);
    await guarded("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", {
      headers: { Authorization: `Bearer ${ANON}` },
    });
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe("hasPersistedSupabaseSession", () => {
  const storageOf = (entries: Record<string, string>) => {
    const keys = Object.keys(entries);
    return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null };
  };

  it("reconhece a chave do Supabase Auth com valor", () => {
    expect(hasPersistedSupabaseSession(storageOf({ "sb-abc-auth-token": "{}" }))).toBe(true);
  });
  it("ignora outras chaves e chave vazia", () => {
    expect(hasPersistedSupabaseSession(storageOf({ other: "1", "sb-abc-auth-token": "" }))).toBe(false);
  });
  it("storage que lança não afirma sessão", () => {
    const quebrado = { length: 1, key: () => { throw new Error("x"); }, getItem: () => null };
    expect(hasPersistedSupabaseSession(quebrado)).toBe(false);
  });
});
