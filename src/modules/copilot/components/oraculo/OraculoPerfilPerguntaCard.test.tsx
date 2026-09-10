import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { OraculoPerfilPerguntaCard } from "./OraculoPerfilPerguntaCard";

const question = {
  id: "40000000-0000-4000-8000-000000000001",
  question_key: "sales_outside_crm" as const,
  prompt: "Medi 12 vendas no CRM e ticket médio de R$ 3.400. Existe venda fora?",
  measured_context: { source: "metricas", vendas: 12 },
  status: "pending" as const,
};

it("pergunta continua opcional e só envia resposta após ação humana", async () => {
  const answer = vi.fn();
  const skip = vi.fn();
  const user = userEvent.setup();
  render(<OraculoPerfilPerguntaCard question={question} onAnswer={answer} onSkip={skip} busy={false} />);

  expect(screen.getByText(/Medi 12 vendas/)).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: /sua resposta/i }), "Há duas vendas fora.");
  await user.click(screen.getByRole("button", { name: /responder/i }));
  expect(answer).toHaveBeenCalledWith(question.id, "Há duas vendas fora.");
  expect(skip).not.toHaveBeenCalled();
});

it("agora não ignora sem exigir resposta", async () => {
  const skip = vi.fn();
  const user = userEvent.setup();
  render(<OraculoPerfilPerguntaCard question={question} onAnswer={vi.fn()} onSkip={skip} busy={false} />);
  await user.click(screen.getByRole("button", { name: /agora não/i }));
  expect(skip).toHaveBeenCalledWith(question.id);
});

it("resposta concluída vira confirmação compacta", () => {
  render(<OraculoPerfilPerguntaCard question={{ ...question, status: "answered" }} onAnswer={vi.fn()} onSkip={vi.fn()} busy={false} />);
  expect(screen.getByText(/perfil atualizado/i)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
