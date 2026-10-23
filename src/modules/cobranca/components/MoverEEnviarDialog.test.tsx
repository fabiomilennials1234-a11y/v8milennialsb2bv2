/**
 * "Mover e enviar": a tela mostra a mensagem que o SERVIDOR montaria (texto da
 * coluna + variáveis do caso) e só deixa enviar quando nada impede. O que
 * impede vira frase, e "Só mover" segue disponível.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviaDoEnvio } from "../lib/regua";
import type { Etapa, InadimplenteResumo } from "../lib/tipos";
import { MoverEEnviarDialog } from "./MoverEEnviarDialog";

let previa: { data?: PreviaDoEnvio; isLoading: boolean; isError: boolean };

vi.mock("../hooks/useRegua", () => ({
  usePreviaDoEnvio: () => previa,
}));

const caso = { casoId: "c1", nome: "Ana Souza", saldoAberto: 250.5 } as InadimplenteResumo;
const destino: Etapa = {
  id: "e7",
  nome: "7 dias de atraso",
  posicao: 4,
  papel: "aberta",
  cor: "#818cf8",
  pausaRegua: false,
  entradaDias: 7,
  mensagem: "Olá, {primeiro_nome}. O valor de {valor} segue em aberto.",
  automacaoAtiva: true,
};
const pronta = (extra: Partial<PreviaDoEnvio> = {}): PreviaDoEnvio => ({
  mensagem: destino.mensagem,
  variaveis: { primeiro_nome: "Ana", valor: 250.5 },
  bloqueio: null,
  naJanela: true,
  proximaJanela: null,
  tetoAtingido: false,
  ...extra,
});

function abrir() {
  const onMover = vi.fn();
  const onFechar = vi.fn();
  render(<MoverEEnviarDialog caso={caso} destino={destino} onMover={onMover} onFechar={onFechar} />);
  return { onMover, onFechar };
}

describe("MoverEEnviarDialog", () => {
  beforeEach(() => {
    previa = { data: pronta(), isLoading: false, isError: false };
  });

  it("mostra a mensagem renderizada com os dados do caso e envia", async () => {
    const { onMover } = abrir();
    expect(screen.getByText("Olá, Ana. O valor de R$ 250,50 segue em aberto.")).toBeTruthy();
    expect(screen.getByText("Entra na fila da régua e sai em instantes.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Mover e enviar/ }));
    expect(onMover).toHaveBeenCalledWith(true);
  });

  it("bloqueio desliga o envio, explica o motivo e mantém o Só mover", async () => {
    previa = { data: pronta({ bloqueio: "nao_contatar" }), isLoading: false, isError: false };
    const { onMover } = abrir();
    expect((screen.getByRole("button", { name: /Mover e enviar/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/pediu para não receber mensagens/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Só mover" }));
    expect(onMover).toHaveBeenCalledWith(false);
  });

  it("fora do horário e com o limite do dia, avisa quando sai", () => {
    previa = { data: pronta({ naJanela: false, proximaJanela: "2026-10-26T12:00:00Z" }), isLoading: false, isError: false };
    abrir();
    expect(screen.getByText(/Fora do horário de envio: sai/)).toBeTruthy();
  });

  it("carregando: sem envio até a prévia chegar", () => {
    previa = { data: undefined, isLoading: true, isError: false };
    abrir();
    expect(screen.getByLabelText("Montando a prévia")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Mover e enviar/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
