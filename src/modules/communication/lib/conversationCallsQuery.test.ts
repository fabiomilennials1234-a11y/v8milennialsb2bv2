/**
 * A ligação precisa entrar na conversa — e a conversa é identificada por
 * TELEFONE, não por lead.
 *
 * Medido em produção (2026-08-02): 1.790.210 de 2.117.873 linhas de
 * `whatsapp_messages` (84,5%) têm `lead_id` NULO, enquanto `normalized_phone`
 * está 100% populado. Ligar a chamada à conversa só por `lead_id` perderia a
 * maioria das conversas. Por isso o filtro é telefone-primeiro, com `lead_id`
 * como segunda identidade (o registro manual de ligação nasce com lead e, na
 * única linha que existe hoje em prod, com `phone_number` NULO).
 *
 * ── Sobre o dublê deste arquivo ──
 * Ele PROJETA a lista do `.select(...)`. O helper compartilhado
 * (`tests/helpers/supabase-mock.ts:149`) recebe `_fields` e o ignora, então
 * devolve a linha inteira: uma coluna esquecida no `.select` passava verde e o
 * mutante que a removia não era pego. Aqui a projeção é real — some a coluna do
 * `.select`, some do resultado, o teste cai.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Recorded {
  table: string | null;
  columns: string | null;
  eq: Array<[string, unknown]>;
  or: string[];
  order: Array<[string, unknown]>;
  limit: number[];
}

const recorded: Recorded = { table: null, columns: null, eq: [], or: [], order: [], limit: [] };
let rows: Record<string, unknown>[] = [];
let queryError: unknown = null;

/** Projeta a linha para as colunas pedidas — como o PostgREST faz de verdade. */
function project(row: Record<string, unknown>, columns: string | null) {
  if (!columns) return { ...row };
  const wanted = columns.split(",").map((c) => c.trim()).filter(Boolean);
  const out: Record<string, unknown> = {};
  for (const col of wanted) {
    if (col in row) out[col] = row[col];
  }
  return out;
}

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const settle = () =>
    Promise.resolve(
      queryError
        ? { data: null, error: queryError }
        : { data: rows.map((r) => project(r, recorded.columns)), error: null },
    );
  Object.assign(builder, {
    select: (cols: string) => {
      recorded.columns = cols;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      recorded.eq.push([col, val]);
      return builder;
    },
    or: (expr: string) => {
      recorded.or.push(expr);
      return builder;
    },
    order: (col: string, opts: unknown) => {
      recorded.order.push([col, opts]);
      return builder;
    },
    limit: (n: number) => {
      recorded.limit.push(n);
      return settle();
    },
  });
  return builder;
}

const fromMock = vi.fn((table: string) => {
  recorded.table = table;
  return makeBuilder();
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => fromMock(t) },
}));

import {
  fetchConversationCalls,
  CONVERSATION_CALL_COLUMNS,
  formatCallDuration,
  isCallConnected,
  phoneVariants,
} from "./conversationCallsQuery";
import { THREAD_MESSAGE_LIMIT } from "./whatsappMessagesQuery";

beforeEach(() => {
  recorded.table = null;
  recorded.columns = null;
  recorded.eq = [];
  recorded.or = [];
  recorded.order = [];
  recorded.limit = [];
  rows = [];
  queryError = null;
  fromMock.mockClear();
});

