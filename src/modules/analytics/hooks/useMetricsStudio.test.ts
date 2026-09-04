/**
 * Regressão — o painel do Estúdio é DA ORGANIZAÇÃO, e trocar de organização
 * não remonta a página.
 *
 * O ACIDENTE QUE ESTE ARQUIVO EXISTE PARA IMPEDIR (26/08/2026, medido em prod):
 * o painel da org Milennials virou `[]`. A escrita saiu no mesmo milissegundo
 * do `invalidateQueries()` do `useOrgSwitcher` — o master estava saindo da
 * Milennials para outra org. A hidratação era um booleano de "já hidratei uma
 * vez"; como `useOrgSwitcher` só invalida queries e **não recarrega a página**,
 * o booleano ficava ligado para sempre: o painel da org nova era buscado do
 * banco e nunca aplicado, a tela seguia com as janelas da org anterior, e a
 * primeira mexida gravava aquele layout na org errada.
 *
 * As duas asserções que importam são as NEGATIVAS — que nada é gravado
 * enquanto a cópia de trabalho não pertence à org atual. Elas medem o defeito:
 * voltando `hidratadoDe` para booleano, as duas quebram.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";
import type { EngineMetric } from "@/modules/analytics/lib/metrics-studio-engine-map";

const painel = {
  organizationId: null as string | null,
  layout: null as StudioWindow[] | null,
  isLoading: false,
  save: vi.fn(),
  isSaving: false,
};

vi.mock("./useMetricsStudioPanel", () => ({
  useMetricsStudioPanel: () => painel,
}));

import { useMetricsStudio } from "./useMetricsStudio";

/**
 * Aba ativa fixa. O hook passou a receber o painel (fatia 2 das abas): sem id
 * ele fica inerte de propósito, e todo teste de estado mediria vazio.
 */
const PAINEL_ID = "11111111-1111-1111-1111-111111111111";

/**
 * `moveWindow` — e não `addMetric` — é o gatilho de mudança destes testes.
 * Arrastar é a interação mais barata que produz array novo, e não exige montar
 * uma `EngineMetric` de mentira só para o catálogo resolver.
 */
function janela(id: string): StudioWindow {
  return { id, metricId: "leads_criados", corte: "total", x: 8, y: 8, w: 280, h: 132, chart: "number", z: 1 };
}

const CATALOGO_VAZIO = new Map<string, EngineMetric>();

describe("useMetricsStudio — a cópia de trabalho pertence a UMA organização", () => {
  beforeEach(() => {
    painel.organizationId = null;
    painel.layout = null;
    painel.isLoading = false;
    painel.save = vi.fn();
  });

  it("não grava nada enquanto a organização não resolveu", () => {
    // `layout` vale `[]` (não `null`) quando o contexto ainda não resolveu — é
    // por isso que "layout vazio" nunca pode, sozinho, autorizar gravação.
    painel.organizationId = null;
    painel.layout = [];

    const { result } = renderHook(() => useMetricsStudio(CATALOGO_VAZIO, PAINEL_ID));

    expect(result.current.windows).toEqual([]);
    expect(painel.save).not.toHaveBeenCalled();
  });

  it("hidrata com o painel da org e só grava depois de o usuário mexer", () => {
    painel.organizationId = "org-A";
    painel.layout = [janela("a-1")];

    const { result } = renderHook(() => useMetricsStudio(CATALOGO_VAZIO, PAINEL_ID));

    // Hidratação NÃO é mudança: chegar do servidor não pode devolver escrita.
    expect(result.current.windows).toHaveLength(1);
    expect(painel.save).not.toHaveBeenCalled();

    act(() => result.current.moveWindow("a-1", 100, 100));

    expect(painel.save).toHaveBeenCalledTimes(1);
    expect(painel.save.mock.calls[0][0][0]).toMatchObject({ id: "a-1", x: 100, y: 100 });
  });

  it("🚨 trocar de org limpa o canvas e NÃO grava o painel da org anterior", () => {
    painel.organizationId = "org-A";
    painel.layout = [janela("a-1")];

    const { result, rerender } = renderHook(() => useMetricsStudio(CATALOGO_VAZIO, PAINEL_ID));
    expect(result.current.windows).toHaveLength(1);

    // A troca: `organizationId` já é o novo, o painel do novo ainda não chegou.
    painel.organizationId = "org-B";
    painel.layout = null;
    painel.isLoading = true;
    rerender();

    // Se as janelas de A continuassem na tela, o usuário editaria o painel
    // errado sem saber — o acidente da Milennials, exatamente.
    expect(result.current.windows).toEqual([]);
    expect(painel.save).not.toHaveBeenCalled();
  });

  it("🚨 reidrata com o painel da org NOVA em vez de ficar preso no da antiga", () => {
    painel.organizationId = "org-A";
    painel.layout = [janela("a-1")];

    const { result, rerender } = renderHook(() => useMetricsStudio(CATALOGO_VAZIO, PAINEL_ID));

    painel.organizationId = "org-B";
    painel.layout = null;
    painel.isLoading = true;
    rerender();

    painel.layout = [janela("b-1"), janela("b-2")];
    painel.isLoading = false;
    rerender();

    expect(result.current.windows.map((w) => w.id)).toEqual(["b-1", "b-2"]);
    // Reidratar também é chegada do servidor, não mudança.
    expect(painel.save).not.toHaveBeenCalled();

    // E daqui em diante a gravação volta a valer — para B.
    act(() => result.current.moveWindow("b-1", 50, 50));
    expect(painel.save).toHaveBeenCalledTimes(1);
    expect(painel.save.mock.calls[0][0]).toHaveLength(2);
  });

  it("voltar para a org anterior reidrata do servidor, não do que sobrou na tela", () => {
    painel.organizationId = "org-A";
    painel.layout = [janela("a-1")];
    const { result, rerender } = renderHook(() => useMetricsStudio(CATALOGO_VAZIO, PAINEL_ID));

    painel.organizationId = "org-B";
    painel.layout = [janela("b-1"), janela("b-2")];
    rerender();
    expect(result.current.windows).toHaveLength(2);

    painel.organizationId = "org-A";
    painel.layout = [janela("a-1")];
    rerender();

    expect(result.current.windows.map((w) => w.id)).toEqual(["a-1"]);
    expect(painel.save).not.toHaveBeenCalled();
  });
});
