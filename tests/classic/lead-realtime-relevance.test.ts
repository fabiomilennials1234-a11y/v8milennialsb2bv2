/**
 * Interface CLÁSSICA — cópia de `tests/unit/lead-realtime-relevance.test.ts` com `@` → `classic/src`
 * (`vitest.classic.config.ts`). Port de 2026-10-05: classificador de eventos de leads (colunas de recorte travadas contra os filtros e a ordem da clássica).
 * Mantenha as duas cópias iguais abaixo deste bloco.
 */
/**
 * Classificador de eventos realtime da lista de Leads.
 *
 * A tela de Leads era 60% do tempo do banco de prod (2026-10-05): cada evento
 * da org refazia a lista + 6 contagens. O classificador decide, por evento, o
 * MÍNIMO que a tela precisa: nada, um patch local, só as contagens, ou tudo.
 *
 * O erro que ele não pode cometer é o silencioso — pular um refetch que
 * mudaria o que está na tela. Por isso cada "pula" daqui tem prova (coluna fora
 * de recorte, posição estritamente depois da página) e todo o resto refaz.
 */
import { describe, it, expect } from "vitest";
import {
  classifyLeadEvent,
  normalizePgTimestamp,
  sameLeadValue,
  applyLeadChanges,
  LEAD_MEMBERSHIP_COLUMNS,
  LEAD_COMPUTED_FIELD_INPUTS,
  type LeadEventContext,
} from "@/modules/leads/lib/lead-realtime-relevance";
import { applyLeadListFilters } from "@/modules/leads/lib/lead-list-filters";
import { applyLeadListSort, LEAD_SORT_COLUMNS, type LeadSortKey } from "@/modules/leads/lib/lead-list-sort";

const ORG = "org-1";

/** Linha como o PostgREST devolve (ISO com `T` e `+00:00`, joins embutidos). */
function cachedRow(i: number, over: Record<string, unknown> = {}) {
  const created = new Date(Date.UTC(2026, 9, 5, 12, 0, 0) - i * 60_000).toISOString().replace("Z", "+00:00");
  return {
    id: `lead-${i}`,
    organization_id: ORG,
    name: `Lead ${i}`,
    notes: "antes",
    qualification_tier: "ouro",
    relacao_negocios: "cliente",
    responsible_id: "tm-1",
    created_at: created,
    updated_at: created,
    custom_fields: { a: 1, b: [1, 2] },
    responsible: { id: "tm-1", name: "Ana" },
    lead_tags: [{ tag: { id: "t1", name: "VIP", color: "#fff" } }],
    ...over,
  };
}

/** O mesmo dado como o realtime entrega: timestamptz em texto do PG, sem joins. */
function realtimeRow(row: ReturnType<typeof cachedRow>, over: Record<string, unknown> = {}) {
  const { responsible: _r, lead_tags: _t, ...cols } = row;
  const pg = (iso: string) => iso.replace("T", " ").replace("+00:00", "+00");
  return { ...cols, created_at: pg(row.created_at), updated_at: pg(row.updated_at), custom_fields: { b: [1, 2], a: 1 }, ...over };
}

const page = Array.from({ length: 50 }, (_, i) => cachedRow(i));

function ctx(over: Partial<LeadEventContext> = {}): LeadEventContext {
  return {
    organizationId: ORG,
    rows: page,
    pageSize: 50,
    sort: { key: "created_at", direction: "desc" },
    mode: "relacao",
    isCached: (id) => page.some((r) => r.id === id),
    ...over,
  };
}

const update = (n: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ eventType: "UPDATE", new: n, old: { id: n.id }, errors: null, ...extra }) as never;
const insert = (n: Record<string, unknown>) => ({ eventType: "INSERT", new: n, old: {}, errors: null }) as never;
const del = (id: string) => ({ eventType: "DELETE", new: {}, old: { id }, errors: null }) as never;

