/**
 * O Lead e o Negócio abrem JUNTOS, num overlay só.
 *
 * ── `inv:H5-11` (SCRUM-116) foi APOSENTADO em 22/08/2026 ──────────────────
 *
 * O invariante antigo dizia o contrário: "os dois cards nunca ficam
 * empilhados; clicar na pessoa dentro do Negócio TROCA de card". Ele existia
 * porque as duas fichas eram overlays irmãos e independentes — deixar as duas
 * abertas punha duas verdades sobre a mesma pessoa na tela ao mesmo tempo.
 *
 * O painel de duas colunas resolve o mesmo problema por outro caminho, e o
 * resolve melhor: em vez de proibir a segunda ficha, ele deixa de existir. A
 * pessoa passou a ser uma COLUNA de 356px dentro do painel do Negócio
 * (`LeadCardContainer forma="coluna"`), montada a partir do MESMO `leadId`.
 * Não há duas verdades porque não há duas fichas — há uma tela só, com as
 * duas metades do mesmo assunto.
 *
 * O que continua valendo, e é o que este arquivo guarda:
 *
 *   1. NUNCA dois overlays empilhados. O motivo original não mudou; o que
 *      mudou é que agora o risco é o painel do Lead abrir POR CIMA do painel
 *      do Negócio, em vez de ao lado dele;
 *   2. a coluna recebe o id do LEAD, nunca o `pipeline_entries.id`. Os dois
 *      estão na mão de quem abre o painel, e trocar um pelo outro é o erro
 *      mais fácil deste caminho — daria "Lead não encontrado" numa coluna que
 *      deveria mostrar a pessoa;
 *   3. fechar o painel leva as DUAS colunas junto — nada sobrevive por baixo.
 *
 * Os painéis aqui são os de verdade, com os providers de verdade. Só o acesso
 * a banco é mockado: o que se está provando é a máquina de estados dos dois
 * contextos, e ela mora nos providers.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
/**
 * O portão de "Excluir negócio" lê a SESSÃO: `useFeaturePermission` desce por
 * `useCurrentTeamMember` até `useAuth`, que **lança** fora do `AuthProvider` —
 * e este arquivo monta os painéis de verdade sem ele, de propósito (o que se
 * prova aqui é a máquina de estados dos dois contextos, não a autorização).
 *
 * Mock PARCIAL, e no módulo-fonte em vez do barril: `@/modules/identity` é
 * porta de entrada de meia dúzia de coisas que estes painéis usam, e substituí-lo
 * inteiro trocaria um provider ausente por um grafo inteiro fingido.
 */
vi.mock("@/modules/identity/permissions/hooks/useUserRole", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
}));
/** Mesmo motivo: `useLogLeadAction` desce por `useOrganization` até `useAuth`. */
vi.mock("@/shared/hooks/useLogLeadAction", () => ({
  useLogLeadAction: () => vi.fn(),
  logLeadActionDirect: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
}));
/**
 * A faixa de etiquetas do card do Lead fala com banco — e, por `useOrganization`,
 * com o `AuthContext`, cujo `useAuth` LANÇA fora do provider. Esta montagem não
 * tem `AuthProvider` de propósito (o que se prova aqui é a máquina de estados
 * dos dois painéis), então os hooks dela entram na lista de mocks pela mesma
 * razão que `useLeads` e `useCrossPipeMove` já estavam nela.
 */
