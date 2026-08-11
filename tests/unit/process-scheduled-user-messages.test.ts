// @vitest-environment node
/**
 * process-scheduled-user-messages — a mensagem que o vendedor agendou no chat.
 *
 * O worker escrevia a linha de histórico de três jeitos errados, todos medidos
 * em prod:
 *
 *  1. `instance_id` vinha de `scheduled_user_messages.whatsapp_instance_id`
 *     (NULL em 27 de 49 linhas) e não do chip que a própria função resolveu.
 *     Com NULL a mensagem nasce ÓRFÃ — some do chat, que filtra por
 *     `instance_id` — e o UNIQUE (message_id, instance_id) não dedupa, porque
 *     NULL é distinto de NULL.
 *  2. `message_id` era sempre sintético (`sched_<id>_<Date.now()>`), então o eco
 *     `fromMe` do webhook não colidia e INSERIA uma segunda linha.
 *  3. o retorno do envio era descartado: gravava `status: 'sent'` mesmo quando
 *     o provider (ou o SZ.Chat) recusou.
 *
 * Os testes abaixo dirigem o handler de verdade — fila, resolução de chip,
 * senders e SZ.Chat mockados — e olham o que sobrou gravado.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";

const CRON_SECRET = "cron-secret-de-teste";

// vi.hoisted — precisa existir ANTES do import do index.ts, que chama
// Deno.serve() no carregamento do módulo.
const { getHandler, state, sendText, sendMedia, sendAudio, strictResolve, szChatInvoke } =
  vi.hoisted(() => {
    const envStore: Record<string, string> = {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      CRON_SECRET: "cron-secret-de-teste",
    };
    let handler: unknown = null;

    (globalThis as any).Deno = {
      env: {
        get: (key: string) => envStore[key] ?? undefined,
        set: (key: string, value: string) => { envStore[key] = value; },
        delete: (key: string) => { delete envStore[key]; },
        toObject: () => ({ ...envStore }),
      },
      resolveDns: async () => [],
      serve: (fn: unknown) => { handler = fn; },
    };

    return {
      getHandler: () => handler as (req: Request) => Promise<Response>,
      state: { client: null as any },
      sendText: vi.fn(),
      sendMedia: vi.fn(),
      sendAudio: vi.fn(),
      strictResolve: vi.fn(),
      szChatInvoke: vi.fn(),
    };
  });

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => {
    if (!state.client) throw new Error("teste não configurou o cliente supabase");
    return state.client;
  },
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_name: string, handler: unknown) => handler,
}));

vi.mock("../../supabase/functions/_shared/cors.ts", () => ({
  getCorsHeaders: () => ({ "Access-Control-Allow-Origin": "*" }),
}));

vi.mock("../../supabase/functions/_shared/security-headers.ts", () => ({
  withSecurityHeaders: (h: Record<string, string>) => h,
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../supabase/functions/_shared/auth.ts", () => ({
  timingSafeCompare: (a: string, b: string) => a === b,
}));

vi.mock("../../supabase/functions/_shared/instance-write-guard.ts", () => {
  class StrictWriteResolutionError extends Error {
    constructor(public readonly errorCode: string, public readonly leadId: string) {
      super(`StrictWriteResolutionError: ${errorCode} (lead=${leadId})`);
    }
  }
  return { resolveStrictInstanceForCaller: strictResolve, StrictWriteResolutionError };
});

vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  sendTextViaInstance: sendText,
  sendMediaViaInstance: sendMedia,
  sendAudioViaInstance: sendAudio,
}));

// Jitter real dorme 3–8s entre envios; aqui só o batch importa.
vi.mock("../../supabase/functions/_shared/anti-ban-jitter.ts", () => ({
  sleepJitter: () => Promise.resolve(),
  maxBatchForBudget: (budget: number, perItem: number) =>
    Math.max(1, Math.floor(budget / perItem)),
}));

import "../../supabase/functions/process-scheduled-user-messages/index.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const CHIP_CONECTADO = {
  id: "inst-conectada",
  organization_id: "org-1",
  provider: "uazapi",
  status: "connected",
  instance_name: "vendas",
};

/** Linha típica da fila: quem agenda pelo chat NÃO escolhe chip. */
const AGENDADA = {
  id: "sched-1",
  organization_id: "org-1",
  status: "scheduled",
  scheduled_at: "2026-08-05T11:00:00.000Z",
  phone_number: "11999887766",
  message_content: "Bom dia! Fechamos o pedido?",
  media_url: null,
  media_type: null,
  media_filename: null,
  whatsapp_instance_id: null,
  lead_id: null,
  created_by: "tm-1",
  retry_count: 0,
};

interface Seed {
  scheduled: Record<string, unknown>[];
  instances?: Record<string, unknown>[];
}

