/**
 * Revisão — "Lead quente" saiu das sugestões (decisão do CTO, 02/10).
 *
 * "Lead quente" é `qualification_score >= 70` calculado na edge
 * `get-daily-priorities`, e o score do lead não é mais usado no produto. A
 * edge AINDA devolve `leads_quentes` (a limpeza do backend é outra entrega),
 * então a garantia mora no front, em dois lugares:
 *
 *   1. o total "Sugestões (N)" não conta `leads_quentes`;
 *   2. nenhuma linha "Lead quente" é desenhada, mesmo com a lista cheia.
 *
 * Os dados de propósito trazem MAIS leads quentes do que o resto — se a soma
 * ou a renderização voltarem a olhar o campo, o número e o texto denunciam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Dublês ───────────────────────────────────────────────

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token-de-teste" } } }),
    },
  },
}));

vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ timezone: "America/Sao_Paulo" }),
  useUserRole: () => ({ data: { role: "member" } }),
  useCurrentTeamMember: () => ({ data: { id: "tm-1" } }),
  useTeamMembers: () => ({ data: [] }),
  useFeaturePermission: () => ({ allowed: false }),
}));

// `vi.hoisted`: o `vi.mock` sobe para o topo do arquivo e não enxerga `const`.
const { mutacao } = vi.hoisted(() => ({ mutacao: () => ({ mutate: () => {} }) }));
vi.mock("@/modules/engagement/hooks/useFollowUps", () => ({
  useFollowUps: () => ({ data: [], isLoading: false }),
  useCompleteFollowUp: mutacao,
  useUpdateFollowUp: mutacao,
  useArchiveFollowUp: mutacao,
  useDeleteFollowUp: mutacao,
}));

vi.mock("@/modules/communication/hooks/useScheduledMessages", () => ({
  useMyScheduledMessages: () => ({ data: [], isLoading: false }),
  useCancelScheduledMessage: mutacao,
}));

// Filhos pesados que não participam deste contrato.
vi.mock("@/modules/engagement/components/revisao/RevisionItem", () => ({
  RevisionItem: () => null,
}));
vi.mock("@/modules/engagement/components/followups/AutomationSettings", () => ({
  AutomationSettings: () => null,
}));
vi.mock("@/modules/engagement/components/followups/ScheduleFollowUpModal", () => ({
  ScheduleFollowUpModal: () => null,
}));

import Revisao from "@/modules/engagement/pages/Revisao";
import {
  contarSugestoesDoDia,
  useDailyPriorities,
  type DailyPrioritiesData,
  type PriorityLead,
} from "@/modules/engagement/hooks/useDailyPriorities";

// ── Fixtures ─────────────────────────────────────────────

function lead(id: string, name: string, score = 10): PriorityLead {
  return {
    id,
    name,
    company: null,
    phone: null,
    email: null,
    qualification_score: score,
    updated_at: "2026-10-01T12:00:00Z",
    pipe_type: null,
    pipe_status: null,
    last_action_at: null,
  };
}

const RESPOSTA: DailyPrioritiesData = {
  leads_sem_acao: [lead("s1", "Sem Contato Um"), lead("s2", "Sem Contato Dois")],
  followups_vencidos: [
    {
      id: "f1",
      title: "Retomar proposta",
      description: null,
      due_date: "2026-09-28T12:00:00Z",
      priority: "normal",
      source_pipe: null,
      days_overdue: 4,
      lead: { id: "l9", name: "Vencido Nove", company: null, phone: null },
    },
  ],
  // Mais quentes do que todo o resto somado: 3 ≠ 3 + 5.
  leads_quentes: [
    lead("q1", "Quente Um", 95),
    lead("q2", "Quente Dois", 90),
    lead("q3", "Quente Tres", 85),
    lead("q4", "Quente Quatro", 80),
    lead("q5", "Quente Cinco", 75),
  ],
  generated_at: "2026-10-02T09:00:00Z",
};

function novoQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => RESPOSTA })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Testes ───────────────────────────────────────────────

describe("contarSugestoesDoDia", () => {
  it("soma só lead sem contato e follow-up vencido — leads_quentes não conta", () => {
    expect(contarSugestoesDoDia(RESPOSTA)).toBe(3);
  });

  it("tolera resposta sem leads_quentes (backend já limpo) e resposta ausente", () => {
    const { leads_quentes: _ignorado, ...semQuentes } = RESPOSTA;
    expect(contarSugestoesDoDia(semQuentes)).toBe(3);
    expect(contarSugestoesDoDia(undefined)).toBe(0);
  });
});

describe("useDailyPriorities", () => {
  it("totalPending ignora leads_quentes mesmo quando a edge os devolve", async () => {
    const client = novoQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useDailyPriorities(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.leads_quentes).toHaveLength(5);
    expect(result.current.totalPending).toBe(3);
  });
});

describe("Revisão — faixa de sugestões", () => {
  function renderRevisao() {
    return render(
      <MemoryRouter>
        <QueryClientProvider client={novoQueryClient()}>
          <Revisao />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  }

  it("anuncia 3 sugestões e não desenha nenhuma linha de lead quente", async () => {
    renderRevisao();

    const cabecalho = await screen.findByRole("button", { name: /Sugestões/ });
    // O contador fica dentro do botão: 3, não 8.
    expect(cabecalho).toHaveTextContent(/Sugestões\s*3/);

    expect(screen.getByText("Sem Contato Um")).toBeInTheDocument();
    expect(screen.getByText("Vencido Nove")).toBeInTheDocument();
    expect(screen.getAllByText(/Lead sem contato:/)).toHaveLength(2);
    expect(screen.getAllByText(/Follow-up vencido:/)).toHaveLength(1);

    expect(screen.queryByText(/Lead quente/i)).toBeNull();
    expect(screen.queryByText(/Quente Um/)).toBeNull();
  });
});
