/**
 * Regressão — a gravação adiada precisa saber PARA QUAL ORG ela é.
 *
 * O painel do Estúdio sobe com debounce de 800 ms. Entre agendar e disparar
 * cabe uma troca de organização — e antes deste teste o destino saía do
 * closure de `gravar` no momento do disparo, não do momento da edição. Em
 * 26/08/2026 isso carimbou um layout na org errada em produção.
 *
 * A asserção que mede o defeito é a do `organization_id` no corpo do upsert:
 * fazendo o destino voltar a sair do render atual, ela quebra.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createWrapper } from "../../../../tests/helpers/hook-test-utils";

const upsert = vi.fn().mockResolvedValue({ error: null });
const maybeSingle = vi.fn().mockResolvedValue({ data: { layout: [] }, error: null });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert: (...args: unknown[]) => upsert(...args),
    }),
  },
}));

const contexto = { organizationId: "org-A" as string | null, teamMemberId: "tm-A" as string | null, isReady: true };

vi.mock("@/modules/identity", () => ({
  useOrganization: () => contexto,
  isVirtualTeamMember: (id: string | null | undefined) => !!id && id.startsWith("master-virtual-"),
}));

import { useMetricsStudioPanel } from "./useMetricsStudioPanel";

/** O painel deixou de ser um por org — a persistência agora carrega por id. */
const PAINEL_ID = "11111111-1111-1111-1111-111111111111";

const janela = { id: "w-1", metricId: "leads_criados", corte: "total", x: 8, y: 8, w: 280, h: 132, chart: "number", z: 1 } as never;

describe("useMetricsStudioPanel — o destino viaja junto com a gravação", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    upsert.mockClear();
    contexto.organizationId = "org-A";
    contexto.teamMemberId = "tm-A";
    contexto.isReady = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("🚨 trocar de org NÃO descarrega a gravação pendente antes da hora", async () => {
    const { result, rerender } = renderHook(() => useMetricsStudioPanel(PAINEL_ID), { wrapper: createWrapper() });

    act(() => result.current.save([janela]));

    // A troca de org acontece DENTRO da janela do debounce.
    //
    // Era aqui que o cleanup de `[gravar]` disparava: trocar de org mudava
    // `organizationId`, `gravar` ganhava identidade nova, React derrubava o
    // efeito e o cleanup gravava NA HORA — no meio do `invalidateQueries()` do
    // `switchOrg`. Em 26/08/2026 o que estava pendente era o `[]` fantasma da
    // hidratação, e foi ele que chegou ao banco.
    contexto.organizationId = "org-B";
    contexto.teamMemberId = "tm-B";
    rerender();

    expect(upsert).not.toHaveBeenCalled();

    // Só o debounce grava — e grava para a org da EDIÇÃO, não a da troca.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      organization_id: "org-A",
      team_member_id: "tm-A",
    });
  });

  it("master vira NULL em team_member_id — o id virtual não é uuid de team_members", async () => {
    contexto.teamMemberId = "master-virtual-abc";
    const { result } = renderHook(() => useMetricsStudioPanel(PAINEL_ID), { wrapper: createWrapper() });

    act(() => result.current.save([janela]));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(upsert.mock.calls[0][0]).toMatchObject({ organization_id: "org-A", team_member_id: null });
  });

  it("sem org resolvida não agenda gravação nenhuma", async () => {
    contexto.organizationId = null;
    contexto.isReady = false;
    const { result } = renderHook(() => useMetricsStudioPanel(PAINEL_ID), { wrapper: createWrapper() });

    act(() => result.current.save([janela]));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(upsert).not.toHaveBeenCalled();
  });
});
