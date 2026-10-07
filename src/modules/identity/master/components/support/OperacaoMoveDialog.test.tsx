import { fireEvent, render, screen } from "@testing-library/react";
import { canMove, type OperacaoColumn, type OperacaoTicketFacts } from "../../lib/operacao-kanban";
import { OperacaoMoveDialog, type PendingMove } from "./OperacaoMoveDialog";

const t = (status: OperacaoTicketFacts["status"]): OperacaoTicketFacts => ({
  status,
  reopen_count: 0,
  assigned_master_user_id: null,
});

function pendingFor(
  status: OperacaoTicketFacts["status"],
  to: OperacaoColumn,
  reply: string | null = "Corrigimos o envio das mensagens.",
): PendingMove {
  const v = canMove(t(status), { customer_reply: reply }, to, true);
  if (!v.ok) throw new Error(v.reason);
  return { ticketId: "t1", ticketTitle: "Mensagens não saem", move: v.move, reply };
}

function renderDialog(pending: PendingMove | null) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<OperacaoMoveDialog pending={pending} busy={false} onCancel={onCancel} onConfirm={onConfirm} />);
  return { onConfirm, onCancel };
}

describe("OperacaoMoveDialog", () => {
  it("Concluído: avisa que o cliente não é avisado e confirma sem enviar", () => {
    const { onConfirm } = renderDialog(pendingFor("em_andamento", "concluido"));
    expect(
      screen.getByText("O cliente não será avisado. O chamado fecha e só o master consegue reabrir."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledWith({ sendReply: false });
  });

  it("Concluído: Cancelar não grava", () => {
    const { onConfirm, onCancel } = renderDialog(pendingFor("em_andamento", "concluido"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("Aguardando: mostra o texto que será enviado e oferece as duas escolhas", () => {
    const { onConfirm } = renderDialog(pendingFor("em_andamento", "aguardando"));
    expect(screen.getByLabelText("Resposta que será enviada ao cliente")).toHaveTextContent(
      "Corrigimos o envio das mensagens.",
    );
    fireEvent.click(screen.getByRole("button", { name: /Enviar resposta ao cliente e marcar resolvido/ }));
    expect(onConfirm).toHaveBeenLastCalledWith({ sendReply: true });
    fireEvent.click(screen.getByRole("button", { name: "Só mudar o estado, sem enviar" }));
    expect(onConfirm).toHaveBeenLastCalledWith({ sendReply: false });
  });

  it("Aguardando sem resposta pronta: só dá para mudar o estado", () => {
    renderDialog(pendingFor("em_andamento", "aguardando", null));
    expect(screen.getByRole("button", { name: /Enviar resposta ao cliente e marcar resolvido/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Só mudar o estado, sem enviar" })).toBeEnabled();
  });

  it("saindo de Concluído: confirma a reabertura", () => {
    const { onConfirm } = renderDialog(pendingFor("fechado", "andamento"));
    expect(screen.getByText("Reabrir chamado fechado?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reabrir chamado" }));
    expect(onConfirm).toHaveBeenCalledWith({ sendReply: false });
  });

  it("movimento sem confirmação não abre diálogo", () => {
    renderDialog(pendingFor("resolvido", "andamento"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
