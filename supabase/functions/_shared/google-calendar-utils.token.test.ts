/**
 * Testes de `getValidAccessToken` — reuso do access token do Google (perf F5c).
 *
 * Antes: TODA leitura de agenda renovava o token no Google e fazia UPDATE em
 * `google_calendar_tokens` (em série por dono no GET de eventos), o que custava
 * ~1,7% do tempo do banco e disputa de lock na mesma linha.
 *
 * O que importa aqui, em ordem de risco:
 *   1. Token em cache e longe de vencer → zero chamada ao Google, zero UPDATE.
 *   2. Token perto de vencer (dentro da margem) ou vencido → renova e grava.
 *   3. Reconexão (callback grava refresh token novo com nonce novo) INVALIDA o
 *      cache — senão reaproveitaríamos o access token da concessão anterior.
 *   4. Coluna de cache ausente (migration ainda não aplicada) → comportamento
 *      antigo, sem quebrar: a edge fn pode subir antes da migration.
 *   5. Cache ilegível (corrompido, chave trocada) → renova em vez de falhar.
 */

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@^1.0.0";

// A chave é lida no carregamento do módulo — precisa existir antes do import.
Deno.env.set("GOOGLE_CALENDAR_ENCRYPTION_KEY", "00".repeat(32));
const { getValidAccessToken, encryptToken, ACCESS_TOKEN_REUSE_MARGIN_MS } = await import(
  "./google-calendar-utils.ts"
);

const USER = "11111111-1111-1111-1111-111111111111";
const AGORA = Date.parse("2026-10-19T12:00:00.000Z");

type Row = Record<string, unknown>;

interface FakeOpts {
  /** Simula a coluna `access_token_cache` ainda inexistente no banco. */
  semColunaDeCache?: boolean;
}

