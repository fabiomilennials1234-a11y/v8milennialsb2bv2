/**
 * O Torque tem DOIS cards — o do Lead e o do Negócio — e eles nunca ficam
 * empilhados. Clicar na pessoa dentro do Negócio TROCA de card.
 *
 * Prova `inv:H5-11` (SCRUM-116).
 *
 * Por que isto é teste e não comentário: `DealCardPanel` e `LeadCardPanel` são
 * montados **lado a lado** no funil (`PipeWhatsapp`), cada um lendo o próprio
 * contexto. Nada na estrutura impede os dois de estarem abertos ao mesmo tempo
 * — o que impede é uma linha só, o `close()` antes do `openLead()` em
 * `DealCardPanel.abrirLead`. Trocar a ordem, esquecer o `close()` ou fazer o
 * link virar navegação pura deixa as duas fichas na tela, cada uma afirmando
 * uma coisa sobre a mesma pessoa — que é exatamente o estado que o modelo
 * Lead↔Negócio existe para acabar.
 *
 * Os dois painéis aqui são os de verdade, com os providers de verdade. Só o
 * acesso a banco é mockado: o que se está provando é a máquina de estados dos
 * dois contextos, e ela mora nos providers.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { DealCardData } from "@/modules/leads/components/deal-card/types";
import type { LeadCardData } from "@/modules/leads/components/lead-card/types";
import { NEGOCIO_ESTAGNADO } from "@/modules/leads/components/deal-card/fixtures";
import { LEAD_EXEMPLO } from "@/modules/leads/components/lead-card/fixtures";

// ── Só o banco é mockado ────────────────────────────────────────────────────
const negocioRef: { value: DealCardData | null } = { value: null };
vi.mock("@/modules/leads/components/deal-card/useDealCardData", () => ({
  useDealCardData: () => ({ data: negocioRef.value, isLoading: false }),
}));

/**
 * O mock responde À CHAVE PEDIDA, e não devolve o mesmo lead para qualquer id.
 * Sem isso, mandar o `pipeline_entries.id` no lugar do `leads.id` — a troca
 * mais fácil de fazer neste caminho, já que o card do Negócio tem os dois na
 * mão — passaria despercebida.
 */
const leadRef: { id: string; value: LeadCardData | null } = { id: "l1", value: null };
vi.mock("@/modules/leads/components/lead-card/useLeadCardData", () => ({
  useLeadCardData: (leadId: string | null) =>
    leadId === leadRef.id
      ? { data: leadRef.value, isLoading: false, visibility: "exists" }
      : { data: null, isLoading: false, visibility: "not_found" },
}));

vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn() }),
  useToggleLeadAI: () => ({ mutate: vi.fn() }),
  useDeleteLead: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
}));
vi.mock("@/modules/leads/components/lead-detail/modal/pipes/useCrossPipeMove", () => ({
  useCrossPipeMove: () => ({ move: vi.fn(), pendingStageKey: null, recentlyMovedStageKey: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
}));
vi.mock("@/shared/hooks/use-viewport", () => ({
  useViewport: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { LeadPanelProvider, useLeadSheet } from "@/modules/leads/components/lead-detail/hooks/useLeadSheet";
import { DealPanelProvider } from "@/modules/leads/components/deal-detail/DealPanelProvider";
import { useDealSheet } from "@/modules/leads/components/deal-detail/deal-sheet-context";
import { DealCardPanel } from "@/modules/leads/components/deal-card/DealCardPanel";
import { LeadCardPanel } from "@/modules/leads/components/lead-card/LeadCardPanel";

/** O card do funil: é ele quem abre o Negócio. */
function CardDoFunil() {
  const { openDeal } = useDealSheet();
  return (
    <button type="button" onClick={() => openDeal("e1", "l1")}>
      abrir negócio do funil
    </button>
  );
}

/** A linha da lista de Leads: é ela quem abre o Lead. */
function LinhaDaLista() {
  const { openLead } = useLeadSheet();
  return (
    <button type="button" onClick={() => openLead("l1")}>
      abrir lead da lista
    </button>
  );
}

/**
 * A montagem real do funil (`PipeWhatsapp`): `LeadPanelProvider` por fora do
 * `DealPanelProvider`, os dois painéis irmãos.
 */
function montarFunil() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LeadPanelProvider>
        <DealPanelProvider>
          <CardDoFunil />
          <LinhaDaLista />
          <DealCardPanel />
          <LeadCardPanel />
        </DealPanelProvider>
      </LeadPanelProvider>
    </QueryClientProvider>,
  );
}

/**
 * Títulos das fichas montadas — o card do Lead e o do Negócio usam `h1`.
 *
 * Varre o DOM, e não `getAllByRole`, de propósito. Quando dois diálogos Radix
 * empilham, o de baixo recebe `aria-hidden` e **some da árvore de
 * acessibilidade** — ou seja, uma consulta por papel devolveria "uma ficha só"
 * exatamente no caso que este arquivo existe para pegar. Medido: com o
 * `close()` removido de `DealCardPanel.abrirLead`, a versão por papel deixava
 * passar 4 dos 6 casos.
 */
function fichasAbertas(): string[] {
  return Array.from(document.querySelectorAll("h1")).map((h) => h.textContent ?? "");
}

const TITULO_NEGOCIO = NEGOCIO_ESTAGNADO.titulo;
const NOME_LEAD = LEAD_EXEMPLO.nome;

/**
 * Clicar na pessoa DENTRO do card do Negócio.
 *
 * Por `role: button` de propósito: a mesma empresa aparece como texto no card
 * do Lead depois da troca, e um `getByText` acharia os dois — o que esconderia
 * justamente a falha que este arquivo procura.
 */
function clicarNaPessoa() {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(NEGOCIO_ESTAGNADO.lead.empresa!, "i") }),
  );
}

