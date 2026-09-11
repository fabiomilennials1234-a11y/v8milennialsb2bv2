/** Exercita o menu real do card, simulando apenas leitura e gravação no banco. */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Só o que precisa de banco/identidade é trocado ──────────────────────────
vi.mock("@/modules/leads/components/leads/card/LeadCardQualificationPopover", () => ({
  LeadCardQualificationPopover: () => null,
}));
vi.mock("@/modules/communication/components/chat/ScheduleMessageModal", () => ({
  ScheduleMessageModal: () => null,
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaButton", () => ({
  AbrirConversaButton: () => null,
}));
vi.mock("@/modules/communication/components/chat/AbrirConversaMenuItem", () => ({
  AbrirConversaMenuItem: () => null,
}));
vi.mock("@/modules/leads/components/leads/AddToFunilDialog", () => ({
  AddToFunilMenuItem: () => null,
  AddToFunilDialog: () => null,
}));


const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), read: vi.fn(), eq: vi.fn(), outcome: "open", fail: false,
}));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ organizationId: "org-1", isReady: true }),
}));
vi.mock("@/modules/engagement", () => ({ CreateMeetingDialog: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => {
      const query = { eq: mocks.eq, single: () => ({ returns: mocks.read }) };
      mocks.eq.mockReturnValue(query);
      return query;
    } }),
    rpc: mocks.rpc,
  },
}));

import { beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { LeadCard } from "@/modules/leads/components/leads/LeadCard";

beforeEach(() => {
  mocks.outcome = "open";
  mocks.fail = false;
  mocks.rpc.mockReset().mockImplementation(async (_name, args) => {
    if (mocks.fail) return { error: { message: "Falha ao salvar" } };
    mocks.outcome = args.p_outcome;
    return { error: null };
  });
  mocks.read.mockReset().mockImplementation(async () => ({
    data: { deal: { outcome: mocks.outcome } }, error: null,
  }));
});

function montar() {
  const onClick = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidar = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <LeadCard variant="custom" density="compact" onClick={onClick}
        lead={{ id: "entry-1", leadId: "lead-1", pipelineId: "pipe-1", name: "Dora" }} />
    </QueryClientProvider>,
  );
  return { onClick, invalidar };
}

function abrirMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Opções de Dora" }),
    { button: 0, ctrlKey: false, pointerType: "mouse" });
}

async function clicar(texto: string) {
  const item = await screen.findByRole("menuitem", { name: texto });
  await waitFor(() => expect(item).not.toHaveAttribute("data-disabled"));
  fireEvent.click(item);
}

describe("Menu + do negócio — perdido reversível", () => {
  it("marca perdido e o próximo clique reabre a mesma entrada", async () => {
    const { onClick, invalidar } = montar();
    expect(mocks.read).not.toHaveBeenCalled();
    abrirMenu();
    await clicar("Marcar como perdido");
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "definir_desfecho_da_entrada", { p_entry_id: "entry-1", p_outcome: "lost" },
    ));
    await screen.findByRole("menuitem", { name: "Remover de perdido" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    abrirMenu();
    await clicar("Remover de perdido");
    await waitFor(() => expect(mocks.rpc).toHaveBeenLastCalledWith(
      "definir_desfecho_da_entrada", { p_entry_id: "entry-1", p_outcome: "open" },
    ));
    await screen.findByRole("menuitem", { name: "Marcar como perdido" });
    expect(onClick).not.toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(mocks.eq).toHaveBeenCalledWith("id", "entry-1");
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["leads-deals"] });
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ["funil-desfecho-counts"] });
  });

  it("reabre um negócio que já chegou perdido", async () => {
    mocks.outcome = "lost";
    montar();
    abrirMenu();
    await clicar("Remover de perdido");
    await waitFor(() => expect(mocks.outcome).toBe("open"));
  });

  it("mantém perdido se o salvamento falhar", async () => {
    mocks.outcome = "lost";
    mocks.fail = true;
    montar();
    abrirMenu();
    await clicar("Remover de perdido");
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(mocks.outcome).toBe("lost");
    expect(screen.getByRole("menuitem", { name: "Remover de perdido" })).toBeInTheDocument();
  });

  it("bloqueia cliques repetidos enquanto salva", async () => {
    let concluir!: (value: { error: null }) => void;
    mocks.rpc.mockImplementation(() => new Promise((resolve) => { concluir = resolve; }));
    montar();
    abrirMenu();
    await clicar("Marcar como perdido");
    const item = screen.getByRole("menuitem", { name: "Marcar como perdido" });
    fireEvent.click(item);
    fireEvent.click(item);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    expect(item).toHaveAttribute("data-disabled");
    concluir({ error: null });
    await screen.findByRole("menuitem", { name: "Remover de perdido" });
  });

  it("permite tentar a leitura novamente sem gravar um estado presumido", async () => {
    mocks.read.mockResolvedValue({ data: null, error: { message: "Sem conexão" } });
    montar();
    abrirMenu();
    const retry = await screen.findByRole("menuitem", { name: "Tentar carregar desfecho novamente" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue({ data: { deal: { outcome: "lost" } }, error: null });
    fireEvent.click(retry);
    await screen.findByRole("menuitem", { name: "Remover de perdido" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
