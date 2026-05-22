/**
 * send-dedup — idempotência atômica em todo caminho de send.
 *
 * Behaviors testadas via interface pública:
 * - normalizeContent: lowercase, whitespace collapse, strip emoji ZWJ
 * - hashContent: sha256 determinístico do conteúdo normalizado
 * - getDefaultWindow: TTL por SendSource
 * - tryReserveSend: dedup atômica via Supabase (race-free)
 *
 * Race condition + RLS + cleanup cron testados em
 * tests/integration/send-dedup.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * In-memory fake of `send_dedup_log` that respects the unique constraints
 * declared in the migration. Used to drive the behavioral contract of
 * `tryReserveSend` without needing a live Postgres in unit tests.
 *
 * Real race-condition coverage lives in tests/integration/send-dedup.test.ts.
 */
type DedupRow = {
  id: string;
  org_id: string;
  phone: string;
  content_hash: string;
  source: string;
  idempotency_key: string | null;
  expires_at: string;
  reserved_at: string;
};

function createFakeSupabase(opts: { now?: () => Date } = {}) {
  const rows = new Map<string, DedupRow>(); // key: unique id
  const now = opts.now ?? (() => new Date());

  function activeRowMatching(predicate: (r: DedupRow) => boolean): DedupRow | undefined {
    const t = now().toISOString();
    for (const r of rows.values()) {
      if (r.expires_at <= t) continue;
      if (predicate(r)) return r;
    }
    return undefined;
  }

  const client = {
    from(table: string) {
      if (table !== "send_dedup_log") throw new Error(`fake only supports send_dedup_log, got ${table}`);
      return {
        insert(row: Omit<DedupRow, "id" | "reserved_at"> & Partial<Pick<DedupRow, "id" | "reserved_at">>) {
          const insertRow: DedupRow = {
            id: row.id ?? crypto.randomUUID(),
            reserved_at: row.reserved_at ?? now().toISOString(),
            ...row,
          } as DedupRow;

          // Idempotency-key unique partial
          if (insertRow.idempotency_key) {
            const idkHit = activeRowMatching((r) =>
              r.org_id === insertRow.org_id && r.idempotency_key === insertRow.idempotency_key
            );
            if (idkHit) {
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              };
            }
          }

          // Content+phone+source unique partial (only when idempotency_key null)
          if (!insertRow.idempotency_key) {
            const contentHit = activeRowMatching((r) =>
              r.idempotency_key === null &&
              r.org_id === insertRow.org_id &&
              r.phone === insertRow.phone &&
              r.content_hash === insertRow.content_hash &&
              r.source === insertRow.source
            );
            if (contentHit) {
              return {
                select: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              };
            }
          }

          rows.set(insertRow.id, insertRow);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: insertRow, error: null }),
            }),
          };
        },
        select() {
          // Generic chain: collects .eq() filters and .gt('expires_at', t)
          // until .maybeSingle() resolves. Order/limit are no-ops (we already
          // filter to active rows; tests don't depend on ordering specifics).
          const eqFilters: Array<[keyof DedupRow, unknown]> = [];
          let gtExpiresAt: string | null = null;
          const chain: any = {
            eq(col: keyof DedupRow, val: unknown) {
              eqFilters.push([col, val]);
              return chain;
            },
            gt(col: keyof DedupRow, val: string) {
              if (col === "expires_at") gtExpiresAt = val;
              return chain;
            },
            order() { return chain; },
            limit() { return chain; },
            async maybeSingle() {
              const hit = activeRowMatching((r) => {
                for (const [c, v] of eqFilters) {
                  if (r[c] !== v) return false;
                }
                if (gtExpiresAt && !(r.expires_at > gtExpiresAt)) return false;
                return true;
              });
              return { data: hit ?? null, error: null };
            },
          };
          return chain;
        },
      };
    },
  };

  return { client, rows };
}

import {
  normalizeContent,
  hashContent,
  getDefaultWindow,
  tryReserveSend,
  type SendSource,
} from "../../supabase/functions/_shared/send-dedup.ts";

describe("normalizeContent", () => {
  it("lowercases and trims", () => {
    expect(normalizeContent("  HELLO World  ")).toBe("hello world");
  });

  it("collapses internal whitespace and strips zero-width joiners", () => {
    const a = "Oi‍Filipe!"; // ZWJ entre palavras
    const b = "Oi  Filipe!  ";   // espaços extra
    expect(normalizeContent(a)).toBe("oifilipe!");
    expect(normalizeContent(b)).toBe("oi filipe!");
  });
});

