import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { PerdaResolvida } from "@/contracts/pipe/perda";
import { MockPipeOpsProvider } from "../pipe-ops/testing";
import { LossReasonGateProvider } from "./LossReasonGate";
import { useLossReasonGate, type UseLossReasonGateResult } from "./useLossReasonGate";

/**
 * A porta do motivo de verdade: diálogo Radix real, regra real
 * (`resolverMotivoDaPerda`). Só o catálogo e a escrita são dublês.
 */

const h = vi.hoisted(() => ({ patch: vi.fn(), toastError: vi.fn() }));
vi.mock("@/integrations/supabase/entry-metadata", () => ({ patchEntryMetadata: h.patch }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: "org-1" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: h.toastError, success: vi.fn() }) }));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => false });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  Reflect.deleteProperty(HTMLElement.prototype, "hasPointerCapture");
});

const CATALOGO = [
  { id: "lr-1", name: "Preço", organization_id: "org-1" },
  { id: "lr-2", name: "Outro", organization_id: "org-1" },
  // Master enxerga o catálogo de todas as orgs — este NÃO pode aparecer.
  { id: "lr-x", name: "Motivo de outra org", organization_id: "org-2" },
];

let porta: UseLossReasonGateResult;
function Captura() {
  porta = useLossReasonGate();
  return null;
}

function montar(
  catalogo: unknown = CATALOGO,
  { comProvider = true, consulta }: { comProvider?: boolean; consulta?: Record<string, unknown> } = {},
) {
  const qc = new QueryClient();
  const arvore: ReactNode = comProvider ? (
    <LossReasonGateProvider>
      <Captura />
    </LossReasonGateProvider>
  ) : (
    <Captura />
  );
  render(
    <QueryClientProvider client={qc}>
      <MockPipeOpsProvider port={{ useLossReasons: (() => consulta ?? { data: catalogo, isLoading: false, isError: false }) as never }}>
        {arvore}
      </MockPipeOpsProvider>
    </QueryClientProvider>,
  );
}

function pedir(stageName = "Perdido/Desqualificado") {
  let resultado!: Promise<PerdaResolvida | null>;
  act(() => {
    resultado = porta.requestLossReason({ stageName });
  });
  return resultado;
}

async function escolher(motivo: string) {
  const dialogo = await screen.findByRole("alertdialog");
  fireEvent.keyDown(within(dialogo).getByRole("combobox", { name: "Motivo da perda" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: motivo }));
  return dialogo;
}

beforeEach(() => {
  h.patch.mockReset().mockResolvedValue(undefined);
  h.toastError.mockReset();
});

describe("LossReasonGate — diálogo real", () => {
  it("motivo do catálogo resolve id + rótulo snapshotado; o diálogo fecha", async () => {
    montar();
    const resultado = pedir();
    const dialogo = await escolher("Preço");
    expect(within(dialogo).getByText("Perdido/Desqualificado")).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar perda" }));
    await expect(resultado).resolves.toEqual({ id: "lr-1", texto: "Preço" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("sem escolha, confirmar fica travado", async () => {
    montar();
    void pedir();
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByRole("button", { name: "Confirmar perda" })).toBeDisabled();
  });

  it("\"Outro\" exige texto (≥ 3) e resolve com o texto livre, sem id", async () => {
    montar();
    const resultado = pedir();
    const dialogo = await escolher("Outro");
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar perda" });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByRole("textbox", { name: "Descreva o motivo" }), { target: { value: "ok" } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByRole("textbox", { name: "Descreva o motivo" }), {
      target: { value: "Cliente fechou com o primo" },
    });
    fireEvent.click(confirmar);
    await expect(resultado).resolves.toEqual({ id: "lr-2", texto: "Cliente fechou com o primo" });
  });

  it("cancelar resolve null", async () => {
    montar();
    const resultado = pedir();
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await expect(resultado).resolves.toBeNull();
  });

  it("catálogo de outra org não aparece (master enxerga todas)", async () => {
    montar();
    void pedir();
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.keyDown(within(dialogo).getByRole("combobox", { name: "Motivo da perda" }), { key: "ArrowDown" });
    await screen.findByRole("option", { name: "Preço" });
    expect(screen.queryByRole("option", { name: "Motivo de outra org" })).not.toBeInTheDocument();
  });

  it("org sem catálogo cai no fallback — texto sem id (nunca FK para slug)", async () => {
    montar([]);
    const resultado = pedir();
    const dialogo = await escolher("Sem budget");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar perda" }));
    await expect(resultado).resolves.toEqual({ id: null, texto: "Sem budget" });
  });

  it("falha na consulta do catálogo NÃO cai no fallback: erro + confirmar travado", async () => {
    const refetch = vi.fn();
    montar(undefined, { consulta: { data: undefined, isLoading: false, isError: true, refetch } });
    void pedir();
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("Não foi possível carregar os motivos");
    expect(within(dialogo).getByRole("combobox", { name: "Motivo da perda" })).toBeDisabled();
    expect(within(dialogo).getByRole("button", { name: "Confirmar perda" })).toBeDisabled();
    expect(screen.queryByRole("option", { name: "Sem budget" })).not.toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Tentar de novo" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("um pedido novo cancela o anterior", async () => {
    montar();
    const primeiro = pedir("A");
    void pedir("B");
    await expect(primeiro).resolves.toBeNull();
  });

  it("capturarMotivoDaPerda grava em cada entrada e devolve a perda", async () => {
    montar();
    let resultado!: Promise<PerdaResolvida | null>;
    act(() => {
      resultado = porta.capturarMotivoDaPerda({ entryIds: ["e-1", "e-2"], stageName: "Perda" });
    });
    const dialogo = await escolher("Preço");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar perda" }));
    await expect(resultado).resolves.toEqual({ id: "lr-1", texto: "Preço" });
    expect(h.patch).toHaveBeenCalledWith("e-1", { loss_reason_id: "lr-1", loss_reason: "Preço" });
    expect(h.patch).toHaveBeenCalledWith("e-2", { loss_reason_id: "lr-1", loss_reason: "Preço" });
  });

  it("sem provider a porta FECHA: null + aviso, nada gravado", async () => {
    montar(CATALOGO, { comProvider: false });
    await expect(porta.capturarMotivoDaPerda({ entryIds: ["e-1"] })).resolves.toBeNull();
    expect(h.toastError).toHaveBeenCalled();
    expect(h.patch).not.toHaveBeenCalled();
  });
});
