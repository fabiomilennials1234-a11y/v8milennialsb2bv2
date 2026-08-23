import { describe, it, expect } from "vitest";
import {
  decidePool,
  runWithPool,
  derivePerOrg,
  deriveChunk,
  CONTROLLER,
  POOL_DEFAULTS,
  type PoolConfig,
} from "../../supabase/functions/_shared/workflow-dispatch-pool";

const base = (over: Partial<PoolConfig> = {}): PoolConfig => ({
  mode: "auto",
  size: 4,
  min: 4,
  max: 16,
  budgetMs: 45_000,
  chunk: 8,
  perOrg: 2,
  satStreak: 0,
  idleStreak: 0,
  lastChangeAt: 0,
  ...over,
});

const NOW = 10_000_000; // bem depois de qualquer carência

const SAT = { saturated: true, idle: false };
const IDLE = { saturated: false, idle: true };
const NEUTRO = { saturated: false, idle: false };

describe("controlador de escala", () => {
  it("não sobe antes de 3 saturações seguidas", () => {
    let cfg = base();
    for (let i = 1; i < CONTROLLER.SAT_STREAK_TO_UP; i++) {
      const d = decidePool(cfg, SAT, NOW);
      expect(d.changed).toBe(false);
      expect(d.size).toBe(4);
      cfg = { ...cfg, satStreak: d.satStreak };
    }
    // controle positivo: a próxima (a 3ª) TEM que subir
    const d3 = decidePool(cfg, SAT, NOW);
    expect(d3.changed).toBe(true);
    expect(d3.size).toBe(6);
    expect(d3.reason).toBe("up");
  });

  it("streak de saturação zera quando a invocação não satura", () => {
    const cfg = base({ satStreak: 2 });
    const d = decidePool(cfg, NEUTRO, NOW);
    expect(d.satStreak).toBe(0);
    expect(d.changed).toBe(false);
  });

  it("sobe de 2 em 2 e desce de 1 em 1", () => {
    const up = decidePool(base({ size: 8, satStreak: CONTROLLER.SAT_STREAK_TO_UP - 1 }), SAT, NOW);
    expect(up.size).toBe(10);
    const down = decidePool(
      base({ size: 8, idleStreak: CONTROLLER.IDLE_STREAK_TO_DOWN - 1 }),
      IDLE,
      NOW,
    );
    expect(down.size).toBe(7);
  });

  it("respeita teto e piso da faixa [4, 16]", () => {
    const teto = decidePool(base({ size: 16, satStreak: CONTROLLER.SAT_STREAK_TO_UP - 1 }), SAT, NOW);
    expect(teto.size).toBe(16);
    expect(teto.changed).toBe(false);
    expect(teto.reason).toBe("at_ceiling");

    const piso = decidePool(
      base({ size: 4, idleStreak: CONTROLLER.IDLE_STREAK_TO_DOWN - 1 }),
      IDLE,
      NOW,
    );
    expect(piso.size).toBe(4);
    expect(piso.changed).toBe(false);
    expect(piso.reason).toBe("at_floor");
  });

  it("carência bloqueia a mudança mas deixa o streak acumular", () => {
    const cfg = base({ satStreak: CONTROLLER.SAT_STREAK_TO_UP - 1, lastChangeAt: NOW - 1_000 });
    const d = decidePool(cfg, SAT, NOW);
    expect(d.reason).toBe("cooldown");
    expect(d.changed).toBe(false);
    expect(d.satStreak).toBe(CONTROLLER.SAT_STREAK_TO_UP); // acumulou

    // controle positivo: passada a carência, a MESMA entrada sobe
    const depois = decidePool(cfg, SAT, NOW + CONTROLLER.COOLDOWN_MS);
    expect(depois.changed).toBe(true);
    expect(depois.size).toBe(6);
  });

  it("pinned trava o controlador — humano vence a máquina", () => {
    const cfg = base({ mode: "pinned", size: 4, satStreak: 99 });
    const d = decidePool(cfg, SAT, NOW);
    expect(d.changed).toBe(false);
    expect(d.size).toBe(4);
    expect(d.reason).toBe("pinned");

    // controle positivo: a MESMA entrada em auto subiria
    const auto = decidePool({ ...cfg, mode: "auto" }, SAT, NOW);
    expect(auto.changed).toBe(true);
  });
});

describe("derivados do pool", () => {
  it("fatia por org é metade do pool, nunca zero", () => {
    expect(derivePerOrg(4)).toBe(2);
    expect(derivePerOrg(16)).toBe(8);
    expect(derivePerOrg(1)).toBe(1);
  });
  it("pedaço de claim é 2x o pool", () => {
    expect(deriveChunk(4)).toBe(8);
    expect(deriveChunk(16)).toBe(32);
  });
  it("padrão nasce em 4, faixa [4,16]", () => {
    expect(POOL_DEFAULTS.size).toBe(4);
    expect(POOL_DEFAULTS.min).toBe(4);
    expect(POOL_DEFAULTS.max).toBe(16);
  });
});

