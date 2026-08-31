import { describe, it, expect } from "vitest";
import {
  sortColumnItems,
  COLUMN_SORT_OPTIONS,
  DEFAULT_COLUMN_SORT,
  type ColumnSortKey,
} from "@/modules/pipelines/lib/column-sort";
import {
  matchesStalledBucket,
  getStalledBucket,
} from "@/modules/pipelines/lib/stalled-buckets";

const card = (over: Record<string, unknown>) => ({
  id: String(over.id ?? Math.random()),
  ...over,
});

describe("ordenação da coluna", () => {
  it("'manual' devolve a ordem original, sem cópia", () => {
    const items = [card({ id: "a" }), card({ id: "b" })];
    expect(sortColumnItems(items, "manual")).toBe(items);
  });

  it("nunca muta o array de entrada — ele vem do cache do React Query", () => {
    const items = [
      card({ id: "a", stageEnteredAt: "2026-06-01T12:00:00Z" }),
      card({ id: "b", stageEnteredAt: "2026-08-01T12:00:00Z" }),
    ];
    const before = items.map((i) => i.id);
    sortColumnItems(items, "moved");
    expect(items.map((i) => i.id)).toEqual(before);
  });

  it("valor ordena do maior pro menor", () => {
    const items = [
      card({ id: "medio", value: 500 }),
      card({ id: "alto", value: 900 }),
      card({ id: "baixo", value: 100 }),
    ];
    expect(sortColumnItems(items, "value").map((i) => i.id)).toEqual(["alto", "medio", "baixo"]);
  });

  it("campo ausente ou nulo vai pro fim, não pro topo", () => {
    // Sem isso, um card sem valor seria lido como "R$ 0" e ficaria no fim por
    // acaso na ordenação decrescente — mas apareceria no TOPO se algum dia a
    // direção mudasse. Ausência é ausência, não zero.
    const items = [
      card({ id: "sem" }),
      card({ id: "com", value: 10 }),
      card({ id: "nulo", value: null }),
      card({ id: "zero", value: 0 }),
    ];
    const ordered = sortColumnItems(items, "value").map((i) => i.id);
    expect(ordered[0]).toBe("com");
    expect(ordered[1]).toBe("zero");
    expect(ordered.slice(2).sort()).toEqual(["nulo", "sem"]);
  });

  it("'parado há' põe o mais antigo na etapa primeiro", () => {
    const items = [
      card({ id: "ontem", stageEnteredAt: "2026-07-28T12:00:00Z" }),
      card({ id: "mes-passado", stageEnteredAt: "2026-06-20T12:00:00Z" }),
      card({ id: "hoje", stageEnteredAt: "2026-07-29T12:00:00Z" }),
    ];
    expect(sortColumnItems(items, "stalled").map((i) => i.id)).toEqual([
      "mes-passado",
      "ontem",
      "hoje",
    ]);
  });

  it("'parado há' cai em createdAt quando não há data de etapa", () => {
    const items = [
      card({ id: "novo", stageEnteredAt: "2026-07-29T12:00:00Z" }),
      card({ id: "velho-sem-etapa", createdAt: "2026-01-01T12:00:00Z" }),
    ];
    expect(sortColumnItems(items, "stalled")[0].id).toBe("velho-sem-etapa");
  });

  it("'última movimentação' é o inverso EXATO de 'parado há'", () => {
    // As duas lêem a mesma âncora. Se alguém mexer na de uma só, este teste cai
    // antes de a coluna passar a dar duas respostas incompatíveis.
    const items = [
      card({ id: "ontem", stageEnteredAt: "2026-07-28T12:00:00Z" }),
      card({ id: "mes-passado", stageEnteredAt: "2026-06-20T12:00:00Z" }),
      card({ id: "hoje", stageEnteredAt: "2026-07-29T12:00:00Z" }),
    ];
    expect(sortColumnItems(items, "moved").map((i) => i.id)).toEqual([
      "hoje",
      "ontem",
      "mes-passado",
    ]);
    expect(sortColumnItems(items, "moved").map((i) => i.id)).toEqual(
      sortColumnItems(items, "stalled").map((i) => i.id).reverse(),
    );
  });

  it("'última movimentação' conta quem entrou no funil e nunca trocou de etapa", () => {
    // Entry antiga tem `stage_changed_at` nulo (é anterior ao trigger), e o card
    // só traz `createdAt`. Sem o fallback ela seria lida como "sem data" e cairia
    // pro fim — o negócio adicionado hoje sumiria do topo da lista.
    const items = [
      card({ id: "trocou-em-junho", stageEnteredAt: "2026-06-01T12:00:00Z" }),
      card({ id: "entrou-ontem-sem-trocar", createdAt: "2026-07-28T12:00:00Z" }),
    ];
    expect(sortColumnItems(items, "moved")[0].id).toBe("entrou-ontem-sem-trocar");
  });

  it("card sem data nenhuma fica no FIM nos dois sentidos", () => {
    const items = [
      card({ id: "sem-data" }),
      card({ id: "velho", stageEnteredAt: "2026-01-01T12:00:00Z" }),
      card({ id: "novo", stageEnteredAt: "2026-08-01T12:00:00Z" }),
    ];
    // Ausência não é "época 0" nem "agora": inverter a direção não pode fazer o
    // desconhecido saltar pro topo.
    expect(sortColumnItems(items, "moved").at(-1)?.id).toBe("sem-data");
    expect(sortColumnItems(items, "stalled").at(-1)?.id).toBe("sem-data");
  });

  it("o menu não oferece mais ordenar por nome nem por calor", () => {
    // Decisões de produto (2026-08-31), guardadas contra reintrodução silenciosa.
    // "Nome": ordenar a etapa em A–Z não responde pergunta nenhuma do operador.
    // "Calor": o rótulo mentia — lia `rating` (que o filtro chama "Prioridade"),
    // não `pipe_propostas.calor`.
    const keys = COLUMN_SORT_OPTIONS.map((o) => o.key as string);
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("heat");
    const labels = COLUMN_SORT_OPTIONS.map((o) => o.label);
    expect(labels).not.toContain("Nome");
    expect(labels).not.toContain("Calor");
  });

  it("ordenar não lê mais `rating` de card nenhum", () => {
    // O campo continua vivo no card e no filtro "Prioridade" — o que morreu foi
    // ORDENAR por ele. Um getter que estoura prova que nenhuma opção o toca.
    // Construídos um a um: espalhar (`{...armadilha}`) INVOCA o getter e a
    // armadilha pegaria a si mesma antes de a ordenação rodar.
    const armadilha = (id: string, value: number, quando: string) => ({
      id,
      value,
      stageEnteredAt: quando,
      get rating(): number {
        throw new Error("ordenação leu `rating` — a opção Calor voltou?");
      },
    });
    const items = [
      armadilha("x", 10, "2026-07-01T12:00:00Z"),
      armadilha("y", 20, "2026-08-01T12:00:00Z"),
    ];
    for (const opt of COLUMN_SORT_OPTIONS) {
      expect(() => sortColumnItems(items, opt.key)).not.toThrow();
    }
  });

  it("data inválida não quebra a ordenação", () => {
    const items = [
      card({ id: "ok", stageEnteredAt: "2026-07-01T12:00:00Z" }),
      card({ id: "lixo", stageEnteredAt: "nao-e-data" }),
    ];
    expect(() => sortColumnItems(items, "stalled")).not.toThrow();
    expect(sortColumnItems(items, "stalled")[0].id).toBe("ok");
    expect(() => sortColumnItems(items, "moved")).not.toThrow();
    expect(sortColumnItems(items, "moved")[0].id).toBe("ok");
  });

  it("toda opção do menu é ordenável, e o default é 'manual'", () => {
    const items = [card({ id: "a", value: 1, stageEnteredAt: "2026-07-01T12:00:00Z" })];
    for (const opt of COLUMN_SORT_OPTIONS) {
      expect(() => sortColumnItems(items, opt.key as ColumnSortKey)).not.toThrow();
    }
    expect(COLUMN_SORT_OPTIONS.map((o) => o.key)).toContain(DEFAULT_COLUMN_SORT);
  });
});

