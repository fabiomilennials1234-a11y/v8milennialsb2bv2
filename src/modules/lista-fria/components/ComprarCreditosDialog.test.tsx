import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PACOTES } from "../lib/pacotes";
import { crc16, payloadPix, type RecebedorPix } from "../lib/pix";
import { ComprarCreditosDialog } from "./ComprarCreditosDialog";

const RECEBEDOR: RecebedorPix = { chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Torque Tecnologia Ltda", cidade: "Florianopolis" };

function montar(props: Partial<React.ComponentProps<typeof ComprarCreditosDialog>> = {}) {
  const onAbrirChamado = vi.fn();
  const onFechar = vi.fn();
  render(
    <ComprarCreditosDialog
      aberto
      onFechar={onFechar}
      recebedor={RECEBEDOR}
      onAbrirChamado={onAbrirChamado}
      gerarReferencia={() => "LFTESTE1"}
      {...props}
    />,
  );
  return { onAbrirChamado, onFechar };
}

const botaoDoPacote = (nome: string) => screen.getByRole("button", { name: new RegExp(`^${nome.replace("+", "\\+")}:`) });

describe("ComprarCreditosDialog", () => {
  it("oferece os seis pacotes e o Outro, cada pacote com seus créditos e preço", () => {
    montar();
    expect(botaoDoPacote("Google")).toHaveAccessibleName(/100 créditos por R\$\s15,00/);
    expect(botaoDoPacote("Google +")).toHaveAccessibleName(/500 créditos por R\$\s71,25/);
    expect(botaoDoPacote("Google Max")).toHaveAccessibleName(/1\.000 créditos por R\$\s135,00/);
    expect(botaoDoPacote("Meta")).toHaveAccessibleName(/100 créditos por R\$\s100,00/);
    expect(botaoDoPacote("Meta +")).toHaveAccessibleName(/500 créditos por R\$\s475,00/);
    expect(botaoDoPacote("Meta Max")).toHaveAccessibleName(/1\.000 créditos por R\$\s900,00/);
    expect(screen.getByRole("button", { name: /Outro/ })).toBeEnabled();
  });

  it('marca o "+" como o mais comprado, um por família, e mostra os descontos', () => {
    montar();
    expect(screen.getAllByText("Mais comprado")).toHaveLength(2);
    expect(within(botaoDoPacote("Google +")).getByText("Mais comprado")).toBeInTheDocument();
    expect(within(botaoDoPacote("Meta +")).getByText("Mais comprado")).toBeInTheDocument();
    expect(within(botaoDoPacote("Google +")).getByText("5% off")).toBeInTheDocument();
    expect(within(botaoDoPacote("Google Max")).getByText("10% off")).toBeInTheDocument();
    expect(within(botaoDoPacote("Meta")).queryByText(/off/)).toBeNull();
  });

  it("ao escolher o pacote, mostra o QR Code e o PIX copia e cola com o valor certo", async () => {
    const user = userEvent.setup();
    montar();
    await user.click(botaoDoPacote("Google +"));

    const esperado = payloadPix({ recebedor: RECEBEDOR, valorCentavos: 7125, referencia: "LFTESTE1" });
    const copia = screen.getByLabelText("Pix copia e cola") as HTMLTextAreaElement;
    expect(copia.value).toBe(esperado);
    expect(copia.value.slice(-4)).toBe(crc16(copia.value.slice(0, -4)));
    expect(copia.value).toContain("5405" + "71.25");
    expect(document.querySelector('svg[aria-label="QR Code do PIX"]')).not.toBeNull();
    expect(screen.getByText("123e4567-e12b-12d1-a456-426655440000")).toBeInTheDocument();
    expect(screen.getByText("Torque Tecnologia Ltda")).toBeInTheDocument();
    expect(screen.getByText("LFTESTE1")).toBeInTheDocument();
  });

  it('"Já paguei" abre o chamado com pacote, valor e referência, e fecha a tela', async () => {
    const user = userEvent.setup();
    const { onAbrirChamado, onFechar } = montar();
    await user.click(botaoDoPacote("Meta +"));
    await user.click(screen.getByRole("button", { name: "Já paguei" }));

    expect(onAbrirChamado).toHaveBeenCalledTimes(1);
    const prefill = onAbrirChamado.mock.calls[0][0];
    expect(prefill.title).toBe("Paguei o pacote Meta + (500 créditos)");
    expect(prefill.tipo).toBe("solicitacao");
    expect(prefill.description).toContain("Referência do PIX: LFTESTE1");
    expect(prefill.description.replace(/\u00a0/g, " ")).toContain("Valor pago: R$ 475,00");
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it('"Outro" abre o chamado com "Quero adquirir créditos" já escrito', async () => {
    const user = userEvent.setup();
    const { onAbrirChamado, onFechar } = montar();
    await user.click(screen.getByRole("button", { name: /Outro/ }));

    expect(onAbrirChamado).toHaveBeenCalledWith({
      title: "Quero adquirir créditos",
      description: "Quero adquirir créditos.",
      tipo: "solicitacao",
      impacto: "incomodo",
    });
    expect(onFechar).toHaveBeenCalledTimes(1);
  });

  it("o botão Pacotes volta para a escolha, e cada escolha ganha uma referência nova", async () => {
    const user = userEvent.setup();
    const refs = ["REF1", "REF2"];
    montar({ gerarReferencia: () => refs.shift() ?? "FIM" });
    await user.click(botaoDoPacote("Google"));
    expect(screen.getByText("REF1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Pacotes/ }));
    expect(screen.getByRole("button", { name: /Outro/ })).toBeInTheDocument();
    await user.click(botaoDoPacote("Google Max"));
    expect(screen.getByText("REF2")).toBeInTheDocument();
  });

  it("sem PIX configurado, não mostra QR nenhum e leva ao time, sem dizer que houve pagamento", async () => {
    const user = userEvent.setup();
    const { onAbrirChamado } = montar({ recebedor: null });
    await user.click(botaoDoPacote("Meta Max"));

    expect(document.querySelector('svg[aria-label="QR Code do PIX"]')).toBeNull();
    expect(screen.queryByLabelText("Pix copia e cola")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/ainda não está configurado/);
    await user.click(screen.getByRole("button", { name: "Falar com o time" }));
    const prefill = onAbrirChamado.mock.calls[0][0];
    expect(prefill.title).toContain("Quero adquirir o pacote Meta Max");
    expect(prefill.description).not.toMatch(/paguei|pagamento/i);
  });

  it("sem suporte para o perfil, o Outro e o Já paguei ficam desligados, mas o PIX continua à mostra", async () => {
    const user = userEvent.setup();
    montar({ onAbrirChamado: null });
    expect(screen.getByRole("button", { name: /Outro/ })).toBeDisabled();
    await user.click(botaoDoPacote("Google"));
    expect(screen.getByLabelText("Pix copia e cola")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Já paguei" })).toBeDisabled();
  });

  it("todos os seis pacotes geram um PIX com o próprio valor", async () => {
    const user = userEvent.setup();
    for (const p of PACOTES) {
      const { unmount } = render(
        <ComprarCreditosDialog aberto onFechar={() => {}} recebedor={RECEBEDOR} onAbrirChamado={() => {}} gerarReferencia={() => "R1"} />,
      );
      await user.click(botaoDoPacote(p.nome));
      const copia = screen.getByLabelText("Pix copia e cola") as HTMLTextAreaElement;
      const centavos = Math.round((p.creditos * (p.tipo === "meta" ? 100 : 15) * (100 - p.descontoPct)) / 100);
      expect(copia.value).toContain(`54${String(String(Math.floor(centavos / 100)).length + 3).padStart(2, "0")}${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`);
      unmount();
    }
  });
});