describe("pool de execução", () => {
  const item = (org: string, id: number) => ({ org, id });
  const orgOf = (i: { org: string }) => i.org;

  it("nunca passa do teto global de concorrência", async () => {
    let vivos = 0;
    let pico = 0;
    const itens = Array.from({ length: 20 }, (_, i) => item("A", i));
    await runWithPool(
      itens,
      orgOf,
      async () => {
        vivos++;
        pico = Math.max(pico, vivos);
        await new Promise((r) => setTimeout(r, 5));
        vivos--;
      },
      { size: 4, perOrg: 4, deadlineMs: Number.MAX_SAFE_INTEGER },
    );
    expect(pico).toBeLessThanOrEqual(4);
    expect(pico).toBe(4); // controle positivo: chegou a usar o pool todo
  });

  it("nunca passa do teto por org, mesmo com o pool global sobrando", async () => {
    const vivosPorOrg = new Map<string, number>();
    const picoPorOrg = new Map<string, number>();
    // 12 itens da org A e 12 da org B, pool global 8, teto por org 2
    const itens = [
      ...Array.from({ length: 12 }, (_, i) => item("A", i)),
      ...Array.from({ length: 12 }, (_, i) => item("B", i)),
    ];
    await runWithPool(
      itens,
      orgOf,
      async (it) => {
        const n = (vivosPorOrg.get(it.org) ?? 0) + 1;
        vivosPorOrg.set(it.org, n);
        picoPorOrg.set(it.org, Math.max(picoPorOrg.get(it.org) ?? 0, n));
        await new Promise((r) => setTimeout(r, 5));
        vivosPorOrg.set(it.org, (vivosPorOrg.get(it.org) ?? 1) - 1);
      },
      { size: 8, perOrg: 2, deadlineMs: Number.MAX_SAFE_INTEGER },
    );
    expect(picoPorOrg.get("A")).toBeLessThanOrEqual(2);
    expect(picoPorOrg.get("B")).toBeLessThanOrEqual(2);
    // controle positivo: as duas orgs correram de fato em paralelo
    expect(picoPorOrg.get("A")).toBe(2);
    expect(picoPorOrg.get("B")).toBe(2);
  });

  it("uma org faminta não impede a outra de rodar", async () => {
    const ordem: string[] = [];
    const itens = [
      ...Array.from({ length: 10 }, (_, i) => item("GRANDE", i)),
      item("PEQUENA", 0),
    ];
    await runWithPool(
      itens,
      orgOf,
      async (it) => {
        ordem.push(it.org);
        await new Promise((r) => setTimeout(r, 5));
      },
      { size: 4, perOrg: 2, deadlineMs: Number.MAX_SAFE_INTEGER },
    );
    // com teto por org 2, a PEQUENA entra na primeira leva, não depois das 10 da GRANDE
    expect(ordem.slice(0, 4)).toContain("PEQUENA");
  });

  it("prazo interrompe e devolve o que sobrou", async () => {
    let t = 0;
    const now = () => t;
    const itens = Array.from({ length: 50 }, (_, i) => item("A", i));
    const r = await runWithPool(
      itens,
      orgOf,
      async () => {
        t += 100; // cada item "gasta" 100ms do relógio injetado
        await Promise.resolve();
      },
      { size: 1, perOrg: 1, deadlineMs: 500, now },
    );
    expect(r.leftover.length).toBeGreaterThan(0);
    expect(r.processed + r.leftover.length).toBe(50);
    expect(r.processed).toBeLessThan(50); // controle positivo: parou mesmo
  });

  it("sem prazo estourado, processa tudo e não sobra nada", async () => {
    const itens = Array.from({ length: 15 }, (_, i) => item(i % 3 === 0 ? "A" : "B", i));
    const r = await runWithPool(itens, orgOf, async () => {}, {
      size: 4,
      perOrg: 2,
      deadlineMs: Number.MAX_SAFE_INTEGER,
    });
    expect(r.processed).toBe(15);
    expect(r.leftover).toHaveLength(0);
  });

  it("execução que estoura não derruba o pool", async () => {
    const itens = Array.from({ length: 6 }, (_, i) => item("A", i));
    const r = await runWithPool(
      itens,
      orgOf,
      async (it) => {
        if (it.id === 2) throw new Error("boom");
      },
      { size: 2, perOrg: 2, deadlineMs: Number.MAX_SAFE_INTEGER },
    );
    expect(r.processed).toBe(6);
    expect(r.leftover).toHaveLength(0);
  });
});