describe("Os dois cards do Torque nunca ficam empilhados", () => {
  beforeEach(() => {
    negocioRef.value = { ...NEGOCIO_ESTAGNADO, lead: { ...NEGOCIO_ESTAGNADO.lead, id: "l1" } };
    leadRef.value = { ...LEAD_EXEMPLO, id: "l1" };
  });

  it("com nada aberto, nenhuma das duas fichas está montada", () => {
    montarFunil();

    expect(fichasAbertas()).toEqual([]);
  });

  it("o card do funil abre o Negócio — e SÓ o Negócio", () => {
    montarFunil();

    fireEvent.click(screen.getByText("abrir negócio do funil"));

    expect(fichasAbertas()).toEqual([TITULO_NEGOCIO]);
    expect(screen.queryByRole("heading", { level: 1, name: NOME_LEAD })).toBeNull();
  });

  it("clicar na pessoa TROCA de card: o Negócio fecha e o Lead abre", () => {
    montarFunil();
    fireEvent.click(screen.getByText("abrir negócio do funil"));

    clicarNaPessoa();

    // Uma ficha, e é a da pessoa. Duas aqui = duas verdades na tela.
    expect(fichasAbertas()).toEqual([NOME_LEAD]);
  });

  it("a lista de Leads abre o Lead sem arrastar o Negócio junto", () => {
    montarFunil();

    fireEvent.click(screen.getByText("abrir lead da lista"));

    expect(fichasAbertas()).toEqual([NOME_LEAD]);
  });

  it("fechar o Lead depois da troca deixa a tela limpa — o Negócio não ressuscita", () => {
    montarFunil();
    fireEvent.click(screen.getByText("abrir negócio do funil"));
    clicarNaPessoa();

    fireEvent.click(screen.getAllByRole("button", { name: /fechar/i })[0]);

    expect(fichasAbertas()).toEqual([]);
  });

  it("nunca há duas fichas ao mesmo tempo em nenhum ponto do vaivém funil↔pessoa", () => {
    montarFunil();

    const fechar = () => fireEvent.click(screen.getAllByRole("button", { name: /fechar/i })[0]);
    const passos = [
      () => fireEvent.click(screen.getByText("abrir negócio do funil")),
      clicarNaPessoa,
      fechar,
      () => fireEvent.click(screen.getByText("abrir negócio do funil")),
      clicarNaPessoa,
      fechar,
    ];

    for (const passo of passos) {
      passo();
      expect(fichasAbertas().length).toBeLessThanOrEqual(1);
    }

    expect(fichasAbertas()).toEqual([]);
  });
});

describe("O card do Negócio é a porta para a pessoa, não a ficha dela", () => {
  beforeEach(() => {
    negocioRef.value = { ...NEGOCIO_ESTAGNADO, lead: { ...NEGOCIO_ESTAGNADO.lead, id: "l1" } };
    leadRef.value = { ...LEAD_EXEMPLO, id: "l1" };
  });

  it("abre a pessoa pelo id do LEAD, não pelo id da entry do funil", () => {
    montarFunil();
    fireEvent.click(screen.getByText("abrir negócio do funil"));

    clicarNaPessoa();

    // O card montado é o do lead `l1`. Se tivesse ido o `entryId` ("e1"), o
    // mock devolveria `not_found` e a tela diria "Lead não encontrado".
    expect(fichasAbertas()).toEqual([NOME_LEAD]);
    expect(screen.queryByText(/lead não encontrado/i)).toBeNull();
  });

  it("negócio que sumiu embaixo do usuário diz isso, em vez de abrir ficha vazia", () => {
    negocioRef.value = null;
    montarFunil();

    fireEvent.click(screen.getByText("abrir negócio do funil"));

    expect(screen.getByText(/negócio não encontrado/i)).toBeInTheDocument();
    expect(fichasAbertas()).toEqual([]);
  });
});