describe("timestamp do realtime vira o formato do PostgREST", () => {
  it.each([
    ["2026-10-05 12:00:00.123+00", "2026-10-05T12:00:00.123+00:00"],
    ["2026-10-05 12:00:00+00", "2026-10-05T12:00:00+00:00"],
    ["2026-10-05 12:00:00.123456-03", "2026-10-05T12:00:00.123456-03:00"],
    ["2026-10-05 12:00:00+05:30", "2026-10-05T12:00:00+05:30"],
    ["2026-10-05T12:00:00.123+00:00", "2026-10-05T12:00:00.123+00:00"],
    ["2026-10-05T12:00:00Z", "2026-10-05T12:00:00+00:00"],
  ])("%s → %s", (pg, iso) => {
    expect(normalizePgTimestamp(pg)).toBe(iso);
    expect(Number.isNaN(new Date(normalizePgTimestamp(pg)).getTime())).toBe(false);
  });

  it("não mexe em data pura nem em texto qualquer", () => {
    expect(normalizePgTimestamp("2026-10-05")).toBe("2026-10-05");
    expect(normalizePgTimestamp("Loja 21")).toBe("Loja 21");
  });
});

describe("comparação por significado", () => {
  it("mesmo instante em formatos diferentes é igual — até o microssegundo", () => {
    expect(sameLeadValue("2026-10-05T12:00:00.123456+00:00", "2026-10-05 12:00:00.123456+00")).toBe(true);
    expect(sameLeadValue("2026-10-05T09:00:00+00:00", "2026-10-05 06:00:00-03")).toBe(true);
    expect(sameLeadValue("2026-10-05T12:00:00.123456+00:00", "2026-10-05 12:00:00.123457+00")).toBe(false);
  });

  it("jsonb compara conteúdo, não ordem de chave", () => {
    expect(sameLeadValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameLeadValue({ a: 1, b: [1, 2] }, { a: 1, b: [2, 1] })).toBe(false);
  });

  it("null e undefined são ausência", () => {
    expect(sameLeadValue(null, undefined)).toBe(true);
    expect(sameLeadValue(null, "x")).toBe(false);
  });
});

describe("UPDATE de lead que está na tela", () => {
  it("só coluna fora de recorte mudou → patch das colunas mudadas, timestamp normalizado", () => {
    const row = page[3];
    const v = classifyLeadEvent(
      update(realtimeRow(row, { notes: "depois", updated_at: "2026-10-05 12:30:00.123+00" })),
      ctx(),
    );
    expect(v).toEqual({
      kind: "patch",
      id: row.id,
      changes: { notes: "depois", updated_at: "2026-10-05T12:30:00.123+00:00" },
    });
  });

  it("nada mudou de fato (formato diferente, mesmo valor) → ignora", () => {
    expect(classifyLeadEvent(update(realtimeRow(page[3])), ctx())).toEqual({ kind: "ignore" });
  });

  it("coluna de recorte mudou → refaz", () => {
    expect(classifyLeadEvent(update(realtimeRow(page[3], { qualification_tier: "prata" })), ctx())).toEqual({ kind: "refetch" });
  });

  it("coluna de join mudou (dono) → refaz: o nome embutido ficaria velho", () => {
    expect(classifyLeadEvent(update(realtimeRow(page[3], { responsible_id: "tm-2" })), ctx())).toEqual({ kind: "refetch" });
  });

  it("não-nulo → null → refaz (pode ser TOAST não reenviado, não dá para confiar)", () => {
    expect(classifyLeadEvent(update(realtimeRow(page[3], { notes: null })), ctx())).toEqual({ kind: "refetch" });
  });

  it("tipo trocado (objeto vira texto) → refaz", () => {
    expect(classifyLeadEvent(update(realtimeRow(page[3], { custom_fields: "{\"a\":1}" })), ctx())).toEqual({ kind: "refetch" });
  });

  it("evento com `errors` → refaz", () => {
    expect(
      classifyLeadEvent(update(realtimeRow(page[3], { notes: "x" }), { errors: ["Error 413: Payload Too Large"] }), ctx()),
    ).toEqual({ kind: "refetch" });
  });

  it("relacao_negocios: recorte na lei da Relação; preservada nos modos ERP e Café", () => {
    const mudou = realtimeRow(page[3], { relacao_negocios: "perdido" });
    expect(classifyLeadEvent(update(mudou), ctx({ mode: "relacao" }))).toEqual({ kind: "refetch" });
    expect(classifyLeadEvent(update(mudou), ctx({ mode: "erp" }))).toEqual({ kind: "ignore" });
    expect(classifyLeadEvent(update(mudou), ctx({ mode: "cafe" }))).toEqual({ kind: "ignore" });
  });

  it("evento de outra org nunca vira patch", () => {
    const v = classifyLeadEvent(update(realtimeRow(page[3], { organization_id: "org-2", notes: "x" })), ctx());
    expect(v).toEqual({ kind: "ignore" });
  });
});