describe("hashContent", () => {
  it("is deterministic for same normalized content", async () => {
    const h1 = await hashContent("Oi Filipe!");
    const h2 = await hashContent("  OI   filipe!  ");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{32}$/);
  });

  it("differs for different content", async () => {
    const a = await hashContent("Oi Filipe!");
    const b = await hashContent("Oi Marcos!");
    expect(a).not.toBe(b);
  });
});

describe("getDefaultWindow", () => {
  it("returns shortest window for manual (operador esperado clica rápido)", () => {
    expect(getDefaultWindow("manual")).toBe(10);
  });

  it("returns mass_send 24h (template diário não repete em janela)", () => {
    expect(getDefaultWindow("mass_send")).toBe(86_400);
  });

  it("covers every SendSource", () => {
    const sources: SendSource[] = ["manual", "copilot", "workflow", "mass_send", "followup"];
    for (const s of sources) {
      expect(getDefaultWindow(s)).toBeGreaterThan(0);
    }
  });
});

describe("tryReserveSend — behavior contract", () => {
  it("first call for (org, phone, hash, source) reserves and returns ok", async () => {
    const { client } = createFakeSupabase();
    const hash = await hashContent("Oi Filipe!");
    const result = await tryReserveSend({
      supabase: client as any,
      orgId: "org-1",
      phone: "+5511937347373",
      contentHash: hash,
      source: "manual",
    });
    expect(result.kind).toBe("ok");
  });

  it("second call within window returns duplicate with firstSentAt + ttlSeconds", async () => {
    // Reproduz padrão Bertin: "Oi Filipe!" 12x em 30min via composer.
    // Janela manual=10s → 2ª call em <10s deve ser bloqueada.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T19:59:38Z"));

    const { client } = createFakeSupabase({ now: () => new Date() });
    const hash = await hashContent("Oi Filipe!");
    const args = {
      supabase: client as any,
      orgId: "org-1",
      phone: "+5511937347373",
      contentHash: hash,
      source: "manual" as const,
    };

    const first = await tryReserveSend(args);
    expect(first.kind).toBe("ok");

    // +3s — within manual window of 10s
    vi.setSystemTime(new Date("2026-05-21T19:59:41Z"));
    const second = await tryReserveSend(args);
    expect(second.kind).toBe("duplicate");
    if (second.kind === "duplicate") {
      expect(second.firstSentAt).toBe("2026-05-21T19:59:38.000Z");
      expect(second.ttlSeconds).toBeGreaterThan(0);
      expect(second.ttlSeconds).toBeLessThanOrEqual(10);
    }

    vi.useRealTimers();
  });

  it("re-reserves after window expires (manual=10s)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T19:59:38Z"));

    const { client } = createFakeSupabase({ now: () => new Date() });
    const hash = await hashContent("Oi Filipe!");
    const args = {
      supabase: client as any,
      orgId: "org-1",
      phone: "+5511937347373",
      contentHash: hash,
      source: "manual" as const,
    };

    const first = await tryReserveSend(args);
    expect(first.kind).toBe("ok");

    // +20s — past 10s window
    vi.setSystemTime(new Date("2026-05-21T19:59:58Z"));
    const third = await tryReserveSend(args);
    expect(third.kind).toBe("ok");

    vi.useRealTimers();
  });

  it("replays idempotencyKey within window as ok (retry the same logical send)", async () => {
    // Frontend gera UUID por click; em retry de rede o mesmo UUID volta. Não
    // pode bloquear como duplicate — caller declarou intent de reenviar o
    // mesmo logical send.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T19:59:38Z"));

    const { client } = createFakeSupabase({ now: () => new Date() });
    const hash = await hashContent("Oi Filipe!");
    const idk = "550e8400-e29b-41d4-a716-446655440000";
    const args = {
      supabase: client as any,
      orgId: "org-1",
      phone: "+5511937347373",
      contentHash: hash,
      source: "manual" as const,
      idempotencyKey: idk,
    };

    const first = await tryReserveSend(args);
    expect(first.kind).toBe("ok");

    vi.setSystemTime(new Date("2026-05-21T19:59:41Z"));
    const replay = await tryReserveSend(args);
    expect(replay.kind).toBe("ok");

    vi.useRealTimers();
  });
});
