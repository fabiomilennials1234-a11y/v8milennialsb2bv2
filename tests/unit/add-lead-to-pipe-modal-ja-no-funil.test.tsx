/**
 * Chamado 8186ae6c — "Adicionar lead ao funil" recusava com erro de suporte.
 *
 * Lead que já tem card aberto sem negócio no funil aparece marcado com a etapa,
 * e o card pode ser movido dali; a recusa do insert vira aviso, nunca erro com
 * código de suporte.
 */
import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toAppError } from "@/shared/errors/to-app-error";

const h = vi.hoisted(() => ({
  leads: [] as Array<Record<string, unknown>>,
  cards: [] as Array<Record<string, unknown>>,
  cardQueries: [] as Array<Record<string, unknown>>,
  mutateAsync: vi.fn(),
  notifyError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const calls: Record<string, unknown> = { table };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "is", "in", "limit"]) {
      chain[m] = (...args: unknown[]) => {
        calls[m] = args;
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (table === "pipeline_entries") h.cardQueries.push(calls);
      return Promise.resolve({
        data: table === "leads" ? h.leads : h.cards,
        error: null,
      }).then(resolve);
    };
    return chain;
  };
  return { supabase: { from } };
});
vi.mock("@/modules/identity", () => ({
  useCurrentTeamMember: () => ({ data: { id: "tm1", organization_id: "org-1" } }),
}));
vi.mock("@/modules/pipelines/hooks/custom/useCustomPipelines", () => ({
  useAddLeadToCustomPipe: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));
vi.mock("@/modules/leads", () => ({
  LeadModal: () => null,
  buscarLeadIdsPorTelefoneSecundario: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/shared/hooks/useDebounce", () => ({ useDebounce: (v: string) => v }));
vi.mock("@/shared/errors", async () => {
  const real = await import("@/shared/errors/to-app-error");
  return { notifyError: h.notifyError, toAppError: real.toAppError };
});
vi.mock("sonner", () => ({
  toast: { info: h.toastInfo, success: h.toastSuccess, error: vi.fn() },
}));

import { AddLeadToPipeModal } from "@/modules/pipelines/components/custom/AddLeadToPipeModal";

const stages = [
  { id: "s-prop", name: "Proposta Enviada", color: "#111", position: 1 },
  { id: "s-anal", name: "Análise de Embalagens", color: "#222", position: 2 },
] as never;

function renderModal(props: Partial<ComponentProps<typeof AddLeadToPipeModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AddLeadToPipeModal
        open
        onOpenChange={vi.fn()}
        pipelineId="p1"
        pipelineName="Envase"
        stages={stages}
        defaultStageId="s-prop"
        {...props}
      />
    </QueryClientProvider>,
  );
}

async function buscarEEscolher(nome: string) {
  fireEvent.change(screen.getByPlaceholderText(/Nome, empresa/), { target: { value: "irmaos" } });
  const linha = await screen.findByText(nome);
  fireEvent.click(linha);
}

const LEAD_COM_CARD = { id: "l-card", name: "CAFE IRMAOS BARBOSA", company: null, phone: null, email: null };
const LEAD_LIVRE = { id: "l-livre", name: "OUTRO LEAD", company: null, phone: null, email: null };

function recusaDoIndice() {
  return Object.assign(new Error("Este lead já está neste funil"), { code: "23505", details: "", hint: "" });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.cardQueries.length = 0;
  h.leads = [LEAD_COM_CARD, LEAD_LIVRE];
  h.cards = [{ id: "e1", lead_id: "l-card", stage_id: "s-anal" }];
});

describe("K1 — lead que já está no funil", () => {
  it("marca o lead com a etapa atual, com UMA consulta de cards para a busca toda", async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText(/Nome, empresa/), { target: { value: "irmaos" } });
    expect(await screen.findByText("Já neste funil · Análise de Embalagens")).toBeTruthy();
    expect(h.cardQueries).toHaveLength(1);
    expect(h.cardQueries[0].in).toEqual(["lead_id", ["l-card", "l-livre"]]);
    expect(h.cardQueries[0].eq).toEqual(["pipeline_id", "p1"]);
    expect(h.cardQueries[0].is).toBeDefined();
  });

  it("escolhido, avisa e oferece mover para a etapa escolhida", async () => {
    const mover = vi.fn().mockReturnValue(true);
    const onOpenChange = vi.fn();
    renderModal({ onMoverCardExistente: mover, onOpenChange });
    await buscarEEscolher("CAFE IRMAOS BARBOSA");
    expect(await screen.findByText("Este lead já está neste funil, na etapa Análise de Embalagens.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mover para Proposta Enviada" }));
    expect(mover).toHaveBeenCalledWith("e1", "s-prop");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it("devolveu false: manda arrastar o card, some o botão e não adiciona", async () => {
    const mover = vi.fn().mockReturnValue(false);
    renderModal({ onMoverCardExistente: mover });
    await buscarEEscolher("CAFE IRMAOS BARBOSA");
    fireEvent.click(await screen.findByRole("button", { name: "Mover para Proposta Enviada" }));
    expect(await screen.findByText("Arraste o card no quadro para mudar de etapa.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mover para/ })).toBeNull();
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it("etapa escolhida igual à atual: mover fica desabilitado", async () => {
    renderModal({ onMoverCardExistente: vi.fn(), defaultStageId: "s-anal" });
    await buscarEEscolher("CAFE IRMAOS BARBOSA");
    const botao = await screen.findByRole("button", { name: "Mover para Análise de Embalagens" });
    expect((botao as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem a prop, só o aviso: nenhum botão de mover", async () => {
    renderModal();
    await buscarEEscolher("CAFE IRMAOS BARBOSA");
    expect(await screen.findByText(/Este lead já está neste funil, na etapa/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mover para/ })).toBeNull();
  });

  it("lead sem card: o fluxo de adicionar segue igual", async () => {
    h.mutateAsync.mockResolvedValue({});
    renderModal({ onMoverCardExistente: vi.fn() });
    await buscarEEscolher("OUTRO LEAD");
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(h.mutateAsync).toHaveBeenCalledWith({ pipeline_id: "p1", lead_id: "l-livre", stage_id: "s-prop" }),
    );
    expect(screen.queryByRole("button", { name: /Mover para/ })).toBeNull();
  });
});

describe("K2 — recusa do insert", () => {
  it("a recusa tipada do hook é record.duplicate e não reportável", () => {
    const app = toAppError(recusaDoIndice());
    expect(app.code).toBe("record.duplicate");
    expect(app.reportable).toBe(false);
    expect(app.userMessage).toBe("Este lead já está neste funil");
  });

  it("o modal avisa com toast.info, sem notifyError", async () => {
    h.mutateAsync.mockRejectedValue(recusaDoIndice());
    renderModal();
    await buscarEEscolher("OUTRO LEAD");
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(h.toastInfo).toHaveBeenCalled());
    expect(h.notifyError).not.toHaveBeenCalled();
  });

  it("erro inesperado continua em notifyError", async () => {
    h.mutateAsync.mockRejectedValue(new Error("boom"));
    renderModal();
    await buscarEEscolher("OUTRO LEAD");
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(h.notifyError).toHaveBeenCalled());
    expect(h.toastInfo).not.toHaveBeenCalled();
  });
});