describe("INSERT/UPDATE de lead fora da tela", () => {
  const older = cachedRow(500); // criado bem antes da última linha da página
  const newer = cachedRow(-10); // mais novo que a primeira

  it("ordem por data desc, página cheia, estritamente depois da última → só contagens", () => {
    expect(classifyLeadEvent(update(realtimeRow(older)), ctx())).toEqual({ kind: "counts" });
    expect(classifyLeadEvent(insert(realtimeRow(older)), ctx())).toEqual({ kind: "counts" });
  });

  it("antes da última (entra na página) → refaz", () => {
    expect(classifyLeadEvent(insert(realtimeRow(newer)), ctx())).toEqual({ kind: "refetch" });
  });

  it("empate no milissegundo com a última → refaz (o desempate é por id, no µs)", () => {
    const tie = cachedRow(49, { id: "lead-x" });
    expect(classifyLeadEvent(insert(realtimeRow(tie)), ctx())).toEqual({ kind: "refetch" });
  });

  it("ordem asc: depois é MAIS NOVO que a última", () => {
    const asc = [...page].reverse();
    const c = ctx({ rows: asc, sort: { key: "created_at", direction: "asc" } });
    expect(classifyLeadEvent(insert(realtimeRow(newer)), c)).toEqual({ kind: "counts" });
    expect(classifyLeadEvent(insert(realtimeRow(older)), c)).toEqual({ kind: "refetch" });
  });

  it("página incompleta, ordem por nome, ou página ainda sem dado → refaz", () => {
    expect(classifyLeadEvent(insert(realtimeRow(older)), ctx({ rows: page.slice(0, 49) }))).toEqual({ kind: "refetch" });
    expect(classifyLeadEvent(insert(realtimeRow(older)), ctx({ sort: { key: "name", direction: "asc" } }))).toEqual({ kind: "refetch" });
    expect(classifyLeadEvent(insert(realtimeRow(older)), ctx({ rows: undefined }))).toEqual({ kind: "refetch" });
  });

  it("created_at ilegível → refaz", () => {
    expect(classifyLeadEvent(insert(realtimeRow(older, { created_at: "ontem" })), ctx())).toEqual({ kind: "refetch" });
  });
});

describe("DELETE (não filtrável por org no servidor)", () => {
  it("id desconhecido → ignora: pode ser de outra org", () => {
    expect(classifyLeadEvent(del("lead-de-outra-org"), ctx())).toEqual({ kind: "ignore" });
  });

  it("id que está em cache → remove e refaz", () => {
    expect(classifyLeadEvent(del("lead-7"), ctx())).toEqual({ kind: "remove", id: "lead-7" });
  });
});

describe("patch preserva joins e relação", () => {
  it("aplica só as colunas mudadas e mantém responsible, lead_tags e relacao_negocios", () => {
    const rows = [cachedRow(0), cachedRow(1)];
    const out = applyLeadChanges(rows, "lead-1", { notes: "novo", updated_at: "2026-10-05T12:30:00.123+00:00" });
    expect(out[1]).toEqual({ ...rows[1], notes: "novo", updated_at: "2026-10-05T12:30:00.123+00:00" });
    expect(out[1].responsible).toBe(rows[1].responsible);
    expect(out[1].lead_tags).toBe(rows[1].lead_tags);
    expect(out[0]).toBe(rows[0]);
  });

  it("sem a linha no cache, devolve o mesmo array (nada a fazer)", () => {
    const rows = [cachedRow(0)];
    expect(applyLeadChanges(rows, "lead-9", { notes: "x" })).toBe(rows);
  });
});

