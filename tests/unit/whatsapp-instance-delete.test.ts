/**
 * runInstanceDeletion — laço de exclusão em lotes da instância de WhatsApp.
 *
 * Cobre o que o bug de 06/08 expôs: erro de lote não pode ser engolido, e
 * "não terminou nesta chamada" não pode virar falha (a RPC é idempotente).
 */

import { describe, it, expect, vi } from "vitest";
import {
  runInstanceDeletion,
  type DeleteStepCall,
  type DeleteStepProgress,
} from "../../supabase/functions/_shared/whatsapp-instance-delete.ts";

function okStep(progress: DeleteStepProgress): DeleteStepCall {
  return { data: progress, error: null };
}

describe("runInstanceDeletion", () => {
  it("chama a RPC até ela dizer done", async () => {
    const scripted: DeleteStepCall[] = [
      okStep({ done: false, phase: "messages", touched: 5000, remaining: 15424 }),
      okStep({ done: false, phase: "messages", touched: 5000, remaining: 10424 }),
      okStep({ done: false, phase: "media_jobs", touched: 5000, remaining: 8723 }),
      okStep({ done: true, phase: "deleted", remaining: 0 }),
    ];
    const step = vi.fn(() => Promise.resolve(scripted.shift()!));

    const result = await runInstanceDeletion({ step });

    expect(result.status).toBe("done");
    expect(result.steps).toBe(4);
    expect(step).toHaveBeenCalledTimes(4);
  });

  it("propaga erro da RPC em vez de engolir (o bug original)", async () => {
    const step = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: { message: "canceling statement due to statement timeout" },
      })
    );

    const result = await runInstanceDeletion({ step });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("statement timeout");
    }
    // Falhou no primeiro lote: não insiste.
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("devolve pending com progresso quando o deadline estoura", async () => {
    let clock = 0;
    const step = vi.fn(() => {
      clock += 20_000; // cada lote "gasta" 20s
      return Promise.resolve(
        okStep({ done: false, phase: "messages", touched: 5000, remaining: 9000 })
      );
    });

    const result = await runInstanceDeletion({
      step,
      now: () => clock,
      deadlineMs: 50_000,
    });

    expect(result.status).toBe("pending");
    expect(result.progress?.remaining).toBe(9000);
    // deadline em t=50s: para no 3º lote (t=60s), não no 2º (t=40s).
    expect(step).toHaveBeenCalledTimes(3);
  });

  it("para no teto de passos se a RPC nunca converge", async () => {
    const step = vi.fn(() =>
      Promise.resolve(okStep({ done: false, phase: "messages", remaining: 1 }))
    );

    const result = await runInstanceDeletion({
      step,
      now: () => 0, // relógio parado: só o teto de passos segura
      maxSteps: 7,
    });

    expect(result.status).toBe("pending");
    expect(step).toHaveBeenCalledTimes(7);
  });

  it("trata instância já removida como sucesso (idempotência)", async () => {
    const step = vi.fn(() =>
      Promise.resolve(okStep({ done: true, phase: "already_gone", remaining: 0 }))
    );

    const result = await runInstanceDeletion({ step });

    expect(result.status).toBe("done");
    expect(result.progress?.phase).toBe("already_gone");
  });
});
