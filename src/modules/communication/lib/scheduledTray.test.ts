import { describe, it, expect } from "vitest";
import {
  agruparPorDia,
  envioTravado,
  ehUrgente,
  hora,
  minutosAte,
  motivoDaFalha,
  podeEscrever,
  previa,
  programadas,
  progressoDoAnel,
  rotuloDoDia,
  separarFila,
  tempoRestante,
  tipoDeMidia,
} from "./scheduledTray";
import type { ScheduledMessage } from "@/modules/communication/hooks/useScheduledMessages";

// Relógio local fixo: seg., 09/11/2026 14:00.
const NOW = new Date(2026, 10, 9, 14, 0, 0).getTime();
const emMin = (m: number) => new Date(NOW + m * 60_000).toISOString();

function msg(over: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: "m1",
    organization_id: "org",
    lead_id: null,
    phone_number: "5511999990000",
    created_by: "tm-eu",
    assigned_to: "tm-eu",
    whatsapp_instance_id: "inst",
    message_content: "Oi",
    media_url: null,
    media_type: null,
    media_filename: null,
    scheduled_at: emMin(36),
    status: "scheduled",
    sent_at: null,
    error_message: null,
    retry_count: 0,
    created_at: emMin(-20),
    ...over,
  };
}

describe("tempo restante e urgência", () => {
  it("formata minutos, horas e dias como no mockup", () => {
    expect(tempoRestante(emMin(0), NOW)).toBe("agora");
    expect(tempoRestante(emMin(-5), NOW)).toBe("agora");
    expect(tempoRestante(emMin(4), NOW)).toBe("em 4 min");
    expect(tempoRestante(emMin(36), NOW)).toBe("em 36 min");
    expect(tempoRestante(emMin(120), NOW)).toBe("em 2h");
    expect(tempoRestante(emMin(126), NOW)).toBe("em 2h 6min");
    expect(tempoRestante(emMin(1146), NOW)).toBe("em 19h 6min");
    expect(tempoRestante(emMin(60 * 24), NOW)).toBe("em 1 dia");
    expect(tempoRestante(emMin(60 * 50), NOW)).toBe("em 2 dias");
  });

  it("urgente abaixo de 15 min, inclusive atrasada", () => {
    expect(ehUrgente(emMin(14), NOW)).toBe(true);
    expect(ehUrgente(emMin(-3), NOW)).toBe(true);
    expect(ehUrgente(emMin(15), NOW)).toBe(false);
    expect(minutosAte(emMin(-3), NOW)).toBe(0);
  });
});

describe("progresso do anel", () => {
  it("cheio ao programar, vazio na hora, proporcional no meio", () => {
    expect(progressoDoAnel(emMin(0), emMin(60), NOW)).toBe(1);
    expect(progressoDoAnel(emMin(-60), emMin(0), NOW)).toBe(0);
    expect(progressoDoAnel(emMin(-30), emMin(30), NOW)).toBeCloseTo(0.5);
    expect(progressoDoAnel(emMin(-30), emMin(-10), NOW)).toBe(0);
  });

  it("não divide por zero quando criada e programada coincidem", () => {
    expect(progressoDoAnel(emMin(10), emMin(10), NOW)).toBe(1);
  });
});

describe("dias", () => {
  it("Hoje, Amanhã, Ontem e data curta", () => {
    expect(rotuloDoDia(new Date(2026, 10, 9, 23, 59), NOW)).toBe("Hoje");
    expect(rotuloDoDia(new Date(2026, 10, 10, 0, 1), NOW)).toBe("Amanhã");
    expect(rotuloDoDia(new Date(2026, 10, 8, 9, 0), NOW)).toBe("Ontem");
    expect(rotuloDoDia(new Date(2026, 10, 16, 9, 0), NOW)).toBe("seg., 16/11");
  });

  it("agrupa preservando a ordem", () => {
    const itens = [
      msg({ id: "a", scheduled_at: new Date(2026, 10, 9, 14, 30).toISOString() }),
      msg({ id: "b", scheduled_at: new Date(2026, 10, 9, 16, 6).toISOString() }),
      msg({ id: "c", scheduled_at: new Date(2026, 10, 10, 9, 0).toISOString() }),
      msg({ id: "d", scheduled_at: new Date(2026, 10, 16, 9, 0).toISOString() }),
    ];
    const grupos = agruparPorDia(itens, NOW);
    expect(grupos.map((g) => [g.rotulo, g.itens.map((i) => i.id)])).toEqual([
      ["Hoje", ["a", "b"]],
      ["Amanhã", ["c"]],
      ["seg., 16/11", ["d"]],
    ]);
  });

  it("hora em 24h com dois dígitos", () => {
    expect(hora(new Date(2026, 10, 9, 9, 5))).toBe("09:05");
  });
});

