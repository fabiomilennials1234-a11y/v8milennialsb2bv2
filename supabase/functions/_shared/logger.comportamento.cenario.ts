// Cenário compartilhado (branch e main): evento típico do whatsapp-webhook.
import type { logRuntime } from "./logger.ts";
type LogFn = typeof logRuntime;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const ORG = "11111111-1111-4111-8111-111111111111";
export const INST = "22222222-2222-4222-8222-222222222222";

export const TEL = "5511987654321";
export const EMAIL = "fulano.silva@exemplo.com.br";
export const CPF = "123.456.789-09";
// Assemble the deliberately fake token so secret scanning can remain enabled.
export const TOKEN = ["sk_live", "ABCDEFGHIJKLMNOP"].join("_");
export const REASONING = `Lead escreveu: oi, meu zap é ${TEL}, email ${EMAIL}, CPF ${CPF}`;
export const PAYLOAD = {
  phone: TEL, email: EMAIL, cpf: CPF, authorization: `Bearer ${TOKEN}`,
  remote_jid: `${TEL}@s.whatsapp.net`, nested: { telefone: TEL, customer_email: EMAIL },
};
export const CRUS = [TEL, EMAIL, CPF, "12345678909", TOKEN, "Lead escreveu"];

/** Uma invocação do whatsapp-webhook, na ordem e com os await/void do handler. */
export async function webhookEvent(logRuntime: LogFn, r: () => number, i: number): Promise<number> {
  let calls = 0;
  // Pós-#2231: o resolve é 1 RPC e `uazapi_resolved_by_token_fallback` só sai com
  // id explícito no payload (raro, sinal de anomalia) — não faz parte do evento típico.
  const roll = r();
  if (roll < 0.209) {
    await logRuntime({
      organizationId: ORG, module: "webhook", action: "uazapi_group_message_skipped", status: "success",
      payloadSnapshot: { instance_id: INST, remote_jid: "120363000000000000@g.us", message_id: `m${i}`, reason: "capture_groups_off" },
    });
    calls++;
  } else if (roll < 0.338) {
    void logRuntime({
      organizationId: ORG, module: "webhook", action: "uazapi_agent_message_dispatched", status: "success",
      payloadSnapshot: { instance_id: INST, message_id: `m${i}`, channel: "whatsapp" },
    });
    calls++;
  } else if (roll < 0.384) {
    await logRuntime({ organizationId: ORG, module: "webhook", action: "uazapi_receipt_unmatched", status: "skipped" });
    calls++;
  }
  await logRuntime({
    organizationId: ORG, module: "webhook", action: "uazapi_process", status: "success",
    payloadSnapshot: { event: "messages", instance_id: INST },
  });
  return calls + 1;
}