vi.mock("@/modules/leads/hooks/lead/useLeadTagsAttached", () => ({
  useLeadTagsAttached: () => ({ data: [], isLoading: false }),
  useAddLeadTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useRemoveLeadTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock("@/modules/leads/hooks/useTags", () => ({
  useTags: () => ({ data: [], isLoading: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
/**
 * `LeadCardPanel` lê `role` para decidir se oferece CRIAR etiqueta nova.
 * O mock é do MÓDULO FUNDO, não do barril `@/modules/identity`: o barril
 * reexporta daqui, então isto basta para o painel — e o resto do barril
 * (`useAuth`, `useMasterAuth`, tipos) continua real para quem mais precisar.
 */
vi.mock("@/modules/identity/org-team/hooks/useOrganization", () => ({
  useOrganization: () => ({
    organizationId: "org-1",
    teamMemberId: "tm-1",
    role: "admin",
    orgType: "crm",
    timezone: null,
    isLoading: false,
    isReady: true,
    error: null,
  }),
  useRequiredOrganization: () => ({ organizationId: "org-1" }),
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
 * Overlays montados. Antes bastava contar `h1` porque cada ficha tinha o seu;
 * agora a coluna da pessoa não emite `h1` (o título da tela é o do negócio),
 * então quem responde "quantas telas estão empilhadas" é o número de diálogos.
 *
 * Radix marca o diálogo de baixo com `aria-hidden` quando outro empilha por
 * cima — por isso a varredura é no DOM, e não por papel: uma consulta por
 * papel devolveria "um só" exatamente no caso que este arquivo existe para
 * pegar.
 */
/**
 * ⚠️ `[role=alertdialog]` entra junto, e não é detalhe.
 *
 * O Radix marca o `AlertDialogContent` com `role="alertdialog"`, não `dialog`.
 * Enquanto o seletor era só `[role=dialog]`, o contador que dá nome a este
 * arquivo era CEGO à confirmação de "Excluir negócio" — a suíte ficaria verde
 * mesmo que alguém movesse aquele `AlertDialog` para dentro do `DealCard`, que
 * é o lugar aparentemente óbvio (o item de menu vive lá) e o que os comentários
 * de `DealCardPanel` e `DealCard` dizem, em prosa, que não se pode fazer.
 * Prosa não é guarda.
 */
function overlaysAbertos(): number {
  return document.querySelectorAll("[role=dialog],[role=alertdialog]").length;
}

/**
 * O "X" do overlay. O rótulo é "Close" — vem do primitivo do Radix, não da
 * nossa tradução — então a busca aceita os dois, para não quebrar no dia em
 * que alguém traduzir.
 */
function fecharOverlay() {
  fireEvent.click(screen.getAllByRole("button", { name: /close|fechar/i })[0]);
}

/**
 * Timeout explícito, pelo mesmo motivo de `lead-card-novo-negocio.test.tsx`.
 *
 * ⚠️ HERDADO — este arquivo já estourava o default de 5s do Vitest ANTES do
 * SCRUM-124 (medido: com o diff em stash, 1 de 8 casos reprova por tempo). Cada
 * caso monta os dois cards de produção em jsdom, e o caso do vaivém completo
 * monta e remonta várias vezes. Não é asserção errada: com `--testTimeout=30000`
 * os 8 passam.
 *
 * Entra aqui em vez de virar issue porque (a) é a MESMA correção que a #1460 já
 * aplicou no arquivo irmão — segunda ocorrência da mesma classe, e a segunda é
 * quando vale arrumar em vez de anotar; e (b) o SCRUM-124 faz três funis a mais
 * montarem estes dois cards, então deixar o teto apertado seria empurrar o
 * problema justamente enquanto se aumenta a superfície.
 *
 * 20s é folga para runner lento e ainda curto para um travamento de verdade
 * (promise que nunca resolve) continuar reprovando em vez de pendurar a suíte.
 */
const TIMEOUT_RENDER_MS = 20_000;

describe("O Lead e o Negócio abrem juntos, num overlay só", { timeout: TIMEOUT_RENDER_MS }, () => {
  beforeEach(() => {
    negocioRef.value = { ...NEGOCIO_ESTAGNADO, lead: { ...NEGOCIO_ESTAGNADO.lead, id: "l1" } };
    leadRef.value = { ...LEAD_EXEMPLO, id: "l1" };
  });

  it("com nada aberto, nenhuma das duas fichas está montada", () => {
    montarFunil();

    expect(fichasAbertas()).toEqual([]);
    expect(overlaysAbertos()).toBe(0);
  });

  it("o card do funil abre UM overlay com o negócio E a coluna da pessoa", () => {
    montarFunil();

    fireEvent.click(screen.getByText("abrir negócio do funil"));

    // Um overlay só, com o negócio dando o título da tela...
    expect(overlaysAbertos()).toBe(1);
    expect(fichasAbertas()).toEqual([TITULO_NEGOCIO]);
    // ...e a pessoa presente ali dentro, como coluna e não como segunda ficha.
    // `getAll` porque o nome aparece duas vezes na coluna: no cabeçalho dela e
    // de novo como campo editável em "Perfil".
    expect(screen.getAllByText(NOME_LEAD).length).toBeGreaterThan(0);
  });

  it("mexer na pessoa dentro da coluna não abre uma segunda ficha", () => {
    montarFunil();
    fireEvent.click(screen.getByText("abrir negócio do funil"));

    // A empresa continua clicável — mas agora é campo EDITÁVEL da coluna, não
    // o link que trocava de card. Clicar tem de deixar a tela como estava.
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(NEGOCIO_ESTAGNADO.lead.empresa!, "i") }),
    );

    expect(overlaysAbertos()).toBe(1);
    expect(fichasAbertas()).toEqual([TITULO_NEGOCIO]);
  });

  /**
   * A confirmação de excluir é a única exceção à conta de um overlay só, e não
   * é uma segunda FICHA — que é o que este arquivo proíbe. É um passo modal
   * sobre a tela que a disparou, e sai assim que se decide.
   *
   * ⚠️ **Um guarda anterior aqui era tautológico e foi removido.** Ele
   * afirmava que a confirmação nunca é DESCENDENTE do painel no DOM. Isso é
   * verdade sempre, inclusive quando ela é aninhada no React: o
   * `AlertDialogContent` sai por `AlertDialogPortal`, direto no `body`. O teste
   * não podia falhar. Medido em 27/08/2026 movendo o `AlertDialog` para dentro
   * do `DealCard` — nos DOIS arranjos o Esc fecha só a confirmação e o painel
   * sobrevive, e nos dois o DOM é idêntico.
   *
   * O que fica é o que o usuário sente e o que PODE quebrar: abrir a
   * confirmação não pode derrubar o painel, e desistir dela tem de devolver a
   * tela em que ele estava — e não fechar as duas coisas de uma vez.
   */
  it("abrir e desistir da confirmação de excluir devolve o painel intacto", async () => {
    montarFunil();
    fireEvent.click(screen.getByText("abrir negócio do funil"));
    expect(overlaysAbertos()).toBe(1);

    // `userEvent`, não `fireEvent`: o `DropdownMenuTrigger` do Radix abre em
    // `pointerdown`, e um `click` sintético do fireEvent não o alcança.
    const usuario = userEvent.setup();
    await usuario.click(screen.getByTestId("deal-card-kebab"));
    await usuario.click(await screen.findByTestId("deal-card-excluir"));

    // Com a confirmação aberta o painel continua montado, com a MESMA ficha.
    expect(await screen.findByTestId("deal-card-excluir-dialogo")).toBeTruthy();
    expect(fichasAbertas()).toEqual([TITULO_NEGOCIO]);

    await usuario.keyboard("{Escape}");

    expect(screen.queryByTestId("deal-card-excluir-dialogo")).toBeNull();
    expect(overlaysAbertos()).toBe(1);
    expect(fichasAbertas()).toEqual([TITULO_NEGOCIO]);
  });

  it("a lista de Leads abre o Lead sem arrastar o Negócio junto", () => {
    montarFunil();

    fireEvent.click(screen.getByText("abrir lead da lista"));

    expect(fichasAbertas()).toEqual([NOME_LEAD]);
    expect(overlaysAbertos()).toBe(1);
  });

  it("fechar o painel leva as DUAS colunas junto — nada sobra por baixo", () => {
    montarFunil();
    fireEvent.click(screen.getByText("abrir negócio do funil"));

    fecharOverlay();

    expect(fichasAbertas()).toEqual([]);
    expect(overlaysAbertos()).toBe(0);
    expect(screen.queryByText(NOME_LEAD)).toBeNull();
  });

  it("nunca há dois overlays empilhados em nenhum ponto do vaivém funil↔pessoa", () => {
    montarFunil();

    const fechar = () => fecharOverlay();
    const passos = [
      () => fireEvent.click(screen.getByText("abrir negócio do funil")),
      fechar,
      () => fireEvent.click(screen.getByText("abrir lead da lista")),
      fechar,
      () => fireEvent.click(screen.getByText("abrir negócio do funil")),
      fechar,
    ];

    for (const passo of passos) {
      passo();
      // O risco de hoje não é a ficha ao lado: é o painel do Lead abrindo POR
      // CIMA do painel do Negócio. Um overlay, no máximo, em todo ponto.
      expect(overlaysAbertos()).toBeLessThanOrEqual(1);
      expect(fichasAbertas().length).toBeLessThanOrEqual(1);
    }

    expect(overlaysAbertos()).toBe(0);
  });
});

describe("A coluna da pessoa é alimentada pelo id do LEAD, não pelo da entry", () => {
  beforeEach(() => {
    negocioRef.value = { ...NEGOCIO_ESTAGNADO, lead: { ...NEGOCIO_ESTAGNADO.lead, id: "l1" } };
    leadRef.value = { ...LEAD_EXEMPLO, id: "l1" };
  });

  it("monta a coluna com o lead `l1`, não com a entry `e1`", () => {
    montarFunil();

    fireEvent.click(screen.getByText("abrir negócio do funil"));

    // Quem abre o painel tem os dois ids na mão, e trocar um pelo outro é o
    // erro mais fácil deste caminho. Se fosse o `entryId` ("e1"), o mock
    // devolveria `not_found` e a coluna diria "Lead não encontrado".
    expect(screen.getAllByText(NOME_LEAD).length).toBeGreaterThan(0);
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
