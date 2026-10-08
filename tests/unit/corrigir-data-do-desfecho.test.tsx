import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { rpc, success } = vi.hoisted(() => ({ rpc: vi.fn(), success: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("sonner", () => ({ toast: { success } }));

import {
  correcaoDataError,
  useCorrigirDataDoDesfecho,
} from "@/modules/leads/components/deal-card/useCorrigirDataDoDesfecho";
import { DataDoDesfecho } from "@/modules/leads/components/deal-card/DataDoDesfecho";

beforeEach(() => {
  rpc.mockReset();
  success.mockReset();
});

function setup(versao: string | null = "2026-10-05T18:30:00Z") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidar = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useCorrigirDataDoDesfecho("deal-1", "org-1", versao), { wrapper }), invalidar };
}

describe("useCorrigirDataDoDesfecho", () => {
  it("manda só data, motivo e versão — o valor é do banco", async () => {
    rpc.mockResolvedValue({ data: { changed: true, metric_event_corrected: true }, error: null });
    const { result, invalidar } = setup();
    await result.current.mutateAsync({ data: "2026-09-20", motivo: "Registrada atrasada" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("corrigir_data_do_desfecho", {
      p_deal_id: "deal-1",
      p_expected_updated_at: "2026-10-05T18:30:00Z",
      p_date: "2026-09-20",
      p_reason: "Registrada atrasada",
    });
    const keys = invalidar.mock.calls.map(([p]) => p?.queryKey?.[0]);
    expect(keys).toEqual(expect.arrayContaining(["deal-card-extras", "pipeline-page", "metric-measure", "sales-metrics"]));
    expect(success).toHaveBeenCalledWith(expect.stringContaining("Relatórios"));
  });

  it("avisa quando a perda não tinha evento de métrica", async () => {
    rpc.mockResolvedValue({ data: { changed: true, metric_event_corrected: false }, error: null });
    const { result } = setup();
    await result.current.mutateAsync({ data: "2026-09-20", motivo: "x" });
    expect(success).toHaveBeenCalledWith(expect.stringContaining("não aparece nos relatórios"));
  });

  it("sem versão não chama a RPC; recusa não invalida nada", async () => {
    const semVersao = setup(null);
    await expect(semVersao.result.current.mutateAsync({ data: "2026-09-20", motivo: "x" })).rejects.toThrow("outra pessoa");
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: null, error: { code: "PT409", message: "deal_state_changed" } });
    const { result, invalidar } = setup();
    await expect(result.current.mutateAsync({ data: "2026-09-20", motivo: "x" })).rejects.toThrow("outra pessoa");
    expect(invalidar).not.toHaveBeenCalled();
  });

  it("traduz os códigos próprios e os herdados da correção de venda", () => {
    expect(correcaoDataError({ message: "invalid_outcome_date" })).toContain("não seja futura");
    expect(correcaoDataError({ message: "order_erp_linked" })).toContain("ERP");
    expect(correcaoDataError({ message: "invalid_sale_value" })).toContain("Corrigir data e valor da venda");
    expect(correcaoDataError({ code: "PGRST202" })).toContain("ainda não está disponível");
  });
});

describe("DataDoDesfecho", () => {
  it("sem onSalvar é só leitura", () => {
    render(
      <DataDoDesfecho estado="perdido" quando="2026-10-05T18:30:00Z">
        05/10/2026
      </DataDoDesfecho>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Perdido em")).toBeTruthy();
  });

  it("abre no clique, exige data diferente e motivo, e salva", async () => {
    const onSalvar = vi.fn().mockResolvedValue(undefined);
    render(
      <DataDoDesfecho estado="perdido" quando="2026-10-05T18:30:00Z" versao="v1" onSalvar={onSalvar}>
        05/10/2026
      </DataDoDesfecho>,
    );
    fireEvent.click(screen.getByTestId("desfecho-data"));
    const salvar = await screen.findByRole("button", { name: "Salvar data" });
    const data = screen.getByLabelText("Data da perda") as HTMLInputElement;
    expect(data.value).toBe("2026-10-05");
    expect((salvar as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(data, { target: { value: "2026-09-20" } });
    expect((salvar as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "  Registrada atrasada " } });
    expect((salvar as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(salvar);
    await waitFor(() =>
      expect(onSalvar).toHaveBeenCalledWith({ data: "2026-09-20", motivo: "Registrada atrasada", versao: "v1" }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar data" })).toBeNull());
  });

  it("mostra o erro do banco e mantém o formulário aberto", async () => {
    const onSalvar = vi.fn().mockRejectedValue(new Error("Esta venda tem vínculo com ERP."));
    render(
      <DataDoDesfecho estado="ganho" quando="2026-08-01T15:00:00Z" onSalvar={onSalvar}>
        01/08/2026
      </DataDoDesfecho>,
    );
    fireEvent.click(screen.getByTestId("desfecho-data"));
    fireEvent.change(await screen.findByLabelText("Data da venda"), { target: { value: "2026-08-15" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Fechou dia 15" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar data" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ERP");
    expect(screen.getByRole("button", { name: "Salvar data" })).toBeTruthy();
  });
});
