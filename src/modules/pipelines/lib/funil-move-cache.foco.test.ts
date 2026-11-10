import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  __limparEcosProprios,
  aplicarMoveOtimista,
  cancelarFetchDoMove,
  colunaDoFoco,
  planejarInvalidacaoRealtime,
  reconciliarMoveNoFunil,
  reverterMoveOtimista,
} from "./funil-move-cache";
import { FOCO_SEGMENTO, type FocoDoNegocio } from "./foco-no-funil";

const PL = "pl-1";
const CHAVE_FOCO = ["pipeline-page", PL, FOCO_SEGMENTO, "org-1", "f", "z"];

const foco = (over: Partial<FocoDoNegocio> = {}): FocoDoNegocio => ({
  entryId: "z",
  pipelineId: PL,
  stageKey: "a",
  leadId: "lead-z",
  visivel: true,
  linha: { id: "z", stage_key: "a", lead_id: "lead-z" },
  ...over,
});

function montar(f: FocoDoNegocio | null = foco()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Coluna "a" (o card focado NÃO está nas páginas carregadas: posição 900).
  qc.setQueryData(["pipeline-page", PL, "a", "org-1", "f"], { pages: [[{ id: "e-1", stage_key: "a" }]], pageParams: [null] });
  qc.setQueryData(["pipeline-page", PL, "b", "org-1", "f"], { pages: [[{ id: "e-2", stage_key: "b" }]], pageParams: [null] });
  qc.setQueryData(["pipeline-stage-counts", PL, "org-1", "{}"], { a: 900, b: 5 });
  if (f) qc.setQueryData(CHAVE_FOCO, f);
  return qc;
}

beforeEach(() => __limparEcosProprios());

describe("colunaDoFoco", () => {
  it("diz se o card só está no foco (e não numa página da coluna)", () => {
    const qc = montar();
    expect(colunaDoFoco(qc, PL, "z")).toBe(FOCO_SEGMENTO);
    expect(colunaDoFoco(qc, PL, "e-1")).toBeNull();
    expect(colunaDoFoco(montar(null), PL, "z")).toBeNull();
  });
});

describe("move otimista do card focado", () => {
  it("o foco anda junto: o card salta para o topo da coluna de destino e as contagens acompanham", () => {
    const qc = montar();
    const move = aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "z", toStage: "b" });

    const f = qc.getQueryData<FocoDoNegocio>(CHAVE_FOCO)!;
    expect(f.stageKey).toBe("b");
    expect(f.linha?.stage_key).toBe("b");
    const b = qc.getQueryData<{ pages: Array<Array<{ id: string }>> }>(["pipeline-page", PL, "b", "org-1", "f"])!;
    expect(b.pages[0].map((l) => l.id)).toEqual(["z", "e-2"]);
    expect(qc.getQueryData(["pipeline-stage-counts", PL, "org-1", "{}"])).toEqual({ a: 899, b: 6 });
    expect(move.snapshot.fromStage).toBe("a");
  });

  it("erro no move: o rollback devolve o foco e as colunas como estavam", () => {
    const qc = montar();
    const move = aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "z", toStage: "b" });
    reverterMoveOtimista(qc, move);
    expect(qc.getQueryData<FocoDoNegocio>(CHAVE_FOCO)!.stageKey).toBe("a");
    expect(qc.getQueryData(["pipeline-stage-counts", PL, "org-1", "{}"])).toEqual({ a: 900, b: 5 });
  });

  it("mover OUTRO card não mexe no foco", () => {
    const qc = montar();
    aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "e-1", toStage: "b" });
    expect(qc.getQueryData<FocoDoNegocio>(CHAVE_FOCO)!.stageKey).toBe("a");
  });

  it("uma variante por filtro: a fonte é a que o board mostra — a sem linha não trava as contagens", () => {
    const qc = montar();
    const ativa = new QueryObserver(qc, { queryKey: CHAVE_FOCO, enabled: false }).subscribe(() => {});
    // Criada DEPOIS (o Map do cache guarda a ordem): um filtro que escondia o card.
    qc.setQueryData(["pipeline-page", PL, FOCO_SEGMENTO, "org-1", "g", "z"], foco({ visivel: false, linha: null }));
    aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "z", toStage: "b" });
    expect(qc.getQueryData(["pipeline-stage-counts", PL, "org-1", "{}"])).toEqual({ a: 899, b: 6 });
    ativa();
  });

  it("variante velha sem observador diz 'a'; a do board diz 'b': o move desconta 'b'", () => {
    const qc = montar(foco({ stageKey: "b", linha: { id: "z", stage_key: "b", lead_id: "lead-z" } }));
    qc.setQueryData(["pipeline-stage-counts", PL, "org-1", "{}"], { a: 900, b: 5, c: 3 });
    const ativa = new QueryObserver(qc, { queryKey: CHAVE_FOCO, enabled: false }).subscribe(() => {});
    qc.setQueryData(["pipeline-page", PL, FOCO_SEGMENTO, "org-1", "g", "z"], foco());
    const move = aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "z", toStage: "c" });
    expect(move.snapshot.fromStage).toBe("b");
    expect(qc.getQueryData(["pipeline-stage-counts", PL, "org-1", "{}"])).toEqual({ a: 900, b: 4, c: 4 });
    ativa();
  });

  it("foco que o recorte esconde (sem linha) não é inserido em coluna nenhuma", () => {
    const qc = montar(foco({ visivel: false, linha: null }));
    aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "z", toStage: "b" });
    const b = qc.getQueryData<{ pages: Array<Array<{ id: string }>> }>(["pipeline-page", PL, "b", "org-1", "f"])!;
    expect(b.pages[0].map((l) => l.id)).toEqual(["e-2"]);
  });
});

