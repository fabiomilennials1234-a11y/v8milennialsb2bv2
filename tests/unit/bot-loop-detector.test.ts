/**
 * bot-loop-detector — detecta loop bot-to-bot via padrão de mensagens.
 *
 * Origem: investigação Bertin 2026-05-08/09. Phone 5515935004596 (bot
 * imobiliário externo) trocou 3000+ msgs com o Copilot Bia em 9h13min.
 * Sem detector, conversa só para quando humano nota.
 *
 * Função pura — recebe lista de msgs (já carregadas), retorna decisão.
 * Caller (agent-engine, whatsapp-webhook) decide pause.
 */

import { describe, it, expect } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import {
  evaluateLoopSignal,
  detectLoop,
  type LoopMessage,
} from "../../supabase/functions/_shared/bot-loop-detector.ts";

const NOW = new Date("2026-05-09T09:00:00Z");

function msg(args: Partial<LoopMessage> & { secondsAgo: number; direction: "incoming" | "outgoing" }): LoopMessage {
  return {
    content_hash: args.content_hash ?? "h-default",
    direction: args.direction,
    timestamp: new Date(NOW.getTime() - args.secondsAgo * 1000).toISOString(),
  };
}

describe("evaluateLoopSignal — identical outgoing burst", () => {
  it("3 outgoing with same content_hash in <60s → shouldPause=true", () => {
    const messages: LoopMessage[] = [
      msg({ direction: "outgoing", content_hash: "h-greeting", secondsAgo: 50 }),
      msg({ direction: "outgoing", content_hash: "h-greeting", secondsAgo: 30 }),
      msg({ direction: "outgoing", content_hash: "h-greeting", secondsAgo: 10 }),
    ];
    const result = evaluateLoopSignal({ messages, now: NOW });
    expect(result).not.toBeNull();
    expect(result?.shouldPause).toBe(true);
    expect(result?.reason).toBe("identical_outgoing_burst");
    expect(result?.evidence.count).toBe(3);
  });

  it("3 outgoing with different content → null (não é loop, é conversa real)", () => {
    const messages: LoopMessage[] = [
      msg({ direction: "outgoing", content_hash: "h-1", secondsAgo: 50 }),
      msg({ direction: "outgoing", content_hash: "h-2", secondsAgo: 30 }),
      msg({ direction: "outgoing", content_hash: "h-3", secondsAgo: 10 }),
    ];
    expect(evaluateLoopSignal({ messages, now: NOW })).toBeNull();
  });

  it("1 outgoing solo → null (greeting normal, sem falso positivo)", () => {
    const messages: LoopMessage[] = [
      msg({ direction: "outgoing", content_hash: "h-greeting", secondsAgo: 10 }),
    ];
    expect(evaluateLoopSignal({ messages, now: NOW })).toBeNull();
  });

  it("3 identical outgoing but spread across >60s → null (fora da janela burst)", () => {
    const messages: LoopMessage[] = [
      msg({ direction: "outgoing", content_hash: "h-greeting", secondsAgo: 200 }),
      msg({ direction: "outgoing", content_hash: "h-greeting", secondsAgo: 130 }),
      msg({ direction: "outgoing", content_hash: "h-greeting", secondsAgo: 70 }),
    ];
    expect(evaluateLoopSignal({ messages, now: NOW })).toBeNull();
  });
});