describe("motivo da falha", () => {
  it.each([
    ["Instance disconnected", "WhatsApp desconectado no horário do envio"],
    ["instance not connected", "WhatsApp desconectado no horário do envio"],
    ["WhatsApp desconectado", "WhatsApp desconectado no horário do envio"],
    ["Number is not on WhatsApp", "Número sem WhatsApp"],
    ["número inválido", "Número sem WhatsApp"],
    ["Nenhuma instancia WhatsApp disponivel", "Nenhum WhatsApp conectado para enviar"],
    ["timeout 504", "O envio falhou"],
    [null, "O envio falhou"],
  ])("%s → %s", (entrada, saida) => {
    expect(motivoDaFalha(entrada)).toBe(saida);
  });
});

describe("separar fila", () => {
  it("falha recente à parte, pendentes por horário, dedup por id, falha velha fora", () => {
    const fila = separarFila(
      [
        msg({ id: "p2", scheduled_at: emMin(126) }),
        msg({ id: "p1", scheduled_at: emMin(36) }),
        msg({ id: "p1", scheduled_at: emMin(36) }),
        msg({ id: "s", status: "sending", scheduled_at: emMin(0) }),
        msg({ id: "travada", status: "sending", scheduled_at: emMin(-6) }),
        msg({ id: "f", status: "failed", scheduled_at: emMin(-12) }),
        msg({ id: "velha", status: "failed", scheduled_at: emMin(-60 * 24 * 8) }),
        msg({ id: "x", status: "cancelled" }),
        msg({ id: "ok", status: "sent" }),
      ],
      NOW,
    );
    expect(fila.falhas.map((m) => m.id)).toEqual(["f"]);
    expect(fila.pendentes.map((m) => m.id)).toEqual(["s", "p1", "p2"]);
    expect(fila.travadas.map((m) => m.id)).toEqual(["travada"]);
  });
});

describe("permissão de escrita", () => {
  it("só o autor ou master", () => {
    expect(podeEscrever(msg({ created_by: "tm-eu" }), "tm-eu", false)).toBe(true);
    expect(podeEscrever(msg({ created_by: "tm-ana" }), "tm-eu", false)).toBe(false);
    expect(podeEscrever(msg({ created_by: "tm-ana" }), "tm-eu", true)).toBe(true);
    expect(podeEscrever(msg({ created_by: "tm-ana" }), undefined, false)).toBe(false);
  });
});

describe("mídia e texto", () => {
  it("rótulos e prévia", () => {
    expect(tipoDeMidia("image")).toBe("image");
    expect(tipoDeMidia("sticker")).toBe("document");
    expect(tipoDeMidia(null)).toBeNull();
    expect(previa(msg({ message_content: null, media_filename: "boleto.pdf" }))).toBe("boleto.pdf");
    expect(programadas(1)).toBe("1 programada");
    expect(programadas(3)).toBe("3 programadas");
  });
});

describe("envio travado", () => {
  it("sending há mais de 5 min desde scheduled_at", () => {
    expect(envioTravado(msg({ status: "sending", scheduled_at: emMin(-5) }), NOW)).toBe(false);
    expect(envioTravado(msg({ status: "sending", scheduled_at: emMin(-6) }), NOW)).toBe(true);
    expect(envioTravado(msg({ status: "scheduled", scheduled_at: emMin(-60) }), NOW)).toBe(false);
  });
});
