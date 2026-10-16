import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureSuggestionDialog } from "@/modules/platform/components/feedback/FeatureSuggestionDialog";

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<FeatureSuggestionDialog onSubmit={onSubmit} onClose={onClose} />);
  const textarea = screen.getByLabelText("Sua ideia");
  const send = () => screen.getByRole("button", { name: /Enviar sugestão|Tentar de novo|Enviando/ });
  return { onSubmit, onClose, user, textarea, send };
}

describe("FeatureSuggestionDialog", () => {
  it("abre com a copy do mockup, título e descrição acessíveis", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Estamos aqui para ouvir e ajudar vocês.");
    expect(dialog).toHaveAccessibleDescription("Qual funcionalidade você gostaria que fosse adicionada ao Torque?");
    expect(screen.getByText("Torque ouve você")).toBeInTheDocument();
    expect(screen.getByText(/O time de produto lê cada sugestão/)).toBeInTheDocument();
    expect(screen.getByText("0 / 1000")).toBeInTheDocument();
  });

  it("contador não é região viva; anúncio só perto do limite", () => {
    const { textarea } = setup();
    expect(screen.getByText("0 / 1000")).not.toHaveAttribute("aria-live");
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).toHaveTextContent("");
    fireEvent.change(textarea, { target: { value: "x".repeat(950) } });
    expect(live).toHaveTextContent("Restam 50 caracteres ou menos.");
  });

  it("chips são radiogroup: um marcado, setas trocam a seleção", async () => {
    const { user } = setup();
    const group = screen.getByRole("radiogroup", { name: "Sobre o quê?" });
    expect(group).toBeInTheDocument();
    const feature = screen.getByRole("radio", { name: "Nova funcionalidade" });
    expect(feature).toHaveAttribute("aria-checked", "true");
    feature.focus();
    await user.keyboard("{ArrowRight}");
    const improvement = screen.getByRole("radio", { name: "Melhoria" });
    expect(improvement).toHaveAttribute("aria-checked", "true");
    expect(improvement).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Outro" })).toHaveAttribute("aria-checked", "true");
  });

  it("enviar fica desabilitado até 3 caracteres úteis; contador acompanha", async () => {
    const { user, textarea, send } = setup();
    expect(send()).toBeDisabled();
    await user.type(textarea, "  ab ");
    expect(send()).toBeDisabled();
    await user.type(textarea, "c");
    expect(send()).toBeEnabled();
    expect(screen.getByText("6 / 1000")).toBeInTheDocument();
    expect(textarea).toHaveAttribute("maxLength", "1000");
  });

  it("envio: manda tipo + texto aparado, sucesso cita a ideia e o tipo", async () => {
    const { user, textarea, send, onSubmit, onClose } = setup();
    await user.click(screen.getByRole("radio", { name: "Integração" }));
    await user.type(textarea, "  Integração com Omie  ");
    await user.click(send());
    expect(onSubmit).toHaveBeenCalledWith({ kind: "integration", body: "Integração com Omie" });
    expect(await screen.findByText("Recebido. Obrigado!")).toBeInTheDocument();
    expect(screen.getByText("Integração com Omie")).toBeInTheDocument();
    expect(screen.getByText("Integração", { selector: ".fsp-tag" })).toBeInTheDocument();
    expect(screen.getByTestId("torque-dial")).toHaveAttribute("data-done", "true");
    const back = screen.getByRole("button", { name: "Voltar ao Torque" });
    await waitFor(() => expect(back).toHaveFocus());
    await user.click(back);
    expect(onClose).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Cmd/Ctrl+Enter envia", async () => {
    const { user, textarea, onSubmit } = setup();
    await user.type(textarea, "Atalho de teclado");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledWith({ kind: "feature", body: "Atalho de teclado" });
    await screen.findByText("Recebido. Obrigado!");
  });

  it("erro no envio preserva o texto, mostra erro inline e permite tentar de novo", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(undefined);
    const { user, textarea, send, onClose } = setup(onSubmit);
    await user.type(textarea, "Minha ideia");
    await user.click(send());
    expect(await screen.findByRole("alert")).toHaveTextContent("Não deu para enviar agora");
    expect(textarea).toHaveValue("Minha ideia");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Tentar de novo/ }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    await screen.findByText("Recebido. Obrigado!");
  });

  it.each([
    ["X", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Fechar" }))],
    ["Agora não", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Agora não" }))],
    ["Esc", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  ])("%s fecha como dismissed", async (_label, act) => {
    const { user, onClose } = setup();
    await act(user);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("dismissed");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Esc fecha mesmo com texto digitado", async () => {
    const { user, textarea, onClose } = setup();
    await user.type(textarea, "Rascunho");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledWith("dismissed");
  });

  it("clique no fundo: fecha vazio; com texto, NÃO fecha", async () => {
    const first = setup();
    const scrim = () => screen.getByTestId("feature-suggestion-overlay");
    await first.user.type(first.textarea, "Não perca isto");
    fireEvent.pointerDown(scrim());
    expect(first.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await first.user.clear(first.textarea);
    fireEvent.pointerDown(scrim());
    expect(first.onClose).toHaveBeenCalledWith("dismissed");
  });

  it("durante o envio nada fecha", async () => {
    let finish: () => void = () => undefined;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user, textarea, send, onClose } = setup(onSubmit);
    await user.type(textarea, "Enviando agora");
    await user.click(send());
    expect(screen.getByRole("button", { name: /Enviando/ })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Agora não" })).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await screen.findByText("Recebido. Obrigado!");
  });

  it("título palavra por palavra sem vão: espaço só ENTRE palavras, nada antes do ponto", () => {
    setup();
    const title = screen.getByRole("dialog").querySelector(".fsp-headline")!;
    const visual = title.querySelector('[aria-hidden="true"]')!;
    expect(visual.textContent).toBe("Estamos aqui para ouvir e ajudar vocês.");
    expect(visual.textContent).not.toMatch(/\s\./);
    expect(visual.textContent).not.toMatch(/\s$/);
    expect(title.querySelector(".fsp-hl")).toHaveTextContent("ouvir");
  });

  it("medidor segue a digitação: leitura, barra, marcas e rótulo de torque máximo", () => {
    const { textarea } = setup();
    expect(screen.getByText("Quanto mais detalhe, mais torque")).toBeInTheDocument();
    fireEvent.change(textarea, { target: { value: "x".repeat(120) } });
    expect(screen.getByTestId("torque-dial-read")).toHaveTextContent("50");
    expect(screen.getByTestId("torque-meter")).toHaveStyle({ width: "50%" });
    expect(screen.getByTestId("torque-dial-needle").style.transform).toBe("rotate(0deg)");
    expect(document.querySelectorAll('.fsp-g-tick[data-on="true"]')).toHaveLength(6);
    fireEvent.change(textarea, { target: { value: "x".repeat(300) } });
    expect(screen.getByTestId("torque-dial-read")).toHaveTextContent("100");
    expect(screen.getByTestId("torque-meter")).toHaveStyle({ width: "100%" });
    expect(screen.getByText("Torque máximo. Pode mandar.")).toBeInTheDocument();
    expect(document.querySelectorAll('.fsp-g-tick[data-on="true"]')).toHaveLength(11);
  });

  it("visual: tinta + ouro sólido, sem tom pastel, sem degradê dourado, sem JetBrains", () => {
    setup();
    const html = screen.getByTestId("feature-suggestion-overlay").outerHTML;
    expect(html).toContain("bg-tinta");
    expect(html).not.toMatch(/primary-soft|gold-soft|gradient-gold|JetBrains|bg-card/);
  });

  it("erro de envio devolve o foco ao campo depois de reabilitá-lo", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("x"));
    const { user, textarea, send } = setup(onSubmit);
    await user.type(textarea, "Minha ideia");
    await user.click(send());
    await screen.findByRole("alert");
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(textarea).toBeEnabled();
  });

  it("nenhum <style> dentro do Portal (travava o Presence ao fechar)", () => {
    setup();
    expect(screen.getByTestId("feature-suggestion-overlay").querySelector("style")).toBeNull();
    expect(document.body.querySelectorAll("style")).toHaveLength(0);
  });

  it("nenhum componente do feedback renderiza <style> (o CSS vive em feature-suggestion.css)", () => {
    const dir = join(__dirname, "../../src/modules/platform/components/feedback");
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => /<style[\s>]/.test(readFileSync(join(dir, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("fechar chama onExited quando a saída termina (sem animação no jsdom)", async () => {
    const onExited = vi.fn();
    const user = userEvent.setup();
    render(<FeatureSuggestionDialog onSubmit={vi.fn()} onClose={vi.fn()} onExited={onExited} />);
    await user.click(screen.getByRole("button", { name: "Agora não" }));
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("feature-suggestion-overlay")).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).toBe("");
  });
});