describe("fetchConversationCalls — identidade da conversa", () => {
  it("lê de call_logs, escopa por org e usa a MESMA janela das mensagens", async () => {
    await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: null,
    });

    expect(recorded.table).toBe("call_logs");
    expect(recorded.eq).toContainEqual(["organization_id", "org-1"]);
    // DESC + limit explícito, igual à query de mensagens: sem limite o
    // PostgREST corta em max_rows sozinho e a janela cai nas linhas ANTIGAS.
    expect(recorded.order).toContainEqual(["started_at", { ascending: false }]);
    expect(recorded.limit).toEqual([THREAD_MESSAGE_LIMIT]);
  });

  it("devolve em ordem cronológica ascendente — o merge com as mensagens depende disso", async () => {
    rows = [
      { id: "call-c", started_at: "2026-08-06T10:00:00.000Z" },
      { id: "call-b", started_at: "2026-08-05T10:00:00.000Z" },
      { id: "call-a", started_at: "2026-08-04T10:00:00.000Z" },
    ];

    const res = await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: null,
    });

    expect(res.map((c) => c.id)).toEqual(["call-a", "call-b", "call-c"]);
  });

  it("qualquer formato de entrada produz o MESMO filtro", async () => {
    const formats = ["5548996458738", "48996458738", "+55 (48) 99645-8738"];
    const seen: string[] = [];

    for (const phone of formats) {
      recorded.or = [];
      await fetchConversationCalls({
        organizationId: "org-1",
        phoneNumber: phone,
        leadId: null,
      });
      seen.push(recorded.or[0]);
    }

    expect(new Set(seen).size).toBe(1);
  });

  it("NÃO pressupõe que o produtor gravou o telefone canônico", async () => {
    // `call-plane.ts:260` escolhe o peer com
    //   digitsOnly(normalized_phone) || digitsOnly(phone_digits) || digitsOnly(phone)
    // e os dois fallbacks são texto cru: '+55 48 9189-2653' vira '554891892653'.
    // A CHECK da coluna só exige 8–15 dígitos e `fn_voip_project_call_log` copia
    // `peer_phone` verbatim. Um `.eq` no formato canônico perderia essas linhas.
    await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548991892653",
      leadId: null,
    });

    const filtro = recorded.or[0];
    for (const forma of [
      "48991892653", // canônico
      "5548991892653", // com o 55
      "4891892653", // sem o nono dígito
      "554891892653", // com 55 e sem o nono dígito — o caso do '+55 48 9189-2653'
    ]) {
      expect(filtro).toContain(`phone_number.eq.${forma}`);
    }
  });

  it("quando há lead, aceita as DUAS identidades (telefone OU lead)", async () => {
    // A ligação registrada à mão nasce com lead_id e phone_number NULO
    // (medido: a única linha de call_logs pré-#1352 em prod é assim).
    await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: "11111111-2222-4333-8444-555555555555",
    });

    expect(recorded.or).toHaveLength(1);
    expect(recorded.or[0]).toContain("phone_number.eq.48996458738");
    expect(recorded.or[0]).toContain("lead_id.eq.11111111-2222-4333-8444-555555555555");
  });

  it("sem telefone e sem lead não consulta nada", async () => {
    const res = await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "  ",
      leadId: null,
    });
    expect(res).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("ignora lead_id que não seja UUID — não deixa injetar filtro no PostgREST", async () => {
    await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: "x,organization_id.neq.org-1",
    });
    expect(recorded.or[0]).not.toContain("lead_id");
    expect(recorded.or[0]).not.toContain("organization_id.neq");
  });

  it("propaga erro do supabase", async () => {
    queryError = new Error("boom");
    await expect(
      fetchConversationCalls({
        organizationId: "org-1",
        phoneNumber: "5548996458738",
        leadId: null,
      }),
    ).rejects.toThrow("boom");
  });

  it("pede as colunas que a peça desenha — e nenhuma a mais", async () => {
    rows = [
      {
        id: "call-1",
        lead_id: "lead-1",
        direction: "outbound",
        outcome: "connected",
        duration_seconds: 220,
        phone_number: "48996458738",
        started_at: "2026-08-02T19:23:23.000Z",
        recording_status: "ready",
        recording_url: "org-1/call-1.opus",
        recording_failure_reason: null,
        // Coluna que existe na tabela e a conversa NÃO usa: a anotação
        // comercial do vendedor não vai para o corpo da thread.
        notes: "SEGREDO COMERCIAL",
      },
    ];

    const res = await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: null,
    });

    expect(recorded.columns).toBe(CONVERSATION_CALL_COLUMNS);
    // Tudo que a peça precisa chegou.
    expect(res[0]).toMatchObject({
      id: "call-1",
      direction: "outbound",
      outcome: "connected",
      duration_seconds: 220,
      started_at: "2026-08-02T19:23:23.000Z",
    });
    // E o que ela não precisa não trafega.
    expect(res[0]).not.toHaveProperty("notes");
  });

  /**
   * As três colunas de gravação, uma asserção por coluna.
   *
   * O dublê deste arquivo PROJETA a lista do `.select(...)`, então tirar
   * qualquer uma delas do `CONVERSATION_CALL_COLUMNS` faz a propriedade sumir do
   * resultado e derruba a asserção correspondente. Sem a projeção, o dublê
   * devolveria a linha inteira e o mutante que apaga uma coluna do `.select`
   * passaria verde — que é exatamente o defeito que esta base já pagou uma vez.
   */
  it("traz o ESTADO da gravação — sem ele, url vazia volta a significar três coisas", async () => {
    rows = [{ id: "c", recording_status: "processing", recording_url: null, recording_failure_reason: null }];
    const res = await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: null,
    });
    expect(res[0]).toHaveProperty("recording_status", "processing");
  });

  it("traz o CAMINHO do objeto — é o que o player assina para tocar", async () => {
    rows = [{ id: "c", recording_status: "ready", recording_url: "org-1/c.opus", recording_failure_reason: null }];
    const res = await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: null,
    });
    expect(res[0]).toHaveProperty("recording_url", "org-1/c.opus");
  });

  it("traz a CAUSA da falha — falha sem causa é parede muda", async () => {
    rows = [{ id: "c", recording_status: "failed", recording_url: null, recording_failure_reason: "vps_timeout" }];
    const res = await fetchConversationCalls({
      organizationId: "org-1",
      phoneNumber: "5548996458738",
      leadId: null,
    });
    expect(res[0]).toHaveProperty("recording_failure_reason", "vps_timeout");
  });
});

