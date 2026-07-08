/**
 * Optimistic drag-and-drop do board WhatsApp (fix1) — helper puro sobre o
 * QueryClient. Reproduz o shape real do `usePaginatedPipeline`: uma
 * `useInfiniteQuery` por etapa (`["pipeline-page", slug, stageKey, org, filters]`,
 * data `{ pages: Entry[][], pageParams }`) + contagens em
 * `["pipeline-stage-counts", slug, org, filters]`.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  optimisticMovePipelineEntry,
  rollbackPipelineEntryMove,
} from "@/modules/pipelines/lib/optimistic-move";

const ORG = "org-1";
const FK = '{"filters":"none"}';

const pageKey = (stage: string) => ["pipeline-page", "whatsapp", stage, ORG, FK];
const countsKey = () => ["pipeline-stage-counts", "whatsapp", ORG, FK];

function inf(entries: Record<string, unknown>[]) {
  return { pages: [entries], pageParams: [null] };
}

function seed(qc: QueryClient) {
  qc.setQueryData(pageKey("novo"), inf([
    { id: "e1", stage_key: "novo", status: "novo", lead: { name: "Ana" } },
    { id: "e2", stage_key: "novo", status: "novo", lead: { name: "Beto" } },
  ]));
  qc.setQueryData(pageKey("abordado"), inf([
    { id: "e3", stage_key: "abordado", status: "abordado", lead: { name: "Cauê" } },
  ]));
  qc.setQueryData(countsKey(), { novo: 2, abordado: 1 });
}

function stageIds(qc: QueryClient, stage: string): string[] {
  const data = qc.getQueryData(pageKey(stage)) as { pages: Record<string, unknown>[][] } | undefined;
  return (data?.pages.flat() ?? []).map((e) => e.id as string);
}

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  seed(qc);
});

describe("optimisticMovePipelineEntry", () => {
  it("remove o card da origem e insere no topo do destino", () => {
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e1", toStage: "abordado" });

    expect(stageIds(qc, "novo")).toEqual(["e2"]);
    expect(stageIds(qc, "abordado")).toEqual(["e1", "e3"]); // topo da 1ª página
  });

  it("reescreve stage_key/status do card movido", () => {
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e1", toStage: "abordado" });
    const moved = (qc.getQueryData(pageKey("abordado")) as { pages: Record<string, unknown>[][] })
      .pages.flat().find((e) => e.id === "e1")!;
    expect(moved.stage_key).toBe("abordado");
    expect(moved.status).toBe("abordado");
    expect((moved.lead as { name: string }).name).toBe("Ana"); // preserva o resto
  });

  it("ajusta as contagens (-1 origem, +1 destino)", () => {
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e1", toStage: "abordado" });
    expect(qc.getQueryData(countsKey())).toEqual({ novo: 1, abordado: 2 });
  });

  it("nunca deixa contagem negativa", () => {
    qc.setQueryData(countsKey(), { novo: 0, abordado: 1 });
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e1", toStage: "abordado" });
    expect((qc.getQueryData(countsKey()) as Record<string, number>).novo).toBe(0);
  });

  it("semeia a 1ª página quando a coluna de destino está vazia/sem cache", () => {
    qc.setQueryData(pageKey("abordado"), inf([])); // etapa carregada porém vazia
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e2", toStage: "abordado" });
    expect(stageIds(qc, "abordado")).toEqual(["e2"]);
  });

  it("não duplica se o card já estiver no destino", () => {
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e1", toStage: "abordado" });
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e1", toStage: "abordado" });
    expect(stageIds(qc, "abordado").filter((id) => id === "e1")).toHaveLength(1);
  });

  it("é no-op quando o card não está em nenhum cache", () => {
    const before = JSON.stringify(qc.getQueryData(pageKey("novo")));
    optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "inexistente", toStage: "abordado" });
    expect(JSON.stringify(qc.getQueryData(pageKey("novo")))).toBe(before);
    expect(qc.getQueryData(countsKey())).toEqual({ novo: 2, abordado: 1 });
  });
});

describe("rollbackPipelineEntryMove", () => {
  it("restaura páginas e contagens exatamente ao estado anterior", () => {
    const novoBefore = JSON.stringify(qc.getQueryData(pageKey("novo")));
    const abordadoBefore = JSON.stringify(qc.getQueryData(pageKey("abordado")));
    const countsBefore = JSON.stringify(qc.getQueryData(countsKey()));

    const snap = optimisticMovePipelineEntry(qc, { slug: "whatsapp", id: "e1", toStage: "abordado" });
    // mudou de fato
    expect(JSON.stringify(qc.getQueryData(pageKey("novo")))).not.toBe(novoBefore);

    rollbackPipelineEntryMove(qc, snap);

    expect(JSON.stringify(qc.getQueryData(pageKey("novo")))).toBe(novoBefore);
    expect(JSON.stringify(qc.getQueryData(pageKey("abordado")))).toBe(abordadoBefore);
    expect(JSON.stringify(qc.getQueryData(countsKey()))).toBe(countsBefore);
  });
});
