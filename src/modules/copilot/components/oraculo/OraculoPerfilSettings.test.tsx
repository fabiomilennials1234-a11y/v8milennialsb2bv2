import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { OraculoPerfilSettings } from "./OraculoPerfilSettings";

const saveOwn = vi.fn();
const adjust = vi.fn();
const state = {
  rows: [{
    team_member_id: "tm-1",
    team_member_name: "Ana",
    question_key: "sales_outside_crm" as const,
    member_answer: "Fechamos três vendas fora.",
    admin_answer: "Foi uma venda fora.",
    effective_answer: "Foi uma venda fora.",
    divergent: true,
  }],
  isLoading: false,
};

vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ teamMemberId: "tm-admin", isAdmin: true }),
  useOrganization: () => ({ organizationId: "org-1" }),
}));
vi.mock("../../hooks/useOraculoPerfil", () => ({
  useOraculoPerfil: () => ({
    data: state.rows,
    isLoading: state.isLoading,
    saveOwn,
    adjust,
    isSaving: false,
  }),
}));

it("admin vê fala original, ajuste e divergência sem sobrescrita silenciosa", () => {
  render(<OraculoPerfilSettings />);
  expect(screen.getByText("Fechamos três vendas fora.")).toBeInTheDocument();
  expect(screen.getByText("Foi uma venda fora.")).toBeInTheDocument();
  expect(screen.getByText(/divergência registrada/i)).toBeInTheDocument();
});

it("admin ajusta pela configuração mantendo a chave e a pessoa", async () => {
  const user = userEvent.setup();
  render(<OraculoPerfilSettings />);
  await user.click(screen.getByRole("button", { name: /ajustar leitura/i }));
  const editor = screen.getByRole("textbox", { name: /ajuste para vendas fora do crm/i });
  await user.clear(editor);
  await user.type(editor, "Foram duas vendas fora.");
  await user.click(screen.getByRole("button", { name: /^salvar$/i }));
  expect(adjust).toHaveBeenCalledWith("tm-1", "sales_outside_crm", "Foram duas vendas fora.");
});
