import { describe, it, expect } from "vitest";
import {
  readPoolConfig,
  persistPoolDecision,
  releaseClaimed,
  RPC_PER_ORG_CAP,
} from "../../supabase/functions/_shared/workflow-dispatch-pool";

/** Dublê mínimo do supabase-js: só o encadeamento que o módulo usa de fato. */
function fakeDb(rows: { key: string; value: string }[], opts: { guardWins?: boolean } = {}) {
  const writes: { key: string; value: string }[] = [];
  const released: string[][] = [];
  const db = {
    from(table: string) {
      if (table === "cron_config") {
        return {
          select: () => ({ in: async () => ({ data: rows }) }),
          update(patch: { value: string }) {
            const chain = {
              _key: "",
              eq(col: string, val: string) {
                if (col === "key") chain._key = val;
                // segunda .eq("value", ...) é a guarda otimista
                return chain;
              },
              select: async () => {
                writes.push({ key: chain._key, value: patch.value });
                return { data: opts.guardWins === false ? [] : [{ key: chain._key }] };
              },
              then(res: (v: unknown) => void) {
                writes.push({ key: chain._key, value: patch.value });
                res({ data: null });
              },
            };
            return chain;
          },
        };
      }
      // workflow_executions
      return {
        update: () => ({
          in(_c: string, ids: string[]) {
            released.push(ids);
            return { eq: () => ({ select: async () => ({ data: ids.map((id) => ({ id })) }) }) };
          },
        }),
      };
    },
  };
  return { db: db as never, writes, released };
}

describe("leitura de configuração", () => {
  it("usa os valores gravados", async () => {
    const { db } = fakeDb([
      { key: "workflow_pool_mode", value: "auto" },
      { key: "workflow_pool_size", value: "8" },
      { key: "workflow_pool_min", value: "4" },
      { key: "workflow_pool_max", value: "16" },
      { key: "workflow_run_budget_ms", value: "45000" },
    ]);
    const cfg = await readPoolConfig(db);
    expect(cfg.size).toBe(8);
    expect(cfg.perOrg).toBe(4);   // metade
    expect(cfg.chunk).toBe(16);   // 2x
    expect(cfg.mode).toBe("auto");
  });

  it("chave ausente cai no padrão conservador, nunca em ilimitado", async () => {
    const { db } = fakeDb([]);
    const cfg = await readPoolConfig(db);
    expect(cfg.size).toBe(4);
    expect(cfg.max).toBe(16);
    expect(cfg.budgetMs).toBe(45_000);
  });

  it("valor absurdo é contido pela faixa", async () => {
    const { db } = fakeDb([
      { key: "workflow_pool_size", value: "9999" },
      { key: "workflow_pool_max", value: "16" },
    ]);
    const cfg = await readPoolConfig(db);
    expect(cfg.size).toBe(16); // grampeado no teto, não 9999
  });

  it("lixo não-numérico não vira NaN", async () => {
    const { db } = fakeDb([{ key: "workflow_pool_size", value: "abacaxi" }]);
    const cfg = await readPoolConfig(db);
    expect(cfg.size).toBe(4);
    expect(Number.isNaN(cfg.size)).toBe(false);
  });

  it("per_org_cap enviado à RPC é alto — deixou de ser o freio", () => {
    expect(RPC_PER_ORG_CAP).toBeGreaterThanOrEqual(1000);
  });
});

describe("persistência da decisão", () => {
  const cfg = {
    mode: "auto" as const, size: 4, min: 4, max: 16, budgetMs: 45_000,
    chunk: 8, perOrg: 2, satStreak: 0, idleStreak: 0, lastChangeAt: 0,
  };

  it("modo pinned não escreve nada", async () => {
    const { db, writes } = fakeDb([]);
    const ok = await persistPoolDecision(db, cfg, {
      size: 4, satStreak: 0, idleStreak: 0, changed: false, reason: "pinned",
    });
    expect(ok).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("sem mudança de tamanho, grava só os contadores", async () => {
    const { db, writes } = fakeDb([]);
    await persistPoolDecision(db, cfg, {
      size: 4, satStreak: 2, idleStreak: 0, changed: false, reason: "hold",
    });
    expect(writes.map((w) => w.key)).toEqual([
      "workflow_pool_sat_streak",
      "workflow_pool_idle_streak",
    ]);
  });

  it("guarda otimista perdida ⇒ não sobrescreve o tamanho", async () => {
    const { db, writes } = fakeDb([], { guardWins: false });
    const ok = await persistPoolDecision(db, cfg, {
      size: 6, satStreak: 0, idleStreak: 0, changed: true, reason: "up",
    });
    expect(ok).toBe(false);
    expect(writes.some((w) => w.key === "workflow_pool_size")).toBe(false);
  });

  it("guarda otimista vencida ⇒ grava o tamanho novo", async () => {
    const { db, writes } = fakeDb([], { guardWins: true });
    const ok = await persistPoolDecision(db, cfg, {
      size: 6, satStreak: 0, idleStreak: 0, changed: true, reason: "up",
    });
    expect(ok).toBe(true);
    expect(writes.find((w) => w.key === "workflow_pool_size")?.value).toBe("6");
  });
});

describe("devolução de reivindicadas", () => {
  it("lista vazia não toca no banco", async () => {
    const { db, released } = fakeDb([]);
    expect(await releaseClaimed(db, [])).toBe(0);
    expect(released).toHaveLength(0);
  });

  it("devolve exatamente os ids passados", async () => {
    const { db, released } = fakeDb([]);
    const n = await releaseClaimed(db, ["a", "b", "c"]);
    expect(n).toBe(3);
    expect(released[0]).toEqual(["a", "b", "c"]);
  });
});
