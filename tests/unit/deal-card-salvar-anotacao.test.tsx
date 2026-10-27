/**
 * A anotação do negócio só "salva" se alguma linha foi gravada.
 *
 * UPDATE barrado por RLS volta 200 com zero linhas e sem `error`. Sem conferir
 * as linhas, a pessoa digitava, saía do campo, não via aviso nenhum — e o texto
 * sumia no próximo refetch (Chamado: "não dá de salvar o que é escrito aqui").
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { DealCardData } from "@/modules/leads/components/deal-card/types";
import { NEGOCIO_ESTAGNADO } from "@/modules/leads/components/deal-card/fixtures";

const negocioRef: { value: DealCardData | null } = { value: null };
vi.mock("@/modules/leads/components/deal-card/useDealCardData", () => ({
  useDealCardData: () => ({ data: negocioRef.value, isLoading: false }),
}));

/** Linhas que o UPDATE devolve. `[]` = recusado pela RLS. */
let linhasGravadas: unknown[] = [{ id: "e1" }];
const updates: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client", () => {
  function construtor() {
    const no: Record<string, unknown> = {
      update: (valores: Record<string, unknown>) => (updates.push(valores), no),
      delete: () => no,
      insert: () => no,
      select: () => no,
      eq: () => no,
      in: () => no,
      order: () => no,
      limit: () => no,
      is: () => no,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: linhasGravadas, error: null }).then(r),
    };
    return no;
  }
  return { supabase: { from: () => construtor() } };
});

vi.mock("@/modules/identity/permissions/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
}));
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
  logLeadActionDirect: vi.fn(),
}));
vi.mock("@/modules/leads/components/lead-detail/modal/pipes/useCrossPipeMove", () => ({
  useCrossPipeMove: () => ({ move: vi.fn(), pendingStageKey: null, recentlyMovedStageKey: null }),
}));
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: () => ({ data: null, isLoading: false, visibility: "not_found" }),
}));
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";
import { DealPanelProvider } from "@/modules/leads/components/deal-detail/DealPanelProvider";
import { useDealSheet } from "@/modules/leads/components/deal-detail/deal-sheet-context";
import { DealCardPanel } from "@/modules/leads/components/deal-card/DealCardPanel";
import { LeadPanelProvider } from "@/modules/leads/components/lead-detail/hooks/useLeadSheet";

function Abridor() {
  const { openDeal } = useDealSheet();
  return (
    <button type="button" onClick={() => openDeal("e1", "l1")}>
      abrir
    </button>
  );
}

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeadPanelProvider>
        <DealPanelProvider>
          <Abridor />
          <DealCardPanel />
        </DealPanelProvider>
      </LeadPanelProvider>
    </QueryClientProvider>,
  );
}

async function digitarESair(texto: string) {
  const usuario = userEvent.setup();
  fireEvent.click(screen.getByText("abrir"));
  const campo = await screen.findByRole("textbox", { name: /anotação do negócio/i });
  await usuario.clear(campo);
  await usuario.type(campo, texto);
  fireEvent.blur(campo);
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  updates.length = 0;
  linhasGravadas = [{ id: "e1" }];
  negocioRef.value = { ...NEGOCIO_ESTAGNADO, nota: "antiga" };
});

describe("Painel do negócio — salvar anotação", () => {
  it("grava em pipeline_entries.notes e não reclama quando a linha foi gravada", async () => {
    montar();
    await digitarESair("Cliente pediu desconto");

    await waitFor(() => expect(updates).toContainEqual({ notes: "Cliente pediu desconto" }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("avisa quando o UPDATE volta com zero linhas (RLS) — não finge que salvou", async () => {
    linhasGravadas = [];
    montar();
    await digitarESair("Cliente pediu desconto");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível salvar a anotação")),
    );
  });
});
