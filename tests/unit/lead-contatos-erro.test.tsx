import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { erroDeTelefone } from "@/modules/leads/lib/lead-phones";

/**
 * "Não foi possível salvar os telefones" chegou da Pesco sem pista nenhuma: a
 * mutation embrulhava todo erro num `Error` genérico. Agora erro inesperado
 * mostra o código copiável (ADR-0038); recusa conhecida mostra só a frase.
 */

const mutateAsync = vi.fn();

vi.mock("@/modules/leads/hooks/useLeadPhones", () => ({
  useLeadPhones: () => ({
    data: [
      {
        id: "p1",
        phone: "21979287",
        normalizedPhone: "21979287",
        label: null,
        labelLocked: false,
        isPrimary: true,
        isWhatsApp: null,
        source: "crm",
      },
    ],
    isLoading: false,
  }),
  useSalvarTelefonesDoLead: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/shared/errors", async (original) => ({
  ...(await original<typeof import("@/shared/errors")>()),
  reportError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { LeadContatos } = await import("@/modules/leads/components/lead-card/LeadContatos");

async function salvarComErro(erro: unknown) {
  mutateAsync.mockRejectedValueOnce(erro);
  render(<LeadContatos leadId="lead-1" />);
  fireEvent.click(screen.getByTestId("lead-contatos-editar"));
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  return screen.findByRole("alert");
}

describe("LeadContatos — erro ao salvar", () => {
  beforeEach(() => mutateAsync.mockReset());

  it("erro inesperado do banco mostra o texto genérico E o código copiável", async () => {
    const alerta = await salvarComErro({
      code: "PGRST202",
      message: "Could not find the function public.salvar_telefones_do_lead(p_lead_id, p_phones)",
    });
    expect(alerta.textContent).toContain("Não foi possível salvar os telefones.");
    expect(alerta.textContent).not.toContain("Could not find");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Copiar código do erro/ })).toBeTruthy(),
    );
  });

  it("recusa conhecida mostra a frase e nenhum código", async () => {
    const alerta = await salvarComErro(erroDeTelefone({ message: "label_required" }));
    expect(alerta.textContent).toContain("Dê um nome ao contato do telefone novo");
    expect(screen.queryByRole("button", { name: /Copiar código do erro/ })).toBeNull();
  });
});

describe("erroDeTelefone", () => {
  it("recusa conhecida vira Error com a frase da tela", () => {
    const e = erroDeTelefone({ message: "phone_invalid" });
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe("Telefone inválido — use DDD e número");
  });

  it("erro desconhecido sobe ORIGINAL, para toAppError classificar", () => {
    const original = { code: "42501", message: "new row violates row-level security policy" };
    expect(erroDeTelefone(original)).toBe(original);
  });
});