function fakeSupabase(row: Row | null, opts: FakeOpts = {}) {
  const updates: Row[] = [];
  const client = {
    updates,
    from(table: string) {
      assertEquals(table, "google_calendar_tokens");
      return {
        select() {
          const chain = {
            eq: () => chain,
            maybeSingle: () => {
              if (!row) return Promise.resolve({ data: null, error: null });
              const visivel = { ...row };
              if (opts.semColunaDeCache) delete visivel.access_token_cache;
              return Promise.resolve({ data: visivel, error: null });
            },
          };
          return chain;
        },
        update(patch: Row) {
          return {
            eq: () => {
              if (opts.semColunaDeCache && "access_token_cache" in patch) {
                return Promise.resolve({
                  data: null,
                  error: { code: "PGRST204", message: "column not found in schema cache" },
                });
              }
              updates.push(patch);
              if (row) Object.assign(row, patch);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
  return client;
}

async function linhaConectada(): Promise<Row> {
  const rt = await encryptToken("refresh-token-1");
  return {
    user_id: USER,
    google_email: "dono@empresa.com",
    encrypted_refresh_token: rt.encrypted,
    encryption_nonce: rt.nonce,
    is_active: true,
    access_token_cache: null,
  };
}

function refreshFake(token = "access-novo", expiresIn = 3600) {
  const chamadas: string[] = [];
  const fn = (refreshToken: string) => {
    chamadas.push(refreshToken);
    return Promise.resolve({ access_token: token, expires_in: expiresIn });
  };
  return { fn, chamadas };
}

Deno.test("sem cache → renova no Google, grava cache e devolve o token novo", async () => {
  const row = await linhaConectada();
  const sb = fakeSupabase(row);
  const refresh = refreshFake();

  const r = await getValidAccessToken(USER, sb as never, { now: () => AGORA, refresh: refresh.fn });

  assertEquals(r, { accessToken: "access-novo", googleEmail: "dono@empresa.com" });
  assertEquals(refresh.chamadas, ["refresh-token-1"]);
  assertEquals(sb.updates.length, 1);
  assert(typeof sb.updates[0].access_token_cache === "string");
  assertEquals(sb.updates[0].access_token_expires_at, new Date(AGORA + 3600_000).toISOString());
  // O cache nunca guarda o token em claro.
  assert(!String(sb.updates[0].access_token_cache).includes("access-novo"));
});

Deno.test("cache válido → zero chamada ao Google e zero UPDATE", async () => {
  const row = await linhaConectada();
  const sb = fakeSupabase(row);
  const primeiro = refreshFake("access-1");
  await getValidAccessToken(USER, sb as never, { now: () => AGORA, refresh: primeiro.fn });

  const segundo = refreshFake("access-2");
  const r = await getValidAccessToken(USER, sb as never, {
    now: () => AGORA + 30 * 60_000, // meia hora depois, token de 1 h
    refresh: segundo.fn,
  });

  assertEquals(r?.accessToken, "access-1");
  assertEquals(segundo.chamadas.length, 0);
  assertEquals(sb.updates.length, 1); // só o da primeira renovação
});

Deno.test("dentro da margem de vencimento → renova", async () => {
  const row = await linhaConectada();
  const sb = fakeSupabase(row);
  await getValidAccessToken(USER, sb as never, { now: () => AGORA, refresh: refreshFake("access-1").fn });

  const segundo = refreshFake("access-2");
  const quaseVencendo = AGORA + 3600_000 - ACCESS_TOKEN_REUSE_MARGIN_MS + 1;
  const r = await getValidAccessToken(USER, sb as never, { now: () => quaseVencendo, refresh: segundo.fn });

  assertEquals(r?.accessToken, "access-2");
  assertEquals(segundo.chamadas.length, 1);
  assertEquals(sb.updates.length, 2);
});

Deno.test("reconexão (refresh token novo, nonce novo) invalida o cache", async () => {
  const row = await linhaConectada();
  const sb = fakeSupabase(row);
  await getValidAccessToken(USER, sb as never, { now: () => AGORA, refresh: refreshFake("access-antigo").fn });

  // O callback de OAuth regrava o refresh token (nonce novo) e NÃO toca no cache.
  const novo = await encryptToken("refresh-token-2");
  row.encrypted_refresh_token = novo.encrypted;
  row.encryption_nonce = novo.nonce;

  const segundo = refreshFake("access-da-concessao-nova");
  const r = await getValidAccessToken(USER, sb as never, { now: () => AGORA + 60_000, refresh: segundo.fn });

  assertEquals(r?.accessToken, "access-da-concessao-nova");
  assertEquals(segundo.chamadas, ["refresh-token-2"]);
});

Deno.test("cache corrompido → renova em vez de falhar", async () => {
  const row = await linhaConectada();
  row.access_token_cache = "lixo.que-nao-decifra";
  const sb = fakeSupabase(row);
  const refresh = refreshFake("access-novo");

  const r = await getValidAccessToken(USER, sb as never, { now: () => AGORA, refresh: refresh.fn });

  assertEquals(r?.accessToken, "access-novo");
  assertEquals(refresh.chamadas.length, 1);
});

Deno.test("coluna de cache ausente (migration não aplicada) → comportamento antigo", async () => {
  const row = await linhaConectada();
  const sb = fakeSupabase(row, { semColunaDeCache: true });
  const refresh = refreshFake("access-novo");

  const r = await getValidAccessToken(USER, sb as never, { now: () => AGORA, refresh: refresh.fn });

  assertEquals(r?.accessToken, "access-novo");
  assertEquals(refresh.chamadas.length, 1);
  // Caiu no UPDATE legado (sem a coluna nova), que é o que mantém
  // `access_token_expires_at`/`last_error` corretos enquanto a migration não sobe.
  assertEquals(sb.updates.length, 1);
  assertEquals("access_token_cache" in sb.updates[0], false);
  assertEquals(sb.updates[0].last_error, null);
});

Deno.test("sem conexão ativa → null, sem chamar o Google", async () => {
  const sb = fakeSupabase(null);
  const refresh = refreshFake();
  const r = await getValidAccessToken(USER, sb as never, { now: () => AGORA, refresh: refresh.fn });
  assertEquals(r, null);
  assertEquals(refresh.chamadas.length, 0);
});

Deno.test("cache de um usuário não serve para outro (nonce do refresh token difere)", async () => {
  const a = await linhaConectada();
  const sbA = fakeSupabase(a);
  await getValidAccessToken(USER, sbA as never, { now: () => AGORA, refresh: refreshFake("access-de-A").fn });

  const b = await linhaConectada();
  b.access_token_cache = a.access_token_cache; // cópia indevida do blob
  const sbB = fakeSupabase(b);
  const refreshB = refreshFake("access-de-B");
  const r = await getValidAccessToken(USER, sbB as never, { now: () => AGORA + 60_000, refresh: refreshB.fn });

  assertNotEquals(r?.accessToken, "access-de-A");
  assertEquals(refreshB.chamadas.length, 1);
});
