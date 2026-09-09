import { describe, it, expect, vi } from "vitest";

import { MotorDeSom } from "./motor-de-som";

/**
 * O motor não é testado pelo som que produz — isso é ouvido, não asserção. O
 * que se testa é o contrato com o ambiente: quantas notas cada timbre agenda,
 * o volume chegando ao ganho mestre, e a recusa silenciosa onde não há áudio.
 */
function contextoFalso() {
  const osciladores: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const ganhoMestre = { gain: { value: 0 }, connect: vi.fn() };
  let primeiroGanho = true;

  return {
    osciladores,
    ganhoMestre,
    ctx: {
      state: "running",
      currentTime: 0,
      destination: {},
      createGain: () => {
        if (primeiroGanho) {
          primeiroGanho = false;
          return ganhoMestre;
        }
        return {
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
          connect: vi.fn(),
        };
      },
      createDynamicsCompressor: () => ({ connect: vi.fn() }),
      createOscillator: () => {
        const osc = {
          type: "sine",
          frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        osciladores.push(osc);
        return osc;
      },
    } as unknown as AudioContext,
  };
}

describe("motor de som", () => {
  it("agenda uma nota por evento do timbre e aplica o volume no ganho mestre", () => {
    const falso = contextoFalso();
    const motor = new MotorDeSom(() => falso.ctx);

    motor.tocar("lead", 100);

    expect(falso.osciladores).toHaveLength(3);
    expect(falso.osciladores.every((o) => o.start.mock.calls.length === 1)).toBe(true);
    expect(falso.ganhoMestre.gain.value).toBeCloseTo(0.9, 5);
  });

  it("volume zero não vira ganho zero absoluto — rampa exponencial não aceita zero", () => {
    const falso = contextoFalso();
    const motor = new MotorDeSom(() => falso.ctx);

    motor.tocar("mensagem", 0);

    expect(falso.ganhoMestre.gain.value).toBeGreaterThan(0);
  });

  it("sem áudio disponível, cala em vez de derrubar o sino", () => {
    const motor = new MotorDeSom(() => null);

    expect(() => motor.tocar("erro", 55)).not.toThrow();
  });

  it("contexto que explode ao ser criado não escapa para quem chamou", () => {
    const motor = new MotorDeSom(() => {
      throw new Error("AudioContext bloqueado");
    });

    expect(() => motor.tocar("sistema", 55)).not.toThrow();
  });

  it("contexto suspenso é retomado antes de agendar — senão toca no vazio", async () => {
    const falso = contextoFalso();
    const ctx = falso.ctx as unknown as { state: string; resume: () => Promise<void> };
    ctx.state = "suspended";
    let retomou = false;
    // No navegador, resume() é assíncrono: o estado só vira "running" quando a
    // promessa resolve. Um dublê que muda na hora esconderia o defeito.
    ctx.resume = () => {
      retomou = true;
      return Promise.resolve().then(() => {
        ctx.state = "running";
      });
    };

    const motor = new MotorDeSom(() => falso.ctx);
    motor.tocar("mensagem", 55);

    // Nada é agendado antes da retomada: o navegador ignoraria as notas.
    expect(falso.osciladores).toHaveLength(0);

    await Promise.resolve();
    await Promise.resolve();

    expect(retomou).toBe(true);
    expect(falso.osciladores).toHaveLength(2);
  });

  it("retomada recusada não explode nem marca o áudio como destravado", async () => {
    const falso = contextoFalso();
    const ctx = falso.ctx as unknown as { state: string; resume: () => Promise<void> };
    ctx.state = "suspended";
    ctx.resume = () => Promise.reject(new Error("gesto ausente"));

    const motor = new MotorDeSom(() => falso.ctx);

    expect(() => motor.tocar("erro", 55)).not.toThrow();
    await Promise.resolve();
    expect(falso.osciladores).toHaveLength(0);
  });
});
