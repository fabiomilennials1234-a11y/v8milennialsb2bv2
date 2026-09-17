import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadDetailContent } from "@/modules/leads/components/lead/LeadDetailContent";

const state = vi.hoisted(() => ({
  lead: { id: "lead-1", name: "ELIEZER 7937 SEXTA", company: "", email: "", notes: "", phone: "5515996310303", segment: "", interest: "" },
  update: vi.fn(),
  refetch: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: state.error } }));
vi.mock("@/modules/leads/hooks/useLeads", () => ({
  useUpdateLead: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock("@/modules/communication/hooks/useWhatsAppLeadIntegration", () => ({
  useLeadByPhone: () => {
    const [lead, setLead] = useState(state.lead);
    return { data: lead, isLoading: false, refetch: async () => { state.refetch(); setLead({ ...state.lead }); } };
  },
}));
vi.mock("@/shared/hooks/useLogLeadAction", () => ({ useLogLeadAction: () => vi.fn() }));
vi.mock("@/modules/leads/hooks/useLeadAllPipelines", () => ({ useLeadAllPipelines: () => ({ data: [] }) }));
vi.mock("@/modules/leads/hooks/useLeadTimeline", () => ({ useLeadTimelineCompact: () => ({ data: [] }) }));
vi.mock("@/modules/leads/hooks/lead/useLeadCampaignsAttach", () => ({ useLeadCampaignsAttach: () => ({ activeCampanhas: [] }) }));
vi.mock("@/modules/leads/hooks/lead/useLeadPipeHandlers", () => ({ useLeadPipeHandlers: () => ({}) }));
vi.mock("@/modules/leads/hooks/lead/useLeadCreateHandler", () => ({ useLeadCreateHandler: () => ({}) }));
vi.mock("@/modules/leads/hooks/useLeadCustomFields", () => ({
  useLeadCustomFields: () => ({ data: [] }),
  useLeadCustomFieldValues: () => ({ data: [] }),
  useSaveCustomFieldValue: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/modules/leads/components/lead/info/LeadQualification", () => ({ LeadQualification: () => null }));
vi.mock("@/modules/leads/components/lead/info/LeadSource", () => ({ LeadSource: () => null }));
vi.mock("@/modules/leads/components/lead/info/AddCustomFieldPopover", () => ({ AddCustomFieldPopover: () => null }));
vi.mock("@/modules/leads/components/leads/LeadChecklistSection", () => ({ LeadChecklistSection: () => null }));
vi.mock("@/modules/leads/components/lead/tabs/LeadTabPipe", () => ({ LeadTabPipe: () => null }));
vi.mock("@/modules/leads/components/lead/tabs/LeadTabCampanhas", () => ({ LeadTabCampanhas: () => null }));
vi.mock("@/modules/leads/components/lead/tabs/LeadTabHistory", () => ({ LeadTabHistory: () => null }));
vi.mock("@/modules/leads/components/lead/create/LeadCreateForm", () => ({ LeadCreateForm: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  state.lead = { id: "lead-1", name: "ELIEZER 7937 SEXTA", company: "", email: "", notes: "", phone: "5515996310303", segment: "", interest: "" };
  state.update.mockImplementation(async (patch) => { state.lead = { ...state.lead, ...patch }; return state.lead; });
});

describe("nome no painel Info da conversa", () => {
  it.each(["confirmar", "direto", "Enter"])("persiste edições repetidas pelo Salvar principal (%s)", async (mode) => {
    const user = userEvent.setup();
    render(<LeadDetailContent phoneNumber="5515996310303" showHeader />);
    for (const name of ["ELIEZER 7937 TERÇA", "ELIEZER 7937 QUARTA", "ELIEZER 7937 SEXTA"]) {
      await user.click(screen.getByLabelText("Nome"));
      const input = screen.getByRole("textbox", { name: "Nome" });
      await user.clear(input);
      await user.paste(name);
      if (mode === "confirmar") await user.click(screen.getAllByRole("button", { name: "Salvar" })[0]);
      if (mode === "Enter") await user.keyboard("{Enter}");
      await user.click(screen.getByText("Salvar", { selector: "button" }));
      await waitFor(() => expect(state.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: "lead-1", name })));
      await waitFor(() => expect(state.refetch).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByText(name, { selector: "span" })).toBeInTheDocument());
      expect(state.lead.name).toBe(name);
    }
    expect(state.update).toHaveBeenCalledTimes(3);
  });

  it.each(["botão", "Escape"])("cancelar com %s não confirma o rascunho ao perder foco", async (mode) => {
    const user = userEvent.setup();
    render(<LeadDetailContent phoneNumber="5515996310303" />);
    await user.click(screen.getByLabelText("Nome"));
    await user.clear(screen.getByRole("textbox", { name: "Nome" }));
    await user.paste("Não salvar");
    if (mode === "botão") await user.click(screen.getByRole("button", { name: "Cancelar" }));
    else await user.keyboard("{Escape}");
    await user.click(screen.getByText("Salvar", { selector: "button" }));
    await waitFor(() => expect(state.update).toHaveBeenCalledWith(expect.objectContaining({ name: "ELIEZER 7937 SEXTA" })));
    expect(state.update).toHaveBeenCalledTimes(1);
  });

  it("preserva a alteração para tentar novamente quando a gravação falha", async () => {
    const user = userEvent.setup();
    state.update.mockRejectedValueOnce(new Error("network"));
    render(<LeadDetailContent phoneNumber="5515996310303" showHeader />);
    await user.click(screen.getByLabelText("Nome"));
    await user.clear(screen.getByRole("textbox", { name: "Nome" }));
    await user.paste("ELIEZER CORRIGIDO");
    await user.click(screen.getByText("Salvar", { selector: "button" }));
    expect(state.error).toHaveBeenCalled();
    expect(state.refetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome")).toHaveTextContent("ELIEZER CORRIGIDO");
    await user.click(screen.getByText("Salvar", { selector: "button" }));
    await waitFor(() => expect(state.lead.name).toBe("ELIEZER CORRIGIDO"));
    expect(state.update).toHaveBeenCalledTimes(2);
  });

  it("não aceita nome vazio", async () => {
    const user = userEvent.setup();
    render(<LeadDetailContent phoneNumber="5515996310303" />);
    await user.click(screen.getByLabelText("Nome"));
    await user.clear(screen.getByRole("textbox", { name: "Nome" }));
    await user.click(screen.getByText("Salvar", { selector: "button" }));
    expect(state.update).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith("Nome é obrigatório");
  });

  it("carrega e persiste os outros campos nativos do mesmo formulário", async () => {
    const user = userEvent.setup();
    render(<LeadDetailContent phoneNumber="5515996310303" />);
    expect(screen.getByLabelText("Telefone")).toHaveTextContent("5515996310303");
    for (const [label, value] of [["Empresa", "Empresa B"], ["Email", "novo@example.com"], ["Telefone", "5515999999999"], ["Segmento", "Distribuidora"], ["Interesse", "Produtos"]]) {
      await user.click(screen.getByLabelText(label));
      await user.clear(screen.getByRole("textbox", { name: label }));
      await user.paste(value);
      await user.keyboard("{Enter}");
    }
    await user.click(screen.getByText("Salvar", { selector: "button" }));
    await waitFor(() => expect(state.update).toHaveBeenCalledWith(expect.objectContaining({
      name: "ELIEZER 7937 SEXTA", company: "Empresa B", email: "novo@example.com",
      phone: "5515999999999", segment: "Distribuidora", interest: "Produtos",
    })));
  });
});
