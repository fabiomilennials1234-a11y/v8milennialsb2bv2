/**
 * InstanceOwnerModal — testes do mutation set_instance_owner.
 *
 * Cobre os 3 caminhos de erro que o RPC pode propagar
 * (FORBIDDEN, INVALID_OWNER, default), o caminho de sucesso, o estado
 * de "substituir owner existente" (confirmação inline destructive)
 * e o warn de instância inativa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockRpc = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

let mockInstances: Array<{
  id: string;
  instance_name: string;
  phone_number: string | null;
  status: string;
  owner_team_member_id?: string | null;
}> = [];

vi.mock("@/modules/communication/hooks/useWhatsAppInstances", () => ({
  useWhatsAppInstances: () => ({ data: mockInstances, isLoading: false }),
}));

import { InstanceOwnerModal } from "@/modules/communication/components/chat/admin/InstanceOwnerModal";

// ─── Helpers ───────────────────────────────────────────────────────────────

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

function renderModal(props?: Partial<Parameters<typeof InstanceOwnerModal>[0]>) {
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <InstanceOwnerModal
        open
        onOpenChange={() => {}}
        targetTeamMemberId="tm-target"
        targetTeamMemberName="João"
        {...props}
      />
    </Wrapper>,
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("InstanceOwnerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstances = [
      {
        id: "inst-available",
        instance_name: "Vendas SP",
        phone_number: "5511999990001",
        status: "connected",
        owner_team_member_id: null,
      },
      {
        id: "inst-in-use",
        instance_name: "Vendas RJ",
        phone_number: "5521999990002",
        status: "connected",
        owner_team_member_id: "tm-other",
      },
      {
        id: "inst-disconnected",
        instance_name: "Vendas BH",
        phone_number: "5531999990003",
        status: "disconnected",
        owner_team_member_id: null,
      },
    ];
    mockRpc.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("vincula instância disponível com sucesso e dispara toast.success", async () => {
    mockRpc.mockResolvedValueOnce({ data: "audit-id-1", error: null });
    const onLinked = vi.fn();
    const onOpenChange = vi.fn();
    renderModal({ onLinked, onOpenChange });

    fireEvent.click(screen.getByText("Vendas SP"));
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("set_instance_owner", {
        p_instance_id: "inst-available",
        p_new_owner_team_member_id: "tm-target",
        p_reason: "admin_assign_owner",
      });
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalled();
      expect(onLinked).toHaveBeenCalledWith("inst-available");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("erro FORBIDDEN dispara toast 'Sem permissão'", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "FORBIDDEN: only admin/master can change instance owner" },
    });
    renderModal();

    fireEvent.click(screen.getByText("Vendas SP"));
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Sem permissão",
        expect.objectContaining({
          description: "Apenas administradores podem vincular números.",
        }),
      );
    });
  });

  it("erro INVALID_OWNER dispara toast 'vendedor não está ativo'", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "INVALID_OWNER: team_member not in org or inactive" },
    });
    renderModal();

    fireEvent.click(screen.getByText("Vendas SP"));
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Não foi possível vincular",
        expect.objectContaining({
          description: "Este vendedor não está ativo nesta organização.",
        }),
      );
    });
  });

  it("erro genérico dispara toast 'Falha ao vincular número'", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "INSTANCE_NOT_FOUND" },
    });
    renderModal();

    fireEvent.click(screen.getByText("Vendas SP"));
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Falha ao vincular número",
        expect.objectContaining({
          description: expect.stringContaining("Verifique a conexão"),
        }),
      );
    });
  });

  it("substituir owner existente exige confirmação inline (destructive)", async () => {
    const user = userEvent.setup();
    renderModal();

    fireEvent.click(screen.getByText("Vendas RJ"));
    // Primeiro clique: entra em modo confirming, NÃO chama RPC.
    await user.click(screen.getByRole("button", { name: "Vincular" }));

    expect(mockRpc).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Substituir vínculo deste número/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/vendedor anterior perderá acesso/i),
    ).toBeInTheDocument();

    // Segundo clique no botão destructive: dispara RPC com reason de replace.
    mockRpc.mockResolvedValueOnce({ data: "audit-id-2", error: null });
    await user.click(
      screen.getByRole("button", { name: "Confirmar e vincular" }),
    );
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith("set_instance_owner", {
        p_instance_id: "inst-in-use",
        p_new_owner_team_member_id: "tm-target",
        p_reason: "admin_replace_owner",
      });
    });
  });

  it("warn de instância inativa aparece quando selected.status != connected", () => {
    renderModal();

    fireEvent.click(screen.getByText("Vendas BH"));

    expect(
      screen.getByText(/Este número está/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/composer bloqueado até reconectar/i),
    ).toBeInTheDocument();
  });

  it("estado vazio mostra CTA quando org não tem instâncias", () => {
    mockInstances = [];
    renderModal();
    expect(screen.getByText("Nenhum número conectado")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Ir para WhatsApp/i }),
    ).toBeInTheDocument();
  });
});