async function runTick(seed: Seed) {
  const mock = createMockSupabase();
  mock.mockTable("scheduled_user_messages", seed.scheduled);
  mock.mockTable("whatsapp_instances", seed.instances ?? [CHIP_CONECTADO]);
  mock.mockTable("whatsapp_messages", []);
  mock.mockTable("team_members", []);
  mock.mockTable("notifications", []);

  // Registra o PAYLOAD de cada update — o estado final da linha não distingue
  // "nunca marcou sent" de "marcou sent e depois sobrescreveu".
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const realFrom = mock.sb.from.bind(mock.sb);
  mock.sb.from = (table: string) => {
    const chain = realFrom(table);
    const realUpdate = chain.update.bind(chain);
    chain.update = (values: Record<string, unknown>) => {
      updates.push({ table, values });
      return realUpdate(values);
    };
    return chain;
  };
  mock.sb.functions = { invoke: szChatInvoke };

  state.client = mock.sb;

  const res = await getHandler()(
    new Request("http://localhost/process-scheduled-user-messages", {
      method: "POST",
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  return {
    status: res.status,
    body: await res.json(),
    historico: mock.getInserted("whatsapp_messages"),
    // 'sending' do lock fica de fora: só interessa o desfecho da linha.
    fila: updates
      .filter((u) => u.table === "scheduled_user_messages")
      .map((u) => u.values)
      .filter((v) => v.status !== "sending"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  strictResolve.mockResolvedValue(null);
  sendText.mockResolvedValue({ success: true, messageId: "BATATA:3EB0AA" });
  sendMedia.mockResolvedValue({ success: true, messageId: "BATATA:3EB0BB" });
  sendAudio.mockResolvedValue({ success: true, messageId: "BATATA:3EB0CC" });
  szChatInvoke.mockResolvedValue({ data: { success: true }, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Defeito 1: instance_id ───────────────────────────────────────────────

describe("process-scheduled-user-messages — a linha pertence ao chip que enviou", () => {
  it("grava a instância RESOLVIDA quando a linha agendada não escolheu chip", async () => {
    const { historico, body } = await runTick({ scheduled: [{ ...AGENDADA }] });

    expect(body).toMatchObject({ sent: 1, failed: 0 });
    expect(historico).toHaveLength(1);
    expect(historico[0].instance_id).toBe("inst-conectada");
  });

  it("nunca grava instance_id nulo — linha órfã some do chat, que filtra por instance_id", async () => {
    const { historico } = await runTick({
      scheduled: [{ ...AGENDADA, whatsapp_instance_id: null }],
    });

    expect(historico[0].instance_id).not.toBeNull();
    expect(historico[0].instance_id).not.toBeUndefined();
  });

  it("o chip do responsável (strict) vence a coluna da fila — o histórico segue quem enviou", async () => {
    strictResolve.mockResolvedValue({
      id: "inst-do-responsavel",
      organization_id: "org-1",
      provider: "uazapi",
      status: "connected",
    });

    const { historico } = await runTick({
      scheduled: [{ ...AGENDADA, lead_id: "lead-1", whatsapp_instance_id: "inst-antiga" }],
      instances: [CHIP_CONECTADO, { ...CHIP_CONECTADO, id: "inst-antiga" }],
    });

    expect(historico).toHaveLength(1);
    expect(historico[0].instance_id).toBe("inst-do-responsavel");
  });
});

// ─── Defeito 2: message_id ────────────────────────────────────────────────

describe("process-scheduled-user-messages — message_id é o do provider", () => {
  it("grava o id REAL do envio, para o eco fromMe colidir na UNIQUE em vez de duplicar", async () => {
    sendText.mockResolvedValue({ success: true, messageId: "BATATA:3EB0C1D2E3" });

    const { historico } = await runTick({ scheduled: [{ ...AGENDADA }] });

    expect(historico[0].message_id).toBe("BATATA:3EB0C1D2E3");
  });

  it("cai no id sintético só quando o provider não devolve id", async () => {
    sendText.mockResolvedValue({ success: true });

    const { historico } = await runTick({ scheduled: [{ ...AGENDADA }] });

    expect(historico[0].message_id).toBe("sched_sched-1_text");
  });

  it("o id sintético é estável entre ticks — reenvio da mesma linha não duplica", async () => {
    sendText.mockResolvedValue({ success: true });
    vi.useFakeTimers();

    vi.setSystemTime(new Date("2026-08-05T12:00:00Z"));
    const primeiro = await runTick({ scheduled: [{ ...AGENDADA }] });

    vi.setSystemTime(new Date("2026-08-05T12:07:31Z"));
    const segundo = await runTick({ scheduled: [{ ...AGENDADA }] });

    expect(segundo.historico[0].message_id).toBe(primeiro.historico[0].message_id);
  });

  it("texto e mídia viram DUAS linhas, cada uma com o id do seu próprio envio", async () => {
    sendText.mockResolvedValue({ success: true, messageId: "BATATA:TEXTO" });
    sendMedia.mockResolvedValue({ success: true, messageId: "BATATA:IMAGEM" });

    const { historico } = await runTick({
      scheduled: [{
        ...AGENDADA,
        media_url: "https://cdn.test/tabela.png",
        media_type: "image",
        media_filename: "tabela.png",
      }],
    });

    expect(historico).toHaveLength(2);
    expect(historico.map((r) => [r.message_id, r.message_type, r.media_url])).toEqual([
      ["BATATA:TEXTO", "text", null],
      ["BATATA:IMAGEM", "image", "https://cdn.test/tabela.png"],
    ]);
  });
});

// ─── Defeito 3: retorno do envio descartado ───────────────────────────────

describe("process-scheduled-user-messages — envio recusado não vira 'sent'", () => {
  it("provider recusa: não grava histórico e devolve a linha para retry", async () => {
    sendText.mockResolvedValue({ success: false, error: "Invalid phone" });

    const { historico, fila, body } = await runTick({ scheduled: [{ ...AGENDADA }] });

    expect(historico).toHaveLength(0);
    expect(body).toMatchObject({ sent: 0, failed: 1 });
    expect(fila.some((v) => v.status === "sent")).toBe(false);
    expect(fila[0]).toMatchObject({ status: "scheduled", retry_count: 1 });
  });

  it("skip do governor também é recusa — nada de linha 'sent' sem envio", async () => {
    sendText.mockResolvedValue({ success: false, error: "governor_skip:daily_cap" });

    const { historico, fila } = await runTick({ scheduled: [{ ...AGENDADA }] });

    expect(historico).toHaveLength(0);
    expect(fila.some((v) => v.status === "sent")).toBe(false);
  });

  it("na última tentativa a fila vai para 'failed' com o motivo, e segue sem histórico", async () => {
    sendText.mockResolvedValue({ success: false, error: "Invalid phone" });

    const { historico, fila } = await runTick({
      scheduled: [{ ...AGENDADA, retry_count: 2 }],
    });

    expect(historico).toHaveLength(0);
    expect(fila[0]).toMatchObject({
      status: "failed",
      retry_count: 3,
      error_message: "Invalid phone",
    });
  });

  it("parcial: grava só o que saiu e registra a falha na linha, sem retry do que já chegou", async () => {
    sendText.mockResolvedValue({ success: true, messageId: "BATATA:TEXTO" });
    sendMedia.mockResolvedValue({ success: false, error: "media 500" });

    const { historico, fila } = await runTick({
      scheduled: [{
        ...AGENDADA,
        media_url: "https://cdn.test/tabela.png",
        media_type: "image",
      }],
    });

    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({ message_id: "BATATA:TEXTO", message_type: "text" });
    expect(fila[0]).toMatchObject({ status: "sent", error_message: "media 500" });
  });

  it("linha sem texto e sem mídia não vira entrega — não envia nem grava", async () => {
    const { historico, fila } = await runTick({
      scheduled: [{ ...AGENDADA, message_content: null }],
    });

    expect(sendText).not.toHaveBeenCalled();
    expect(sendMedia).not.toHaveBeenCalled();
    expect(historico).toHaveLength(0);
    expect(fila.some((v) => v.status === "sent")).toBe(false);
  });

  it("recusa do SZ.Chat não vira 'sent' — o retorno do invoke é lido", async () => {
    szChatInvoke.mockResolvedValue({
      data: { success: false, error: "sessao expirada" },
      error: null,
    });

    const { historico, fila } = await runTick({
      scheduled: [{ ...AGENDADA, whatsapp_instance_id: "inst-szchat" }],
      instances: [{
        id: "inst-szchat",
        organization_id: "org-1",
        provider: "uazapi",
        status: "connected",
        metadata: { provider: "szchat" },
      }],
    });

    expect(szChatInvoke).toHaveBeenCalledTimes(1);
    expect(historico).toHaveLength(0);
    expect(fila.some((v) => v.status === "sent")).toBe(false);
    expect(fila[0]).toMatchObject({ status: "scheduled", retry_count: 1 });
  });

  it("SZ.Chat aceito grava a linha no chip do SZ.Chat, com id sintético", async () => {
    const { historico } = await runTick({
      scheduled: [{ ...AGENDADA, whatsapp_instance_id: "inst-szchat" }],
      instances: [{
        id: "inst-szchat",
        organization_id: "org-1",
        provider: "uazapi",
        status: "connected",
        metadata: { provider: "szchat" },
      }],
    });

    expect(historico).toHaveLength(1);
    expect(historico[0]).toMatchObject({
      instance_id: "inst-szchat",
      message_id: "sched_sched-1_text",
    });
  });
});

// ─── sent_source explícito ────────────────────────────────────────────────

describe("process-scheduled-user-messages — autoria da mensagem", () => {
  it("carimba sent_source='manual' e sent_by_ai=false na própria linha, sem depender do DEFAULT", async () => {
    const { historico } = await runTick({ scheduled: [{ ...AGENDADA, lead_id: "lead-1" }] });

    // A presença da chave é o ponto: é este par que o
    // trg_human_pause_on_manual_send lê para pausar o Copilot do lead. Herdar
    // do DEFAULT do banco deixaria a pausa acontecendo por acidente.
    expect(historico[0]).toHaveProperty("sent_source", "manual");
    expect(historico[0]).toHaveProperty("sent_by_ai", false);
    expect(historico[0]).toMatchObject({
      organization_id: "org-1",
      lead_id: "lead-1",
      direction: "outgoing",
      status: "sent",
      content: "Bom dia! Fechamos o pedido?",
    });
  });
});
