import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { OraculoFeedbackControl } from "./OraculoFeedbackControl";

it("envia avaliação positiva com um clique", async () => {
  const submit = vi.fn();
  render(<OraculoFeedbackControl label="esta resposta" onSubmit={submit} busy={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Resposta útil" }));
  expect(submit).toHaveBeenCalledWith({ rating: "positive" });
});

it("negativo exige motivo curto e aceita detalhe opcional", async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  render(<OraculoFeedbackControl label="esta resposta" onSubmit={submit} busy={false} />);

  await user.click(screen.getByRole("button", { name: "Resposta não ajudou" }));
  expect(screen.getByText("O que falhou nesta resposta?")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enviar avaliação" })).toBeDisabled();

  await user.click(screen.getByRole("radio", { name: "Inventou algo" }));
  await user.type(screen.getByLabelText("Detalhe opcional"), "O valor não aparece no CRM.");
  await user.click(screen.getByRole("button", { name: "Enviar avaliação" }));

  expect(submit).toHaveBeenCalledWith({
    rating: "negative",
    reason: "invented",
    comment: "O valor não aparece no CRM.",
  });
});

it("avaliação salva substitui controles por confirmação", () => {
  render(<OraculoFeedbackControl label="esta resposta" onSubmit={vi.fn()} busy={false} value={{
    rating: "negative",
    reason: "wrong_number",
  }} />);
  expect(screen.getByText("Feedback enviado")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Resposta útil" })).not.toBeInTheDocument();
});

it("cada resposta mantém seu próprio grupo de motivos", async () => {
  const user = userEvent.setup();
  render(
    <>
      <OraculoFeedbackControl label="esta resposta" onSubmit={vi.fn()} busy={false} />
      <OraculoFeedbackControl label="esta resposta" onSubmit={vi.fn()} busy={false} />
    </>,
  );

  const negativeButtons = screen.getAllByRole("button", { name: "Resposta não ajudou" });
  await user.click(negativeButtons[0]);
  await user.click(negativeButtons[1]);

  const invented = screen.getAllByRole("radio", { name: "Inventou algo" });
  expect(invented[0]).not.toHaveAttribute("name", invented[1].getAttribute("name"));
});
