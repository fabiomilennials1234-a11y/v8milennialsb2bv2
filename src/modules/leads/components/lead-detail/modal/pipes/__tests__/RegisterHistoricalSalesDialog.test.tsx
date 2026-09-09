import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterHistoricalSalesDialog } from "../RegisterHistoricalSalesDialog";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/modules/identity", () => ({
  useOrganization: () => ({ timezone: "America/Sao_Paulo", organizationId: "org-1" }),
  useIdentity: () => ({ userId: "user-1" }),
}));
vi.mock("@/modules/leads/hooks/useRegisterHistoricalSales", () => ({
  useRegisterHistoricalSales: () => ({ mutateAsync: save, isPending: false }),
}));
beforeEach(() => { sessionStorage.clear(); save.mockReset().mockResolvedValue(["deal-1"]); });
afterEach(cleanup);

async function open() {
  const user = userEvent.setup();
  render(<RegisterHistoricalSalesDialog leadId="lead-1" />);
  await user.click(screen.getByRole("button", { name: "Registrar Venda" }));
  return user;
}
function fill(index: number, value: string, date: string) {
  fireEvent.change(screen.getAllByLabelText("Valor (R$)")[index], { target: { value } });
  fireEvent.change(screen.getAllByLabelText("Data da venda")[index], { target: { value: date } });
}

describe("Registrar Venda", () => {
  it("builds a list without writing until Save, then closes only after success", async () => {
    const user = await open();
    fill(0, "125.50", "2025-01-10");
    await user.click(screen.getByRole("button", { name: "Próxima venda" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getAllByLabelText("Valor (R$)")).toHaveLength(2);
    fill(1, "200", "2025-02-10");
    await user.click(screen.getByRole("button", { name: "Salvar vendas" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0].sales).toEqual([
      { value: 125.5, date: "2025-01-10" }, { value: 200, date: "2025-02-10" },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("requires value and date before adding the next sale", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Próxima venda" }));
    expect(await screen.findByText("Informe o valor")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Valor (R$)")).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });
  it("closing an unsaved list does not register sales", async () => {
    const user = await open();
    fill(0, "100", "2025-01-10");
    await user.click(screen.getByRole("button", { name: "Fechar" }));
    expect(save).not.toHaveBeenCalled();
  });
  it("retries an uncertain response with exactly the same idempotency key and sales", async () => {
    save.mockRejectedValueOnce(new Error("Failed to fetch"));
    const user = await open();
    fill(0, "100", "2025-01-10");
    await user.click(screen.getByRole("button", { name: "Salvar vendas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("não serão duplicadas");
    expect(screen.getByLabelText("Valor (R$)")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual(save.mock.calls[0][0]);
  });
  it("recovers the same submission after the lead modal is unmounted", async () => {
    save.mockRejectedValueOnce(new Error("Network error"));
    const user = await open();
    fill(0, "100", "2025-01-10");
    await user.click(screen.getByRole("button", { name: "Salvar vendas" }));
    await screen.findByRole("alert");
    const original = save.mock.calls[0][0];
    cleanup();
    const reopened = await open();
    expect(screen.getByLabelText("Valor (R$)")).toHaveValue(100);
    await reopened.click(screen.getByRole("button", { name: "Tentar salvar novamente" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual(original);
    expect(sessionStorage.length).toBe(0);
  });
});