describe("predicado 'parado há' client-side (funil custom)", () => {
  const NOW = new Date("2026-07-29T12:00:00Z");
  const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it("respeita as bordas exatas de cada faixa", () => {
    // As mesmas contas do SQL: min = piso, max = teto inclusivo.
    const b = getStalledBucket("3-7")!;
    expect(matchesStalledBucket(daysAgo(2), b, NOW)).toBe(false);
    expect(matchesStalledBucket(daysAgo(3), b, NOW)).toBe(true);
    expect(matchesStalledBucket(daysAgo(7), b, NOW)).toBe(true);
    expect(matchesStalledBucket(daysAgo(8), b, NOW)).toBe(false);
  });

  it("'mais de 30 dias' pega 31+ e recusa 30", () => {
    const b = getStalledBucket("30+")!;
    expect(matchesStalledBucket(daysAgo(30), b, NOW)).toBe(false);
    expect(matchesStalledBucket(daysAgo(31), b, NOW)).toBe(true);
    expect(matchesStalledBucket(daysAgo(400), b, NOW)).toBe(true);
  });

  it("faixa nula (sem filtro) deixa tudo passar", () => {
    expect(matchesStalledBucket(daysAgo(999), null, NOW)).toBe(true);
    expect(matchesStalledBucket(null, null, NOW)).toBe(true);
  });

  it("sem data conta como recém-chegado", () => {
    // Espelha COALESCE(stage_changed_at, entered_at, created_at) do SQL.
    expect(matchesStalledBucket(null, getStalledBucket("0-2"), NOW)).toBe(true);
    expect(matchesStalledBucket(null, getStalledBucket("30+"), NOW)).toBe(false);
  });

  it("data inválida não descarta o card em silêncio", () => {
    expect(matchesStalledBucket("nao-e-data", getStalledBucket("30+"), NOW)).toBe(true);
  });

  it("as faixas particionam a reta: todo card cai em exatamente uma", () => {
    for (const d of [0, 1, 2, 3, 7, 8, 14, 15, 30, 31, 90]) {
      const hits = ["0-2", "3-7", "8-14", "15-30", "30+"].filter((id) =>
        matchesStalledBucket(daysAgo(d), getStalledBucket(id), NOW),
      );
      expect(hits, `dia ${d} caiu em ${hits.length} faixas`).toHaveLength(1);
    }
  });
});