describe("formatCallDuration", () => {
  it("segundos abaixo de um minuto", () => {
    expect(formatCallDuration(3)).toBe("3s");
    expect(formatCallDuration(45)).toBe("45s");
  });

  it("minutos e segundos", () => {
    expect(formatCallDuration(24)).toBe("24s");
    expect(formatCallDuration(90)).toBe("1min 30s");
    expect(formatCallDuration(220)).toBe("3min 40s");
  });

  it("minuto redondo não mostra segundos", () => {
    expect(formatCallDuration(120)).toBe("2min");
  });

  it("horas", () => {
    expect(formatCallDuration(3600)).toBe("1h");
    expect(formatCallDuration(3900)).toBe("1h 05min");
  });

  it("duração ausente ou zero não vira texto", () => {
    expect(formatCallDuration(null)).toBeNull();
    expect(formatCallDuration(0)).toBeNull();
  });
});

describe("phoneVariants — as formas em que o produtor pode ter gravado", () => {
  it("cobre canônico, com 55, sem o nono dígito, e com 55 sem o nono", () => {
    expect(phoneVariants("48991892653").sort()).toEqual(
      ["4891892653", "48991892653", "554891892653", "5548991892653"].sort(),
    );
  });

  it("não inventa variante sem nono dígito quando não há nono dígito", () => {
    // Fixo de 10 dígitos que `normalizePhone` não transformou em 11.
    expect(phoneVariants("4833334444")).toEqual(["4833334444", "554833334444"]);
  });

  it("descarta forma fora do CHECK de 8 a 15 dígitos", () => {
    for (const v of phoneVariants("48991892653")) {
      expect(v.length).toBeGreaterThanOrEqual(8);
      expect(v.length).toBeLessThanOrEqual(15);
    }
  });

  it("não repete variante", () => {
    const v = phoneVariants("48991892653");
    expect(new Set(v).size).toBe(v.length);
  });
});

describe("isCallConnected", () => {
  it("só 'connected' conta como atendida", () => {
    expect(isCallConnected("connected")).toBe(true);
    for (const o of [
      "no_answer",
      "busy",
      "rejected",
      "canceled",
      "failed",
      "voicemail",
      "wrong_number",
      "callback_scheduled",
    ]) {
      expect(isCallConnected(o)).toBe(false);
    }
  });
});
