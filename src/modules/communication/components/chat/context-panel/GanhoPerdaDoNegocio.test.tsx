import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fechar = vi.fn();
const registrarDesfecho = vi.fn();
const toastError = vi.fn();
let desfecho: { data?: string; isPending: boolean; isError: boolean } = { data: "open", isPending: false, isError: false };

vi.mock("@/modules/communication/hooks/chat/useFecharNegocioNoChat", () => ({
  useFecharNegocioNoChat: () => ({ fechar, registrarDesfecho }),
}));
vi.mock("@/modules/communication/hooks/chat/useDesfechoDaEntrada", () => ({
  useDesfechoDaEntrada: () => desfecho,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/shared/errors", () => ({ notifyError: vi.fn() }));
vi.mock("@/shared/components/SaleValueRequiredModal", () => ({
  SaleValueRequiredModal: ({ onConfirm }: { onConfirm: (v: number) => void }) => (
    <button type="button" onClick={() => onConfirm(1500)}>
      confirmar-valor
    </button>
  ),
}));

import { GanhoPerdaDoNegocio } from "./GanhoPerdaDoNegocio";

const etapas = [
  { key: "novo", stageId: "s1", label: "Novo" },
  { key: "neg", stageId: "s2", label: "Em negociação" },
  { key: "vendido", stageId: "s3", label: "Vendido" },
  { key: "perdido", stageId: "s4", label: "❌ Perdido" },
];

function renderar(props: Partial<React.ComponentProps<typeof GanhoPerdaDoNegocio>> = {}) {
  return render(
    <GanhoPerdaDoNegocio
      entryId="e1"
      funil="ENVASE"
      etapas={etapas}
      etapaAtualKey="neg"
      podeMover
      moverEtapa={vi.fn()}
      capturarMotivoDaPerda={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  fechar.mockReset().mockResolvedValue({ status: "ok" });
  registrarDesfecho.mockReset().mockResolvedValue(undefined);
  toastError.mockClear();
  desfecho = { data: "open", isPending: false, isError: false };
});

describe("GanhoPerdaDoNegocio", () => {
  it("negócio aberto: mostra Ganho e Perda", () => {
    renderar();
    expect(screen.getByRole("button", { name: "Ganho" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Perda" })).toBeEnabled();
  });

  it("Ganho abre o modal já com Vendido marcado; confirmar move para Vendido e dá o ganho", async () => {
    const user = userEvent.setup();
    renderar();
    await user.click(screen.getByRole("button", { name: "Ganho" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByRole("radio", { name: "Vendido" })).toBeChecked();
    await user.click(within(modal).getByRole("button", { name: "Confirmar ganho" }));
    await waitFor(() => expect(fechar).toHaveBeenCalledTimes(1));
    expect(fechar).toHaveBeenCalledWith({
      entryId: "e1",
      desfecho: "won",
      etapaAtualKey: "neg",
      destino: { key: "vendido", stageId: "s3", label: "Vendido" },
    });
  });

  it("Perda sugere Perdido; escolher Manter na etapa atual manda destino nulo", async () => {
    const user = userEvent.setup();
    renderar();
    await user.click(screen.getByRole("button", { name: "Perda" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByRole("radio", { name: "❌ Perdido" })).toBeChecked();
    await user.click(within(modal).getByRole("radio", { name: /Manter na etapa atual \(Em negociação\)/ }));
    await user.click(within(modal).getByRole("button", { name: "Confirmar perda" }));
    await waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(fechar.mock.calls[0][0]).toMatchObject({ desfecho: "lost", destino: null });
  });

  it("a etapa atual não aparece como destino (só como Manter)", async () => {
    const user = userEvent.setup();
    renderar();
    await user.click(screen.getByRole("button", { name: "Ganho" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).queryByRole("radio", { name: "Em negociação" })).toBeNull();
  });

  it("funil sem etapa Vendido/Perdido: abre em Manter, sem chutar destino", async () => {
    const user = userEvent.setup();
    renderar({ etapas: etapas.slice(0, 2) });
    await user.click(screen.getByRole("button", { name: "Ganho" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByRole("radio", { name: /Manter na etapa atual/ })).toBeChecked();
  });

  it("cancelado (tarefa ou motivo da perda) mantém o modal aberto", async () => {
    fechar.mockResolvedValue({ status: "cancelado" });
    const user = userEvent.setup();
    renderar();
    await user.click(screen.getByRole("button", { name: "Perda" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmar perda" }));
    await waitFor(() => expect(fechar).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("sucesso fecha o modal", async () => {
    const user = userEvent.setup();
    renderar();
    await user.click(screen.getByRole("button", { name: "Ganho" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmar ganho" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("banco exige valor: abre o pedido de valor e registra o desfecho com ele, sem mover de novo", async () => {
    fechar.mockResolvedValue({ status: "pede-valor", perda: null, moveu: true });
    const user = userEvent.setup();
    renderar();
    await user.click(screen.getByRole("button", { name: "Ganho" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmar ganho" }));
    await user.click(await screen.findByRole("button", { name: "confirmar-valor" }));
    await waitFor(() => expect(registrarDesfecho).toHaveBeenCalledTimes(1));
    expect(registrarDesfecho).toHaveBeenCalledWith({ entryId: "e1", desfecho: "won", perda: null, valor: 1500 });
    expect(fechar).toHaveBeenCalledTimes(1);
  });

  it("moveu mas o desfecho falhou: avisa com o nome da etapa", async () => {
    fechar.mockResolvedValue({ status: "falhou-depois-de-mover", destino: "Vendido", erro: new Error("x") });
    const user = userEvent.setup();
    renderar();
    await user.click(screen.getByRole("button", { name: "Ganho" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmar ganho" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toMatch(/movido para Vendido.*ganho não foi registrado/);
  });

  it("negócio já ganho ou perdido: mostra o estado e some com os botões", () => {
    desfecho = { data: "won", isPending: false, isError: false };
    const { unmount } = renderar();
    expect(screen.getByTestId("desfecho-do-negocio")).toHaveTextContent("Negócio ganho");
    expect(screen.queryByRole("button", { name: "Ganho" })).toBeNull();
    unmount();
    desfecho = { data: "lost", isPending: false, isError: false };
    renderar();
    expect(screen.getByTestId("desfecho-do-negocio")).toHaveTextContent("Negócio perdido");
  });

  it("sem permissão de mover: botões desabilitados", () => {
    renderar({ podeMover: false });
    expect(screen.getByRole("button", { name: "Ganho" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Perda" })).toBeDisabled();
  });

  it("carregando ou erro ao ler o desfecho: não oferece nada (não arrisca fechar duas vezes)", () => {
    desfecho = { data: undefined, isPending: true, isError: false };
    const { unmount } = renderar();
    expect(screen.queryByTestId("ganho-perda-do-negocio")).toBeNull();
    unmount();
    desfecho = { data: undefined, isPending: false, isError: true };
    renderar();
    expect(screen.queryByTestId("ganho-perda-do-negocio")).toBeNull();
  });
});
