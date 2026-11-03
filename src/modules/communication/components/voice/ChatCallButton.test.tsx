import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallableVoiceNumber } from "../../hooks/useVoipSession";
import { ChatCallButton } from "./ChatCallButton";

const state = vi.hoisted(() => ({
  startCall: vi.fn(), selected: null as CallableVoiceNumber | null,
  call: true, manage: false, hasVoice: true, busy: false,
}));
vi.mock("./VoiceCallProvider", () => ({
  useVoiceCallContext: () => ({
    ...state, numbersLoading: false, numbers: state.selected ? [state.selected] : [],
  }),
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
  useCanDo: (key: string) => ({ allowed: key === "voip.call.start" ? state.call : state.manage }),
}));
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({ isReady: true, isLoading: false, hasFeature: () => state.hasVoice }),
}));

const line = { tcSessionId: "session", instanceId: "instance", instanceName: "Comercial" };
const phone = () => screen.getByRole("button", { name: "Ligar" });
function mount(leadId: string | null = "lead-1", onOpenLead?: () => void) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><ChatCallButton leadName="Cliente" leadId={leadId} onOpenLead={onOpenLead} /></MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  Object.assign(state, { selected: null, call: true, manage: false, hasVoice: true, busy: false });
  state.startCall.mockClear();
});

describe("telefone da conversa", () => {
  it("liga em um clique para o lead da conversa aberta", async () => {
    state.selected = line;
    mount();
    await userEvent.click(phone());
    expect(state.startCall).toHaveBeenCalledExactlyOnceWith({ id: "lead-1", name: "Cliente" });
  });

  it("oferece ao administrador a configuração da linha e não inicia ligação", async () => {
    state.manage = true;
    mount();
    await userEvent.click(phone());
    expect(screen.getByRole("link", { name: "Configurar TorqueCalls" }))
      .toHaveAttribute("href", "/configuracoes/integracoes?integracao=torquecalls");
    expect(state.startCall).not.toHaveBeenCalled();
  });

  it("explica a falta de acesso à linha para o vendedor", async () => {
    mount();
    await userEvent.click(phone());
    expect(screen.getByText(/peça a um administrador/i)).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("mostra o telefone mesmo sem o recurso, sem abrir uma configuração bloqueada", async () => {
    state.hasVoice = false;
    state.manage = true;
    state.selected = line;
    mount();
    await userEvent.click(phone());
    expect(screen.getByText(/não está habilitado para esta organização/i)).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(state.startCall).not.toHaveBeenCalled();
  });

  it("sem permissão para ligar, não disca mesmo com uma linha no contexto", async () => {
    state.selected = line;
    state.call = false;
    mount();
    await userEvent.click(phone());
    expect(screen.getByText(/não tem permissão/i)).toBeVisible();
    expect(state.startCall).not.toHaveBeenCalled();
  });

  it("sem lead, oferece a ficha do contato em vez de discar um número arbitrário", async () => {
    state.selected = line;
    const openLead = vi.fn();
    mount(null, openLead);
    await userEvent.click(phone());
    await userEvent.click(screen.getByRole("button", { name: "Vincular lead" }));
    expect(openLead).toHaveBeenCalledOnce();
    expect(state.startCall).not.toHaveBeenCalled();
  });
});
