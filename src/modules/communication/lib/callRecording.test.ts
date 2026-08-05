/**
 * A leitura das colunas de gravação, e o pedido da URL assinada.
 *
 * ── A regra que estes testes travam ──
 * Quatro casos, e nenhum vira outro. Ausência (não houve gravação) e falha (não
 * vai haver, e há um porquê) são os dois que a S2 gastou uma coluna inteira para
 * separar; colapsá-los aqui desfaria a fatia anterior de dentro da tela.
 *
 * ── Sobre o dublê deste arquivo ──
 * Ele devolve o que o storage devolveria e NADA MAIS: a URL sai derivada do
 * caminho pedido, então trocar o caminho na chamada muda o resultado e o teste
 * cai. Um dublê que devolvesse uma URL fixa deixaria passar o mutante que assina
 * o objeto errado — e o objeto errado, neste bucket, é a conversa de outra
 * pessoa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Assinatura {
  bucket: string | null;
  path: string | null;
  ttl: number | null;
}

const assinatura: Assinatura = { bucket: null, path: null, ttl: null };
let resposta: { data: unknown; error: unknown } = { data: null, error: null };
let lancar: unknown = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => {
        assinatura.bucket = bucket;
        return {
          createSignedUrl: async (path: string, ttl: number) => {
            assinatura.path = path;
            assinatura.ttl = ttl;
            if (lancar) throw lancar;
            // Derivada do caminho: assinar o objeto errado muda o resultado.
            if (resposta.data === "DERIVAR") {
              return { data: { signedUrl: `https://storage.test/${path}?token=abc` }, error: null };
            }
            return resposta;
          },
        };
      },
    },
  },
}));

import {
  CALL_RECORDINGS_BUCKET,
  RECORDING_URL_TTL_SECONDS,
  callRecordingState,
  clock,
  recordingFailureLabel,
  resolveCallRecordingUrl,
} from "./callRecording";

beforeEach(() => {
  assinatura.bucket = null;
  assinatura.path = null;
  assinatura.ttl = null;
  resposta = { data: "DERIVAR", error: null };
  lancar = null;
});

describe("callRecordingState — os quatro casos", () => {
  it("estado nulo é AUSÊNCIA: não houve gravação", () => {
    expect(callRecordingState({ recording_status: null })).toEqual({ kind: "none" });
    expect(callRecordingState({})).toEqual({ kind: "none" });
  });

  it("processando é ESPERE, e não se confunde com ausência", () => {
    const s = callRecordingState({ recording_status: "processing", recording_url: null });
    expect(s.kind).toBe("processing");
    expect(s.kind).not.toBe("none");
  });

  it("pronta carrega o caminho do objeto", () => {
    expect(callRecordingState({ recording_status: "ready", recording_url: "org/call.opus" })).toEqual({
      kind: "ready",
      path: "org/call.opus",
    });
  });

  it("falhou carrega a causa, e NÃO vira ausência", () => {
    const s = callRecordingState({
      recording_status: "failed",
      recording_url: null,
      recording_failure_reason: "vps_timeout",
    });
    expect(s).toEqual({ kind: "failed", reason: "vps_timeout" });
    expect(s.kind).not.toBe("none");
  });

  it("falha sem causa continua sendo falha", () => {
    expect(callRecordingState({ recording_status: "failed", recording_failure_reason: null })).toEqual({
      kind: "failed",
      reason: null,
    });
    expect(callRecordingState({ recording_status: "failed", recording_failure_reason: "   " })).toEqual({
      kind: "failed",
      reason: null,
    });
  });

  it("`ready` sem caminho não promete o que não pode cumprir — nem acusa falha", () => {
    // O banco escreve estado e endereço na mesma transação, então isto não
    // deveria acontecer. Se acontecer: `ready` sem path daria um player mudo, e
    // `failed` seria acusação falsa.
    const s = callRecordingState({ recording_status: "ready", recording_url: null });
    expect(s.kind).toBe("processing");

    const vazio = callRecordingState({ recording_status: "ready", recording_url: "   " });
    expect(vazio.kind).toBe("processing");
  });

  it("estado que o banco inventar degrada para ESPERE, nunca para ausência", () => {
    const s = callRecordingState({ recording_status: "quarantined_pelo_futuro" });
    expect(s.kind).toBe("processing");
    expect(s.kind).not.toBe("none");
  });
});

describe("recordingFailureLabel — a causa dita a um vendedor", () => {
  it("nunca devolve o slug cru", () => {
    for (const slug of [
      "vps_timeout",
      "vps_unreachable",
      "vps_http_502",
      "token_unavailable",
      "too_large",
      "not_ogg",
      "truncated_body",
      "empty_body",
      "storage_upload_failed",
      "db_write_failed",
      "db_call_not_found",
      "unexpected_error",
      "unknown",
    ]) {
      expect(recordingFailureLabel(slug)).not.toContain(slug);
    }
  });

  it("separa as famílias que mudam o que o gestor faz a seguir", () => {
    expect(recordingFailureLabel("vps_timeout")).toBe("A gravação não chegou da telefonia.");
    expect(recordingFailureLabel("vps_http_502")).toBe("A gravação não chegou da telefonia.");
    expect(recordingFailureLabel("storage_upload_failed")).toBe(
      "A gravação chegou, mas não foi possível guardá-la.",
    );
    expect(recordingFailureLabel("db_write_failed")).toBe(
      "A gravação chegou, mas não foi possível guardá-la.",
    );
    expect(recordingFailureLabel("too_large")).toBe("A gravação passou do tamanho aceito.");
    expect(recordingFailureLabel("not_ogg")).toBe("O arquivo da gravação chegou corrompido.");
  });

  it("motivo que a VPS inventar ainda produz uma frase verdadeira", () => {
    expect(recordingFailureLabel("encoder_exploded_2026")).toBe("A gravação falhou.");
    expect(recordingFailureLabel(null)).toBe("A gravação falhou.");
    expect(recordingFailureLabel("")).toBe("A gravação falhou.");
  });

  it("nunca escreve `undefined` na cara do vendedor", () => {
    for (const r of [null, "", "   ", "coisa_nova"]) {
      expect(recordingFailureLabel(r)).not.toMatch(/undefined/i);
    }
  });
});

describe("clock — relógio de transporte", () => {
  it("segundos e minutos", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7)).toBe("0:07");
    expect(clock(72)).toBe("1:12");
    expect(clock(220)).toBe("3:40");
  });

  it("horas ganham minutos com dois dígitos", () => {
    expect(clock(3600)).toBe("1:00:00");
    expect(clock(3870)).toBe("1:04:30");
  });

  it("valor impossível não escreve NaN na tela", () => {
    expect(clock(Number.NaN)).toBe("0:00");
    expect(clock(-5)).toBe("0:00");
    expect(clock(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("resolveCallRecordingUrl", () => {
  it("assina o objeto PEDIDO, no bucket privado da gravação", async () => {
    const res = await resolveCallRecordingUrl("org-a/call-1.opus");

    expect(assinatura.bucket).toBe(CALL_RECORDINGS_BUCKET);
    expect(assinatura.bucket).toBe("call-recordings");
    expect(assinatura.path).toBe("org-a/call-1.opus");
    expect(res).toEqual({ ok: true, url: "https://storage.test/org-a/call-1.opus?token=abc" });
  });

  it("assina por tempo limitado — a URL é um portador", async () => {
    await resolveCallRecordingUrl("org-a/call-1.opus");
    expect(assinatura.ttl).toBe(RECORDING_URL_TTL_SECONDS);
    // Cobre uma ligação inteira sem virar acesso durável a um link vazado.
    expect(assinatura.ttl).toBeGreaterThanOrEqual(5 * 60);
    expect(assinatura.ttl).toBeLessThanOrEqual(60 * 60);
  });

  it("recusa do banco (4xx) vira RECUSA, não erro genérico", async () => {
    for (const status of [400, 403, 404]) {
      resposta = { data: null, error: { status, message: "Object not found" } };
      const res = await resolveCallRecordingUrl("org-b/alheia.opus");
      expect(res).toEqual({ ok: false, kind: "denied" });
    }
  });

  it("`statusCode` como string também é lido — o storage manda das duas formas", async () => {
    resposta = { data: null, error: { statusCode: "404", message: "Object not found" } };
    expect(await resolveCallRecordingUrl("org-b/alheia.opus")).toEqual({ ok: false, kind: "denied" });
  });

  it("problema de servidor NÃO vira recusa — recusa é definitiva, isto se tenta de novo", async () => {
    resposta = { data: null, error: { status: 500, message: "boom" } };
    expect(await resolveCallRecordingUrl("org-a/call-1.opus")).toEqual({ ok: false, kind: "unavailable" });
  });

  it("rede caída não vira recusa", async () => {
    lancar = new TypeError("Failed to fetch");
    expect(await resolveCallRecordingUrl("org-a/call-1.opus")).toEqual({ ok: false, kind: "unavailable" });
  });

  it("resposta sem URL não é sucesso mudo", async () => {
    resposta = { data: { signedUrl: "" }, error: null };
    expect(await resolveCallRecordingUrl("org-a/call-1.opus")).toEqual({ ok: false, kind: "unavailable" });
  });

  it("caminho vazio não chega a bater no storage", async () => {
    expect(await resolveCallRecordingUrl("   ")).toEqual({ ok: false, kind: "unavailable" });
    expect(assinatura.path).toBeNull();
  });
});