// ── TRAVA: toda coluna que decide quem está na lista é de recorte ──────────
//
// Se alguém acrescentar um filtro novo em `applyLeadListFilters` (ou uma
// ordenação) e esquecer de declarar a coluna aqui, o classificador passaria a
// fazer PATCH numa linha que deveria SAIR da tela. Este teste lê as colunas
// direto do builder, com todo filtro ligado, e falha antes do merge.

/** Colunas que um builder espião viu, inclusive dentro de `or()`. */
function columnsTouched(apply: (q: unknown) => unknown): Set<string> {
  const cols = new Set<string>();
  const fromOr = (expr: string) => {
    // `a.ilike.%x%,and(b.is.null,c.eq.y)` — separa no nível 0 de parênteses.
    let depth = 0;
    let cur = "";
    const parts: string[] = [];
    for (const ch of expr) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) {
      const m = /^(and|or)\((.*)\)$/.exec(p);
      if (m) fromOr(m[2]);
      else cols.add(p.split(".")[0]);
    }
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "is", "gte", "gt", "lte", "lt", "ilike", "like", "in", "not", "order"]) {
    builder[m] = (col: string) => {
      cols.add(col);
      return builder;
    };
  }
  builder.or = (expr: string) => {
    fromOr(expr);
    return builder;
  };
  apply(builder);
  return cols;
}

function assertAllMembership(cols: Set<string>) {
  for (const col of cols) {
    const inputs = LEAD_COMPUTED_FIELD_INPUTS[col];
    if (inputs) {
      for (const input of inputs) expect(LEAD_MEMBERSHIP_COLUMNS.has(input), `${col} ← ${input}`).toBe(true);
    } else {
      expect(LEAD_MEMBERSHIP_COLUMNS.has(col), col).toBe(true);
    }
  }
}

describe("LEAD_MEMBERSHIP_COLUMNS cobre todo recorte, ordem e join", () => {
  const variants = [
    { searchQuery: "(21) 99999-8888", filterOrigin: "meta_ads", filterQualification: "ouro", filterUf: "SP",
      createdFrom: "2026-01-01T00:00:00Z", createdTo: "2026-02-01T00:00:00Z", filterAssignment: "unassigned" as const,
      filterResponsible: "11111111-1111-1111-1111-111111111111", filterClassificacao: "cliente" },
    { filterQualification: "none", filterResponsible: "none", filterClassificacao: "perdido", usaLeiDoErp: true },
    { filterClassificacao: "lead", usaCadastroErpCafeJurere: true },
    { filterClassificacao: "indefinido", usaLeiDoErp: true },
  ];

  it.each(variants.map((v, i) => [i, v] as const))("filtros da lista/contagem/exportação (variante %i)", (_i, v) => {
    const cols = columnsTouched((q) => applyLeadListFilters(q, v));
    expect(cols.size).toBeGreaterThan(0);
    assertAllMembership(cols);
  });

  it.each(Object.keys(LEAD_SORT_COLUMNS) as LeadSortKey[])("ordenação por %s (e o desempate)", (key) => {
    for (const direction of ["asc", "desc"] as const) {
      assertAllMembership(columnsTouched((q) => applyLeadListSort(q, { key, direction })));
    }
  });

  it("guardas de tenancy, sombra e lixeira, e o recorte dos cards", () => {
    for (const col of ["organization_id", "is_shadow", "deleted_at", "created_at", "responsible_id"]) {
      expect(LEAD_MEMBERSHIP_COLUMNS.has(col), col).toBe(true);
    }
  });

  it("FKs dos joins embutidos na lista", () => {
    for (const fk of ["responsible_id", "sdr_id", "closer_id", "pre_sale_responsible_id", "sale_responsible_id"]) {
      expect(LEAD_MEMBERSHIP_COLUMNS.has(fk), fk).toBe(true);
    }
  });
});