describe("evaluateLoopSignal — inbound/outbound pingpong", () => {
  it("3+ inbound→outbound pairs with gap <5s and identical outbound → pingpong", () => {
    // Fixture real Bertin 553172280540: incoming msg do bot externo,
    // copilot dispara "fora de horário", incoming de novo, copilot de novo...
    // Bot-to-bot tempo de resposta < 5s indica máquina.
    const messages: LoopMessage[] = [
      msg({ direction: "incoming", content_hash: "in-1", secondsAgo: 30 }),
      msg({ direction: "outgoing", content_hash: "h-outhours", secondsAgo: 28 }),
      msg({ direction: "incoming", content_hash: "in-2", secondsAgo: 25 }),
      msg({ direction: "outgoing", content_hash: "h-outhours", secondsAgo: 23 }),
      msg({ direction: "incoming", content_hash: "in-3", secondsAgo: 20 }),
      msg({ direction: "outgoing", content_hash: "h-outhours", secondsAgo: 18 }),
    ];
    const result = evaluateLoopSignal({ messages, now: NOW });
    expect(result).not.toBeNull();
    expect(result?.shouldPause).toBe(true);
    // 3 outbound idênticas atende identical_outgoing_burst antes (ok), mas
    // pingpong é classificação preferida quando há padrão alternado.
    expect(["identical_outgoing_burst", "inbound_outbound_pingpong"]).toContain(result?.reason);
  });

  it("alternating but with human-pace gaps (>10s) and varied outbound → null", () => {
    const messages: LoopMessage[] = [
      msg({ direction: "incoming", content_hash: "in-1", secondsAgo: 90 }),
      msg({ direction: "outgoing", content_hash: "out-1", secondsAgo: 60 }),
      msg({ direction: "incoming", content_hash: "in-2", secondsAgo: 40 }),
      msg({ direction: "outgoing", content_hash: "out-2", secondsAgo: 20 }),
    ];
    expect(evaluateLoopSignal({ messages, now: NOW })).toBeNull();
  });
});

describe("detectLoop — queries Supabase and evaluates", () => {
  it("fetches recent messages scoped to (org, phone, lookback) and forwards to evaluator", async () => {
    const NOW2 = new Date("2026-05-09T09:00:00Z");
    // 3 outgoing rows with identical content within 30s for the target
    // (org, phone). One row scoped to a different phone is included to
    // prove the filter actually narrows.
    const rows = [
      { content_hash: "h", content: "Olá!", direction: "outgoing", timestamp: new Date(NOW2.getTime() - 30_000).toISOString(), organization_id: "org-1", phone_number: "+5515935004596" },
      { content_hash: "h", content: "Olá!", direction: "outgoing", timestamp: new Date(NOW2.getTime() - 20_000).toISOString(), organization_id: "org-1", phone_number: "+5515935004596" },
      { content_hash: "h", content: "Olá!", direction: "outgoing", timestamp: new Date(NOW2.getTime() - 10_000).toISOString(), organization_id: "org-1", phone_number: "+5515935004596" },
      { content_hash: "h", content: "Olá!", direction: "outgoing", timestamp: new Date(NOW2.getTime() - 5_000).toISOString(), organization_id: "org-1", phone_number: "+5599999999999" },
    ];
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", rows);

    const signal = await detectLoop({
      supabase: sb,
      orgId: "org-1",
      phone: "+5515935004596",
      now: NOW2,
      lookbackSeconds: 120,
    });

    expect(signal?.shouldPause).toBe(true);
    expect(signal?.reason).toBe("identical_outgoing_burst");
    expect(signal?.evidence.count).toBe(3); // confirms cross-phone row not counted
  });
});

describe("evaluateLoopSignal — configurable window", () => {
  it("respects burstWindowSeconds override (stricter window — 20s)", () => {
    // 3 identical at 25s/15s/5s. Default window 60s → pause. Override 20s →
    // só 2 ficam dentro do cutoff → null.
    const messages: LoopMessage[] = [
      msg({ direction: "outgoing", content_hash: "h", secondsAgo: 25 }),
      msg({ direction: "outgoing", content_hash: "h", secondsAgo: 15 }),
      msg({ direction: "outgoing", content_hash: "h", secondsAgo: 5 }),
    ];
    expect(evaluateLoopSignal({ messages, now: NOW, burstWindowSeconds: 60 })?.shouldPause).toBe(true);
    expect(evaluateLoopSignal({ messages, now: NOW, burstWindowSeconds: 20 })).toBeNull();
  });
});
