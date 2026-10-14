/**
 * Etiquetas no import de planilha — o lado da edge `import-leads`.
 *
 * A edge roda com service_role: o filtro por org em `resolveImportTagIds` é a
 * ÚNICA coisa entre um id vindo do navegador e um `lead_tags` gravado. Se este
 * arquivo ficar verde com a checagem removida, ele não prende nada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyImportTags,
  resolveImportTagIds,
  MAX_IMPORT_TAGS,
} from "../../supabase/functions/import-leads/import-tags";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "22222222-2222-4222-8222-222222222222";
const TAG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TAG_DE_OUTRA_ORG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const CATALOGO = [
  { id: TAG_A, organization_id: ORG },
  { id: TAG_B, organization_id: ORG },
  { id: TAG_DE_OUTRA_ORG, organization_id: OUTRA_ORG },
];

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
}

interface Upsert {
  rows: { lead_id: string; tag_id: string }[];
  opts: Record<string, unknown>;
}

function bancoFalso(opts: { loteQueFalha?: number } = {}) {
  const consultasDeTags: { filtros: Record<string, unknown>; ids: string[] }[] = [];
  const upserts: Upsert[] = [];

  const db = {
    from(tabela: string) {
      if (tabela === "tags") {
        const filtros: Record<string, unknown> = {};
        const q = {
          select: () => q,
          eq: (coluna: string, valor: unknown) => {
            filtros[coluna] = valor;
            return q;
          },
          in: async (_coluna: string, ids: string[]) => {
            consultasDeTags.push({ filtros: { ...filtros }, ids });
            const data = CATALOGO.filter(
              (t) => t.organization_id === filtros.organization_id && ids.includes(t.id),
            ).map((t) => ({ id: t.id }));
            return { data, error: null };
          },
        };
        return q;
      }
      if (tabela === "lead_tags") {
        return {
          upsert: async (rows: Upsert["rows"], o: Record<string, unknown>) => {
            upserts.push({ rows, opts: o });
            const falhou = opts.loteQueFalha === upserts.length;
            return { error: falhou ? { message: "deadlock detected" } : null };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };

  return { db, consultasDeTags, upserts };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveImportTagIds — o id do navegador só vale se for da org", () => {
  it("recusa etiqueta de outra org (cross-tenant)", async () => {
    const { db } = bancoFalso();

    const r = await resolveImportTagIds(db, ORG, [TAG_A, TAG_DE_OUTRA_ORG]);

    expect(r.ok).toBe(false);
  });

  it("consulta o catálogo filtrando pela org resolvida do token", async () => {
    const { db, consultasDeTags } = bancoFalso();

    await resolveImportTagIds(db, ORG, [TAG_A]);

    expect(consultasDeTags).toHaveLength(1);
    expect(consultasDeTags[0].filtros.organization_id).toBe(ORG);
  });

  it("aceita etiquetas da org, sem repetição e em caixa baixa", async () => {
    const { db } = bancoFalso();

    const r = await resolveImportTagIds(db, ORG, [TAG_A, TAG_A.toUpperCase(), TAG_B]);

    expect(r).toEqual({ ok: true, tagIds: [TAG_A, TAG_B] });
  });

  it.each([
    ["ausente", undefined],
    ["nulo", null],
    ["lista vazia", []],
  ])("sem etiquetas (%s) não consulta o banco", async (_caso, raw) => {
    const { db, consultasDeTags } = bancoFalso();

    const r = await resolveImportTagIds(db, ORG, raw);

    expect(r).toEqual({ ok: true, tagIds: [] });
    expect(consultasDeTags).toHaveLength(0);
  });

  it.each([
    ["texto solto", "tag-a"],
    ["id que não é uuid", ["tag-a"]],
    ["número", [42]],
    ["objeto", [{ id: TAG_A }]],
  ])("recusa formato inválido (%s) sem consultar o banco", async (_caso, raw) => {
    const { db, consultasDeTags } = bancoFalso();

    const r = await resolveImportTagIds(db, ORG, raw);

    expect(r.ok).toBe(false);
    expect(consultasDeTags).toHaveLength(0);
  });

  it(`recusa mais de ${MAX_IMPORT_TAGS} etiquetas`, async () => {
    const { db } = bancoFalso();
    const muitas = Array.from({ length: MAX_IMPORT_TAGS + 1 }, (_, i) => uuid(i + 1));

    const r = await resolveImportTagIds(db, ORG, muitas);

    expect(r.ok).toBe(false);
  });
});

describe("applyImportTags — gravação em lote", () => {
  it("grava lead × etiqueta sem reescrever o que já existia", async () => {
    const { db, upserts } = bancoFalso();

    const r = await applyImportTags(db, ["lead-1", "lead-2"], [TAG_A, TAG_B]);

    expect(r).toEqual({ leads: 2, failed: 0 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].opts).toEqual({ onConflict: "lead_id,tag_id", ignoreDuplicates: true });
    expect(upserts[0].rows).toEqual([
      { lead_id: "lead-1", tag_id: TAG_A },
      { lead_id: "lead-1", tag_id: TAG_B },
      { lead_id: "lead-2", tag_id: TAG_A },
      { lead_id: "lead-2", tag_id: TAG_B },
    ]);
  });

  it("2.000 leads viram poucos upserts de no máximo 500 linhas", async () => {
    const { db, upserts } = bancoFalso();
    const leads = Array.from({ length: 2000 }, (_, i) => `lead-${i}`);

    const r = await applyImportTags(db, leads, [TAG_A, TAG_B, uuid(3)]);

    expect(r).toEqual({ leads: 2000, failed: 0 });
    expect(upserts.length).toBe(Math.ceil(2000 / Math.floor(500 / 3)));
    for (const u of upserts) expect(u.rows.length).toBeLessThanOrEqual(500);
    expect(upserts.flatMap((u) => u.rows)).toHaveLength(6000);
  });

  it("lead repetido na planilha é etiquetado uma vez só", async () => {
    const { db, upserts } = bancoFalso();

    const r = await applyImportTags(db, ["lead-1", "lead-1"], [TAG_A]);

    expect(r.leads).toBe(1);
    expect(upserts[0].rows).toHaveLength(1);
  });

  it("lote que falha conta como falha e não derruba os outros", async () => {
    const { db, upserts } = bancoFalso({ loteQueFalha: 1 });
    const leads = Array.from({ length: 600 }, (_, i) => `lead-${i}`);

    const r = await applyImportTags(db, leads, [TAG_A]);

    expect(upserts).toHaveLength(2);
    expect(r).toEqual({ leads: 100, failed: 500 });
  });

  it("sem lead ou sem etiqueta não escreve nada", async () => {
    const { db, upserts } = bancoFalso();

    expect(await applyImportTags(db, [], [TAG_A])).toEqual({ leads: 0, failed: 0 });
    expect(await applyImportTags(db, ["lead-1"], [])).toEqual({ leads: 0, failed: 0 });
    expect(upserts).toHaveLength(0);
  });
});
