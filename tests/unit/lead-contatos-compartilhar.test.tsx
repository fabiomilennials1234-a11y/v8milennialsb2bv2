/**
 * Chamado 99067f13, PR4 — o número que já é o principal de OUTRO lead não é mais
 * um beco sem saída: a tela pergunta "Compartilhar o número entre os dois leads?"
 * e só grava com `permitirCompartilhado` depois do "Compartilhar".
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PrincipalOcupadoError } from "@/modules/leads/lib/lead-phones";

const salvarMutateAsync = vi.fn();
const descompartilharMutateAsync = vi.fn();
let compartilhado = false;

vi.mock("@/modules/leads/hooks/useLeadPhones", () => ({
  useLeadPhones: () => ({
    data: [
      {
        id: "p1",
        phone: "(51) 98203-0889",
        normalizedPhone: "51982030889",
        label: "LISI",
        labelLocked: false,
        isPrimary: true,
        isWhatsApp: null,
        source: "crm",
      },
    ],
    isLoading: false,
  }),
  useSalvarTelefonesDoLead: () => ({ mutateAsync: salvarMutateAsync, isPending: false }),
}));

vi.mock("@/modules/leads/hooks/useLeadPhoneCompartilhado", () => ({
  useLeadPhoneCompartilhado: () => ({ data: compartilhado }),
  useDescompartilharNumero: () => ({ mutateAsync: descompartilharMutateAsync, isPending: false }),
}));

vi.mock("@/shared/errors", async (original) => ({
  ...(await original<typeof import("@/shared/errors")>()),
  reportError: vi.fn(),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { LeadContatos } = await import("@/modules/leads/components/lead-card/LeadContatos");

const FRASE_COM_NOME =
  "Este número já é o principal do lead 4545 - TRENTIN LTDA. Compartilhar o número entre os dois leads?";
const FRASE_GENERICA =
  "Este número já é o principal de outro lead da organização. Compartilhar o número entre os dois leads?";

async function salvarEAbrirDialogo(dono: { name: string | null; erp_code: string | null } | null) {
  salvarMutateAsync.mockRejectedValueOnce(new PrincipalOcupadoError(dono));
  render(<LeadContatos leadId="lead-3759" />);
  fireEvent.click(screen.getByTestId("lead-contatos-editar"));
  fireEvent.click(screen.getByTestId("lead-contatos-salvar"));
  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  salvarMutateAsync.mockReset();
  descompartilharMutateAsync.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  compartilhado = false;
});

describe("LeadContatos — diálogo de compartilhar número", () => {
  it("principal ocupado abre o diálogo com o lead que segura o número e NÃO grava ainda", async () => {
    const dialogo = await salvarEAbrirDialogo({ name: "TRENTIN LTDA", erp_code: "4545" });
    expect(dialogo.textContent).toContain(FRASE_COM_NOME);
    expect(screen.getByRole("button", { name: "Cancelar", hidden: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Compartilhar" })).toBeTruthy();
    // Uma única chamada (a tentativa sem confirmação) e nenhuma com `true`.
    expect(salvarMutateAsync).toHaveBeenCalledTimes(1);
    expect(salvarMutateAsync.mock.calls[0][0]).toBeInstanceOf(Array);
  });

  it("Cancelar fecha o diálogo e nunca chama com permitirCompartilhado", async () => {
    await salvarEAbrirDialogo({ name: "TRENTIN LTDA", erp_code: "4545" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(salvarMutateAsync).toHaveBeenCalledTimes(1);
    expect(salvarMutateAsync.mock.calls.some(([a]) => (a as { permitirCompartilhado?: boolean })?.permitirCompartilhado)).toBe(false);
    // continua editando, sem mensagem de erro
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("lead-contatos-editor")).toBeTruthy();
  });

  it("Compartilhar chama de novo com permitirCompartilhado: true e a MESMA lista", async () => {
    await salvarEAbrirDialogo({ name: "TRENTIN LTDA", erp_code: "4545" });
    const primeira = salvarMutateAsync.mock.calls[0][0];
    salvarMutateAsync.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(salvarMutateAsync).toHaveBeenCalledTimes(2));
    expect(salvarMutateAsync.mock.calls[1][0]).toEqual({ telefones: primeira, permitirCompartilhado: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("lead-contatos-editor")).toBeNull());
  });

  it("dono invisível (RLS): a frase é genérica e não cita nome nenhum", async () => {
    const dialogo = await salvarEAbrirDialogo(null);
    expect(dialogo.textContent).toContain(FRASE_GENERICA);
    expect(dialogo.textContent).not.toMatch(/TRENTIN|4545/);
  });

  it("recusa depois de confirmar (ex.: sem permissão) aparece como erro na tela", async () => {
    await salvarEAbrirDialogo({ name: "TRENTIN LTDA", erp_code: "4545" });
    salvarMutateAsync.mockRejectedValueOnce(new Error("Você não pode editar este lead."));
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("Você não pode editar este lead.");
  });

  it("erro que não é principal ocupado NÃO abre o diálogo", async () => {
    salvarMutateAsync.mockRejectedValueOnce(new Error("Telefone inválido — use DDD e número"));
    render(<LeadContatos leadId="lead-3759" />);
    fireEvent.click(screen.getByTestId("lead-contatos-editar"));
    fireEvent.click(screen.getByTestId("lead-contatos-salvar"));
    expect((await screen.findByRole("alert")).textContent).toContain("Telefone inválido");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("LeadContatos — marca de número compartilhado", () => {
  it("sem a marca, nada aparece", () => {
    render(<LeadContatos leadId="lead-3759" />);
    expect(screen.queryByTestId("lead-contatos-compartilhado")).toBeNull();
  });

  it("com a marca, mostra 'Número compartilhado' e 'Deixar de compartilhar'", () => {
    compartilhado = true;
    render(<LeadContatos leadId="lead-3759" />);
    expect(screen.getByTestId("lead-contatos-compartilhado").textContent).toContain("Número compartilhado");
    expect(screen.getByRole("button", { name: "Deixar de compartilhar" })).toBeTruthy();
  });

  it("'Deixar de compartilhar' chama o desfazer com o principal do lead", async () => {
    compartilhado = true;
    descompartilharMutateAsync.mockResolvedValueOnce(undefined);
    render(<LeadContatos leadId="lead-3759" />);
    fireEvent.click(screen.getByRole("button", { name: "Deixar de compartilhar" }));
    await waitFor(() =>
      expect(descompartilharMutateAsync).toHaveBeenCalledWith({ telefonePrincipal: "(51) 98203-0889" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("desfazer recusado mostra a frase do banco, sem travar a tela", async () => {
    compartilhado = true;
    descompartilharMutateAsync.mockRejectedValueOnce(
      new Error("Não dá para deixar de compartilhar: o lead 4545 - TRENTIN LTDA já é o principal deste número."),
    );
    render(<LeadContatos leadId="lead-3759" />);
    fireEvent.click(screen.getByRole("button", { name: "Deixar de compartilhar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).toContain("Não dá para deixar de compartilhar");
  });

  it("sem permissão de editar (podeEditar=false) mostra a marca mas não a ação", () => {
    compartilhado = true;
    render(<LeadContatos leadId="lead-3759" podeEditar={false} />);
    expect(screen.getByTestId("lead-contatos-compartilhado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Deixar de compartilhar" })).toBeNull();
  });
});
