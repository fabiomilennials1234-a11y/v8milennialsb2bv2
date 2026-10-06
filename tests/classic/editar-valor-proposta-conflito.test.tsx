// Runs against classic/src through vitest.classic.config.ts.
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEditarValorProposta } from "@/modules/leads/components/deal-card/useItensDoNegocio";
import { DealCardMoney } from "@/modules/leads/components/deal-card/DealCardMoney";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@/shared/errors", async importOriginal => ({ ...await importOriginal<typeof import("@/shared/errors")>(), notifyError: mocks.notify }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([{ code: "PT409", invalidates: true }, { code: "42501", invalidates: false }])("$code só recarrega a ficha se houve conflito", async ({ code, invalidates }) => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const key = ["deal-card-extras", "entry", "pipeline", "proposta"];
  client.setQueryData(key, { version: "v1" });
  mocks.rpc.mockResolvedValue({ error: { code, message: "test error", details: null, hint: null } });
  const { result } = renderHook(() => useEditarValorProposta("entry"), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await act(async () => { await expect(result.current.mutateAsync({ valor: 150, expectedUpdatedAt: "v1" })).rejects.toMatchObject({ code }); });
  expect(client.getQueryState(key)?.isInvalidated).toBe(invalidates);
  expect(mocks.notify).toHaveBeenCalled();
  client.clear();
});

it("bloqueia a versão rejeitada se a recarga falhar e só libera após receber outra versão", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const carregar = vi.fn<() => Promise<{ version: string; value: number }>>()
    .mockRejectedValueOnce(new Error("Falha na recarga automática"))
    .mockRejectedValueOnce(new Error("Falha na recarga manual"))
    .mockResolvedValueOnce({ version: "v1", value: 100 })
    .mockResolvedValue({ version: "v2", value: 200 });
  mocks.rpc.mockReset()
    .mockResolvedValueOnce({ error: { code: "PT409", message: "stale", details: null, hint: null } })
    .mockResolvedValue({ error: null });
  function Ficha() {
    const { data } = useQuery({
      queryKey: ["deal-card-extras", "entry", "pipeline", "proposta"],
      queryFn: carregar,
      initialData: { version: "v1", value: 100 },
      staleTime: Infinity,
    });
    const editar = useEditarValorProposta("entry");
    return <DealCardMoney itens={[]} valorDoNegocio={data.value} versaoDoNegocio={data.version}
      onEditarValor={(valor, expectedUpdatedAt) => editar.mutateAsync({ valor, expectedUpdatedAt })}
      onRecarregarValor={editar.recarregarValor} />;
  }
  render(<QueryClientProvider client={client}><Ficha /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Editar valor" }));
  fireEvent.change(screen.getByLabelText("Valor da proposta"), { target: { value: "15000" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar valor" }));
  await waitFor(() => expect(screen.queryByLabelText("Valor da proposta")).toBeNull());
  expect(carregar).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Editar valor" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Editar valor" }));
  expect(screen.queryByRole("button", { name: "Salvar valor" })).toBeNull();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Atualizar valor" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível atualizar o valor"));
  expect(screen.getByRole("button", { name: "Editar valor" })).toBeDisabled();

  // Até uma leitura bem-sucedida com a mesma versão deve manter o bloqueio.
  fireEvent.click(screen.getByRole("button", { name: "Atualizar valor" }));
  await waitFor(() => expect(carregar).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.getByRole("button", { name: "Atualizar valor" })).not.toBeDisabled());
  expect(screen.getByRole("button", { name: "Editar valor" })).toBeDisabled();
  expect(mocks.rpc).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Atualizar valor" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Editar valor" })).not.toBeDisabled());
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Editar valor" }));
  fireEvent.change(screen.getByLabelText("Valor da proposta"), { target: { value: "25000" } });
  fireEvent.click(screen.getByRole("button", { name: "Salvar valor" }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenNthCalledWith(2, "editar_valor_proposta", {
    p_entry_id: "entry", p_value: 250, p_expected_updated_at: "v2",
  }));
  client.clear();
});