describe("Realtime e reconciliação enxergam o foco", () => {
  it("evento do card focado inclui o foco no plano (a linha dele refaz)", () => {
    const qc = montar();
    const plano = planejarInvalidacaoRealtime(qc, PL, {
      eventType: "UPDATE",
      new: { id: "z", pipeline_id: PL, stage_key: "b" },
      old: { id: "z" },
    });
    expect(plano?.stages).toEqual(expect.arrayContaining([FOCO_SEGMENTO, "b"]));
  });

  it("evento de outro card não toca no foco", () => {
    const qc = montar();
    const plano = planejarInvalidacaoRealtime(qc, PL, {
      eventType: "UPDATE",
      new: { id: "e-1", pipeline_id: PL, stage_key: "b" },
      old: { id: "e-1" },
    });
    expect(plano?.stages).not.toContain(FOCO_SEGMENTO);
  });

  it("reconciliar o move do card focado refaz o foco; de outro card, não", () => {
    const qc = montar();
    reconciliarMoveNoFunil(qc, { pipelineId: PL, entryId: "e-1", fromStage: "a", toStage: "b" });
    expect(qc.getQueryState(CHAVE_FOCO)?.isInvalidated).toBe(false);
    reconciliarMoveNoFunil(qc, { pipelineId: PL, entryId: "z", fromStage: "a", toStage: "b" });
    expect(qc.getQueryState(CHAVE_FOCO)?.isInvalidated).toBe(true);
  });
});

describe("leitura do foco em voo durante o move", () => {
  it("a resposta velha não desfaz o otimismo: o move cancela a leitura do foco do card", async () => {
    const qc = montar();
    let soltar!: (f: FocoDoNegocio) => void;
    const emVoo = qc
      .fetchQuery({ queryKey: CHAVE_FOCO, queryFn: () => new Promise<FocoDoNegocio>((r) => (soltar = r)), staleTime: 0 })
      .catch(() => null);
    await cancelarFetchDoMove(qc, { pipelineId: PL, stages: ["a", "b"], entryId: "z" });
    aplicarMoveOtimista(qc, { pipelineId: PL, entryId: "z", toStage: "b" });
    soltar(foco()); // a resposta que saiu antes do move: etapa "a"
    await emVoo;
    expect(qc.getQueryData<FocoDoNegocio>(CHAVE_FOCO)!.stageKey).toBe("b");
  });

  it("1ª leitura (ainda sem dado) cancelada pelo move: a reconciliação a faz buscar de novo", async () => {
    const qc = montar(null);
    void qc.prefetchQuery({ queryKey: CHAVE_FOCO, queryFn: () => new Promise<FocoDoNegocio>(() => {}) });
    expect(qc.getQueryState(CHAVE_FOCO)?.fetchStatus).toBe("fetching");
    await cancelarFetchDoMove(qc, { pipelineId: PL, stages: ["a", "b"], entryId: "z" });
    expect(qc.getQueryState(CHAVE_FOCO)?.fetchStatus).toBe("idle");
    reconciliarMoveNoFunil(qc, { pipelineId: PL, entryId: "z", fromStage: "a", toStage: "b" });
    expect(qc.getQueryState(CHAVE_FOCO)?.isInvalidated).toBe(true);
  });

  it("mover OUTRO card não interrompe a leitura do foco", async () => {
    const qc = montar();
    void qc.fetchQuery({ queryKey: CHAVE_FOCO, queryFn: () => new Promise<FocoDoNegocio>(() => {}), staleTime: 0 }).catch(() => null);
    await cancelarFetchDoMove(qc, { pipelineId: PL, stages: ["a", "b"], entryId: "e-1" });
    expect(qc.getQueryState(CHAVE_FOCO)?.fetchStatus).toBe("fetching");
  });
});
