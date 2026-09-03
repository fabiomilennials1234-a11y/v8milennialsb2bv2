/**
 * O painel escolhe a tabela certa — e não fecha em cima de uma recusa.
 *
 * `excluir-negocio.test.tsx` prova o MOTOR: dado `ehSystem`, qual tabela. Este
 * arquivo prova o ELO ANTERIOR, que é onde o defeito estava e onde nenhum
 * teste chegava: quem calcula `ehSystem` a partir do negócio na tela.
 *
 * A primeira versão do diff roteava por `data.pipeTable`, que é NOME DE VIEW e
 * sai de um switch de slug com três casos. Funil de SISTEMA com qualquer outro
 * slug — `upsell`, e os funis de sistema novos — tem `pipeTable: null`, era
 * lido como custom, e o DELETE ia para `custom_pipe_entries` com um id que não
 * existe lá: zero linhas, card intacto na tela, e um aviso de permissão que é
 * mentira. O teste do motor não pegava isso porque já recebia a família pronta.
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

interface Escrita {
  tabela: string;
  op: string;
}
const escritas: Escrita[] = [];
/** Quantas linhas o DELETE devolve. `[]` = recusado pela RLS. */
let linhasApagadas: unknown[] = [{ id: "e1" }];
/** O que um SELECT de conferência encontra. */
let linhaAindaLa: unknown = { id: "e1" };

vi.mock("@/integrations/supabase/client", () => {
  function construtor(tabela: string) {
    const estado = { op: "" };
    const resolver = () => {
      escritas.push({ tabela, op: estado.op || "select" });
      if (estado.op === "delete") return { data: linhasApagadas, error: null };
      return { data: linhasApagadas.length ? [] : [], error: null };
    };
    const no: Record<string, unknown> = {
      delete: () => ((estado.op = "delete"), no),
      update: () => ((estado.op = "update"), no),
      insert: () => ((estado.op = "insert"), no),
      select: () => no,
      eq: () => no,
      in: () => no,
      order: () => no,
      limit: () => no,
      is: () => no,
      maybeSingle: () => {
        escritas.push({ tabela, op: "confere" });
        return Promise.resolve({ data: linhaAindaLa, error: null });
      },
      single: () => Promise.resolve({ data: null, error: null }),
      then: (r: (v: unknown) => unknown) => Promise.resolve(resolver()).then(r),
    };
    return no;
  }
  return { supabase: { from: (t: string) => construtor(t) } };
});

vi.mock("@/modules/identity/permissions/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
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
/** A coluna da pessoa monta `useUpdateLead`, que desce até `useAuth`. */
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

async function abrirEConfirmarExclusao() {
  const usuario = userEvent.setup();
  fireEvent.click(screen.getByText("abrir"));
  await usuario.click(await screen.findByTestId("deal-card-kebab"));
  await usuario.click(await screen.findByTestId("deal-card-excluir"));
  await usuario.click(await screen.findByTestId("deal-card-excluir-confirmar"));
}

const apagou = () => escritas.filter((e) => e.op === "delete");

beforeEach(() => {
  escritas.length = 0;
  linhasApagadas = [{ id: "e1" }];
  linhaAindaLa = { id: "e1" };
  negocioRef.value = null;
});

describe("O painel roteia por FAMÍLIA, não pelo nome da view", () => {
  it("funil de sistema fora do trio de slugs vai para pipeline_entries", async () => {
    negocioRef.value = {
      ...NEGOCIO_ESTAGNADO,
      funilEhSystem: true,
      funil: "Carteira",
    };
    montar();

    await abrirEConfirmarExclusao();

    await waitFor(() => expect(apagou()).toHaveLength(1));
    expect(apagou()[0].tabela).toBe("pipeline_entries");
  });

  it("funil custom vai para custom_pipe_entries", async () => {
    negocioRef.value = {
      ...NEGOCIO_ESTAGNADO,
      funilEhSystem: false,
      funil: "Reativação",
    };
    montar();

    await abrirEConfirmarExclusao();

    await waitFor(() => expect(apagou()).toHaveLength(1));
    expect(apagou()[0].tabela).toBe("custom_pipe_entries");
  });

  it("funil de sistema COM view de compat continua em pipeline_entries", async () => {
    negocioRef.value = {
      ...NEGOCIO_ESTAGNADO,
      funilEhSystem: true,
    };
    montar();

    await abrirEConfirmarExclusao();

    await waitFor(() => expect(apagou()).toHaveLength(1));
    expect(apagou()[0].tabela).toBe("pipeline_entries");
  });
});

describe("A caixa de confirmação não fecha em cima de uma recusa", () => {
  it("DELETE recusado (0 linhas, linha ainda lá) mantém a confirmação na tela", async () => {
    negocioRef.value = { ...NEGOCIO_ESTAGNADO, funilEhSystem: false };
    linhasApagadas = []; // a RLS recusou, sem erro
    linhaAindaLa = { id: "e1" }; // e a linha continua no banco
    montar();

    await abrirEConfirmarExclusao();

    // Fechar aqui reproduziria o sintoma que este diff veio matar: "confirmei,
    // a caixa sumiu, e o negócio continua na tela".
    await waitFor(() => expect(apagou()).toHaveLength(1));
    expect(screen.queryByTestId("deal-card-excluir-dialogo")).toBeTruthy();
  });

  it("card que já não existe fecha tudo em vez de prender o usuário", async () => {
    negocioRef.value = { ...NEGOCIO_ESTAGNADO, funilEhSystem: false };
    linhasApagadas = []; // 0 linhas...
    linhaAindaLa = null; // ...porque alguém já apagou noutra aba
    montar();

    await abrirEConfirmarExclusao();

    await waitFor(() =>
      expect(screen.queryByTestId("deal-card-excluir-dialogo")).toBeNull(),
    );
    expect(screen.queryByTestId("deal-card-kebab")).toBeNull();
  });
});
