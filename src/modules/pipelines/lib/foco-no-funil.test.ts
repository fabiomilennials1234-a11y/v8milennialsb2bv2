import {
  aplicarFocoNaColuna,
  aplicarFocoNoBoard,
  decidirIrAoNegocio,
  ehFocoDoNegocio,
  focoEfetivo,
  linhaFocada,
  type FocoDoNegocio,
} from "./foco-no-funil";

type Linha = { id: string; stage_key: string; nome: string };
const card = (id: string, stage_key = "novo"): Linha => ({ id, stage_key, nome: id });

describe("aplicarFocoNaColuna", () => {
  const naturais = [card("a"), card("b"), card("c")];

  it("sem foco, a coluna é exatamente a de hoje (mesmo array)", () => {
    expect(aplicarFocoNaColuna("novo", naturais, null)).toBe(naturais);
  });

  it("o negócio focado entra no TOPO da coluna dele, mesmo que nenhuma página o tenha trazido", () => {
    const foco = card("z");
    expect(aplicarFocoNaColuna("novo", naturais, foco).map((l) => l.id)).toEqual(["z", "a", "b", "c"]);
  });

  it("já carregado mais abaixo: sobe para o topo e a cópia natural sai (sem id duplicado)", () => {
    const foco = card("b");
    expect(aplicarFocoNaColuna("novo", naturais, foco).map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("a linha focada vale sobre a do cache (é a mais fresca)", () => {
    const fresca = { ...card("b"), nome: "renomeado" };
    const [primeiro] = aplicarFocoNaColuna("novo", naturais, fresca);
    expect(primeiro.nome).toBe("renomeado");
  });

  it("noutra coluna, cache velho com o negócio não o mostra duas vezes", () => {
    const foco = card("b", "em_andamento");
    expect(aplicarFocoNaColuna("novo", naturais, foco).map((l) => l.id)).toEqual(["a", "c"]);
    expect(aplicarFocoNaColuna("em_andamento", [card("x", "em_andamento")], foco).map((l) => l.id)).toEqual(["b", "x"]);
  });

  it("noutra coluna sem o negócio, devolve o mesmo array (não re-renderiza à toa)", () => {
    const foco = card("z", "em_andamento");
    expect(aplicarFocoNaColuna("novo", naturais, foco)).toBe(naturais);
  });
});

const foco = (over: Partial<FocoDoNegocio> = {}): FocoDoNegocio => ({
  entryId: "z",
  pipelineId: "p1",
  stageKey: "em_andamento",
  leadId: "lead-z",
  visivel: true,
  linha: { id: "z", stage_key: "em_andamento", lead_id: "lead-z" },
  ...over,
});

describe("linhaFocada", () => {
  it("só há linha para fixar quando o recorte mostra o negócio", () => {
    expect(linhaFocada(foco())?.id).toBe("z");
    expect(linhaFocada(foco({ visivel: false, linha: null }))).toBeNull();
    expect(linhaFocada(null)).toBeNull();
    expect(linhaFocada(undefined)).toBeNull();
  });
});

describe("aplicarFocoNoBoard", () => {
  const stageData = {
    novo: { items: [card("a"), card("z")], totalCount: 30, hasMore: true, isFetchingMore: false, fetchMore: () => {}, isLoading: false },
    em_andamento: { items: [card("b", "em_andamento")], totalCount: 9, hasMore: false, isFetchingMore: false, fetchMore: () => {}, isLoading: false },
  };

  it("sem foco visível, devolve o MESMO objeto (nada re-renderiza)", () => {
    expect(aplicarFocoNoBoard(stageData, null)).toBe(stageData);
    expect(aplicarFocoNoBoard(stageData, foco({ visivel: false, linha: null }))).toBe(stageData);
  });

  it("fixa o negócio no topo da etapa dele e o tira das outras; o resto da coluna fica igual", () => {
    const board = aplicarFocoNoBoard(stageData, foco());
    expect(board.em_andamento.items.map((l) => (l as { id: string }).id)).toEqual(["z", "b"]);
    expect(board.novo.items.map((l) => (l as { id: string }).id)).toEqual(["a"]);
    expect(board.novo.totalCount).toBe(30);
    expect(board.novo.hasMore).toBe(true);
  });
});

describe("aplicarFocoNoBoard — a versão mais nova é a fixada", () => {
  const ids = (b: Record<string, { items: unknown[] }>, s: string) => b[s].items.map((l) => (l as { id: string }).id);

  it("a coluna releu antes do foco (card noutra etapa): fixa a versão DELA no topo da etapa dela, nunca em duas", () => {
    // Realtime de outra pessoa: "novo" já tem a cópia nova; "em_andamento" ainda a velha.
    const stageData = {
      novo: { items: [{ id: "x", stage_key: "novo" }, { id: "z", stage_key: "novo", updated_at: "2026-11-10T13:00:00Z" }] },
      em_andamento: { items: [{ id: "b", stage_key: "em_andamento" }, { id: "z", stage_key: "em_andamento", updated_at: "2026-11-10T12:00:00Z" }] },
    };
    const velho = foco({ linha: { id: "z", stage_key: "em_andamento", updated_at: "2026-11-10T12:00:00Z" } });
    const board = aplicarFocoNoBoard(stageData, velho);
    expect(ids(board, "novo")).toEqual(["z", "x"]);
    expect(ids(board, "em_andamento")).toEqual(["b"]);
    expect((board.novo.items[0] as { updated_at: string }).updated_at).toBe("2026-11-10T13:00:00Z");
  });

  it("o foco é o mais novo (cópia natural velha): vale o do foco", () => {
    const stageData = {
      novo: { items: [{ id: "z", stage_key: "novo", updated_at: "2026-11-10T12:00:00Z" }] },
      em_andamento: { items: [{ id: "b", stage_key: "em_andamento" }] },
    };
    const novo = foco({ linha: { id: "z", stage_key: "em_andamento", updated_at: "2026-11-10T13:00:00Z" } });
    const board = aplicarFocoNoBoard(stageData, novo);
    expect(ids(board, "em_andamento")).toEqual(["z", "b"]);
    expect(ids(board, "novo")).toEqual([]);
  });
});

describe("focoEfetivo (o que pode ser fixado NESTE board)", () => {
  const etapas = new Set(["novo", "em_andamento"]);
  const linha = { id: "z", stage_key: "em_andamento", pipeline_id: "p1" };

  it("só fixa o negócio pedido, deste funil, numa etapa que o board mostra", () => {
    expect(focoEfetivo(foco({ linha }), { entryId: "z", pipelineId: "p1", etapas })?.entryId).toBe("z");
  });

  it("ENVASE e VAREJO têm as mesmas chaves de etapa: foco de outro funil nunca é fixado", () => {
    expect(focoEfetivo(foco({ pipelineId: "p2", linha: { ...linha, pipeline_id: "p2" } }), { entryId: "z", pipelineId: "p1", etapas })).toBeNull();
  });

  it("resposta de outro pedido, escondido pelo recorte ou em etapa fora do board: nada fixado", () => {
    expect(focoEfetivo(foco({ linha }), { entryId: "y", pipelineId: "p1", etapas })).toBeNull();
    expect(focoEfetivo(foco({ visivel: false, linha: null }), { entryId: "z", pipelineId: "p1", etapas })).toBeNull();
    expect(focoEfetivo(foco({ stageKey: "arquivada", linha: { ...linha, stage_key: "arquivada" } }), { entryId: "z", pipelineId: "p1", etapas })).toBeNull();
    expect(focoEfetivo(null, { entryId: "z", pipelineId: "p1", etapas })).toBeNull();
  });
});

describe("decidirIrAoNegocio", () => {
  const base = { pipelineId: "p1", etapas: new Set(["novo", "em_andamento"]), mobile: false, meusAtivo: false, jaMostrouTodos: false };

  it("a pessoa não vê o negócio (ou ele não existe mais)", () => {
    expect(decidirIrAoNegocio(null, base)).toEqual({ tipo: "indisponivel" });
  });

  it("o negócio é de outro funil: vai para o board certo", () => {
    expect(decidirIrAoNegocio(foco({ pipelineId: "p2" }), base)).toEqual({ tipo: "outro-funil", pipelineId: "p2" });
  });

  it('"Meus" esconde: mostra todos NESTA visita (sem gravar a preferência), uma vez só', () => {
    const escondido = foco({ visivel: false, linha: null });
    expect(decidirIrAoNegocio(escondido, { ...base, meusAtivo: true })).toEqual({ tipo: "mostrar-todos" });
    expect(decidirIrAoNegocio(escondido, { ...base, meusAtivo: true, jaMostrouTodos: true })).toEqual({ tipo: "filtro-esconde" });
  });

  it("outro filtro esconde: avisa e oferece limpar", () => {
    expect(decidirIrAoNegocio(foco({ visivel: false, linha: null }), base)).toEqual({ tipo: "filtro-esconde" });
  });

  it("etapa que o board não mostra (inativa)", () => {
    expect(decidirIrAoNegocio(foco({ stageKey: "arquivada" }), base)).toEqual({ tipo: "etapa-fora" });
  });

  it("no celular não há board: abre o painel do negócio", () => {
    expect(decidirIrAoNegocio(foco(), { ...base, mobile: true })).toEqual({ tipo: "abrir-painel", entryId: "z", leadId: "lead-z" });
  });

  it("caso feliz: leva até o card na etapa ATUAL dele", () => {
    expect(decidirIrAoNegocio(foco(), base)).toEqual({ tipo: "levar", entryId: "z", stageKey: "em_andamento" });
  });
});

describe("ehFocoDoNegocio", () => {
  it("reconhece o dado da query de foco e recusa o de coluna (paginado)", () => {
    expect(ehFocoDoNegocio(foco())).toBe(true);
    expect(ehFocoDoNegocio({ pages: [[]], pageParams: [null] })).toBe(false);
    expect(ehFocoDoNegocio(null)).toBe(false);
  });
});
