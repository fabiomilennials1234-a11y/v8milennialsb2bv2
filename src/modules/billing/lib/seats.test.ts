/**
 * O piso de assentos — o caso que motivou o módulo é o de PEDIR MENOS.
 *
 * Números tirados da medição em produção do `torque-2.0`: inclui 5, e pedir 1
 * a 5 cobra o mesmo. Se alguém "simplificar" `atFloor` para `requested <
 * included`, o caso de igualdade (pedir exatamente 5) passa a dizer "5 assentos
 * são cobrados à parte", que é falso e é justamente o que confunde o operador.
 */

import { describe, it, expect } from "vitest";
import { seatFloor, seatFloorMessage } from "./seats";

describe("seatFloor", () => {
  it("pedir menos que o incluído fica no piso, sem extras", () => {
    const floor = seatFloor(3, 5);
    expect(floor.atFloor).toBe(true);
    expect(floor.extra).toBe(0);
  });

  it("pedir exatamente o incluído ainda é piso — a igualdade é o caso que se perde primeiro", () => {
    const floor = seatFloor(5, 5);
    expect(floor.atFloor).toBe(true);
    expect(floor.extra).toBe(0);
  });

  it("acima do incluído, o excedente é a diferença", () => {
    const floor = seatFloor(12, 5);
    expect(floor.atFloor).toBe(false);
    expect(floor.extra).toBe(7);
  });

  it("entrada suja não vira NaN em tela: assento negativo ou vazio conta zero", () => {
    expect(seatFloor(Number.NaN, 5).requested).toBe(0);
    expect(seatFloor(-3, 5).extra).toBe(0);
    expect(seatFloor(6, Number.NaN).included).toBe(0);
  });
});

describe("seatFloorMessage", () => {
  it("avisa que o preço NÃO cai quando o operador pede menos — a frase que evita o falso bug", () => {
    const msg = seatFloorMessage(seatFloor(3, 5));
    expect(msg).toContain("já inclui 5");
    expect(msg).toContain("não reduz o preço");
  });

  it("no ponto exato, diz que estão no preço base sem falar em redução", () => {
    const msg = seatFloorMessage(seatFloor(5, 5));
    expect(msg).toContain("inclui 5 assentos");
    expect(msg).not.toContain("não reduz");
  });

  it("acima do piso, conta quantos são cobrados à parte, no singular certo", () => {
    expect(seatFloorMessage(seatFloor(6, 5))).toContain("1 assento é cobrado");
    expect(seatFloorMessage(seatFloor(12, 5))).toContain("7 assentos são cobrados");
  });

  it("plano sem assento incluído não gera frase — texto sobre piso inexistente é ruído", () => {
    expect(seatFloorMessage(seatFloor(4, 0))).toBeNull();
  });
});
