import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } },
}));

import {
  createVoiceSession,
  requestStreamToken,
  VOICE_CONTROL_MESSAGES,
  VoiceControlError,
} from "./torquecallsApi";

beforeEach(() => invoke.mockReset());

/**
 * Reproduz o shape REAL do `@supabase/functions-js` — não o que é conveniente
 * de mockar. Quando a edge function responde com status de erro, o client
 * devolve `data: null` e põe a resposta HTTP crua, ainda não lida, em
 * `error.context`. Um mock `{ data: { code }, error: {...} }` (o do round
 * anterior) NUNCA pegaria esse bug: `data` é sempre `null` nesse caminho, e o
 * teste passava lendo um shape que o client de verdade nunca produz.
 */
function httpErrorInvokeResult(status: number, body: Record<string, unknown>) {
  return {
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify(body), { status }),
    },
  };
}

describe("createVoiceSession", () => {
  it("manda a instância e devolve o id da sessão", async () => {
    invoke.mockResolvedValue({ data: { tc_session_id: "tc-1" }, error: null });
    const out = await createVoiceSession({ whatsappInstanceId: "inst-1" });
    expect(out).toEqual({ tcSessionId: "tc-1" });
    expect(invoke).toHaveBeenCalledWith("torquecalls-control", {
      body: { action: "createSession", whatsapp_instance_id: "inst-1", name: "TorqueCalls" },
    });
  });

  // Asserir só `{ code }` era um verde falso: passava igual com a mensagem
  // crua do servidor no lugar da traduzida, que é exatamente o defeito que
  // deixava `VOICE_CONTROL_MESSAGES` inteira sem uso. A asserção que vale é a
  // MENSAGEM — como o teste de `signal()` mais abaixo já fazia.
  it("traduz o código do erro em vez de vazar o cru", async () => {
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, { error: "Limite atingido", code: "session_cap_reached" }),
    );
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toMatchObject({
        code: "session_cap_reached",
        message: VOICE_CONTROL_MESSAGES.session_cap_reached,
      });
  });

  // O servidor SEMPRE manda `error` no corpo, então "texto do servidor vence"
  // significava "tabela nunca usada". Aqui o texto do servidor é o pior caso
  // real: jargão interno que o cliente não tem como interpretar.
  it("a tabela vence o texto do servidor — jargão de servidor não chega ao cliente", async () => {
    invoke.mockResolvedValue(
      httpErrorInvokeResult(500, {
        error: "Sessão criada na VPS mas não registrada no CRM",
        code: "session_orphaned",
      }),
    );
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toMatchObject({
        code: "session_orphaned",
        message: VOICE_CONTROL_MESSAGES.session_orphaned,
      });
  });

  // Precedência invertida não pode virar mordaça: para código que a tabela não
  // conhece, o texto do servidor ainda é a melhor informação disponível.
  it("código desconhecido cai no texto do servidor, não numa genérica", async () => {
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, {
        error: "Este WhatsApp já tem 4 aparelhos conectados.",
        code: "device_limit_reached",
      }),
    );
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toMatchObject({
        code: "device_limit_reached",
        message: "Este WhatsApp já tem 4 aparelhos conectados.",
      });
  });

  // Sem código E sem texto sobra só a genérica — mas ela é o último recurso,
  // não o primeiro.
  it("sem code e sem texto, a genérica", async () => {
    invoke.mockResolvedValue(httpErrorInvokeResult(500, {}));
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toMatchObject({
        code: "unknown",
        message: "Não foi possível concluir a operação.",
      });
  });

  it("é uma VoiceControlError de verdade, não um Error genérico", async () => {
    invoke.mockResolvedValue(
      httpErrorInvokeResult(403, { error: "Sem voz no plano", code: "voice_feature_off" }),
    );
    await expect(createVoiceSession({ whatsappInstanceId: "inst-1" }))
      .rejects.toBeInstanceOf(VoiceControlError);
  });

  it("pairVoiceSession reusa a sessão em vez de criar outra", async () => {
    invoke.mockResolvedValue({ data: {}, error: null });
    const { pairVoiceSession } = await import("./torquecallsApi");
    await pairVoiceSession({ tcSessionId: "tc-1" });
    expect(invoke).toHaveBeenCalledWith("torquecalls-control", {
      body: { action: "pairSession", tc_session_id: "tc-1" },
    });
  });
});

describe("requestStreamToken", () => {
  it("só pede o QR quando pair é explícito", async () => {
    invoke.mockResolvedValue({ data: { token: "t", expires_at: 1, renew_in_ms: 1, vps_url: "u" }, error: null });
    await requestStreamToken({ tcSessionId: "tc-1" });
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("pair");

    invoke.mockClear();
    await requestStreamToken({ tcSessionId: "tc-1", pair: true });
    expect(invoke.mock.calls[0][1].body).toMatchObject({ pair: true });
  });
});

// Regressão ao vivo: `resolveCaller` (`_shared/voip/caller.ts`) recusa master
// sem `organization_id` explícito com 400 "Master must provide
// organization_id" — master não pertence a uma organização só, e o servidor
// não tem como adivinhar qual. Antes deste conserto NENHUMA função do plano
// (control OU signal) mandava o campo, então nenhum master conseguia ativar
// voz pela tela. Os dois planos são cobertos aqui porque são dois clientes
// HTTP diferentes (`torquecalls-control` e `torquecalls-signal`) — consertar
// um e esquecer o outro deixaria metade do fluxo (ex.: parear funciona, mas
// ligar continua 400) quebrada do mesmo jeito.
describe("organization_id — o campo que master precisa e admin comum não", () => {
  it("createVoiceSession (control) manda organization_id quando fornecido", async () => {
    invoke.mockResolvedValue({ data: { tc_session_id: "tc-1" }, error: null });
    await createVoiceSession({ whatsappInstanceId: "inst-1", organizationId: "org-9" });
    expect(invoke.mock.calls[0][1].body).toMatchObject({ organization_id: "org-9" });
  });

  it("createVoiceSession (control) NÃO carrega a chave sem organizationId — admin comum não pode regredir", async () => {
    invoke.mockResolvedValue({ data: { tc_session_id: "tc-1" }, error: null });
    await createVoiceSession({ whatsappInstanceId: "inst-1" });
    // `toHaveBeenCalledWith`/`toMatchObject` ignoram chave com valor
    // `undefined` — não provariam nada aqui. A prova real é a chave AUSENTE
    // do objeto, não só um valor vazio.
    expect(Object.keys(invoke.mock.calls[0][1].body)).not.toContain("organization_id");
  });

  it("startCall (signal) manda organization_id quando fornecido", async () => {
    const { startCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue({
      data: { call_id: "c1", tc_call_id: "t1", peer: "554891005289", media: "m", ctl: "c", vps_url: "u" },
      error: null,
    });
    await startCall({ tcSessionId: "tc-1", leadId: "lead-1", organizationId: "org-9" });
    expect(invoke.mock.calls[0][1].body).toMatchObject({ organization_id: "org-9" });
  });

  it("startCall (signal) NÃO carrega a chave sem organizationId", async () => {
    const { startCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue({
      data: { call_id: "c1", tc_call_id: "t1", peer: "554891005289", media: "m", ctl: "c", vps_url: "u" },
      error: null,
    });
    await startCall({ tcSessionId: "tc-1", leadId: "lead-1" });
    expect(Object.keys(invoke.mock.calls[0][1].body)).not.toContain("organization_id");
  });
});

describe("VOICE_CONTROL_MESSAGES", () => {
  it("cobre todos os códigos que a tela pode receber hoje", () => {
    for (const code of ["voice_feature_off", "session_cap_reached", "session_orphaned"]) {
      expect(VOICE_CONTROL_MESSAGES[code]).toBeTruthy();
    }
  });

  // Não é esquecimento: nenhum caminho hoje produz "device_limit_reached" (ver
  // o comentário acima da tabela em torquecallsApi.ts). Um teste "cobre todos
  // os códigos" que incluísse essa chave provaria só que a tabela TEM a
  // chave — não que algum código real a alcança. Foi exatamente esse tipo de
  // falso-verde que deixou passar o defeito do round anterior.
  it("NÃO promete tradução para device_limit_reached — nenhum código chega até ela hoje", () => {
    expect(VOICE_CONTROL_MESSAGES.device_limit_reached).toBeUndefined();
  });
});

// O `signal()` (plano `torquecalls-signal`, usado por startCall/endCall/
// requestStreamToken) tinha o MESMO defeito: lia `error.context.body`, que é
// o próprio `Response`, e `Response.body` é um ReadableStream — nunca um
// `{ code }`. `CallDeniedError` nunca nascia de uma recusa HTTP de verdade.
describe("signal() — mesma fronteira de invoke, mesmo conserto", () => {
  it("CallDeniedError sai de uma recusa HTTP com code, via startCall", async () => {
    const { startCall, CallDeniedError } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, { error: "Você já está em uma chamada.", code: "operator_busy" }),
    );
    await expect(startCall({ tcSessionId: "tc-1", leadId: "lead-1" }))
      .rejects.toBeInstanceOf(CallDeniedError);
  });

  it("a mensagem traduzida chega, não o fallback genérico", async () => {
    const { startCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, { error: "cru", code: "operator_busy" }),
    );
    await expect(startCall({ tcSessionId: "tc-1", leadId: "lead-1" }))
      .rejects.toMatchObject({ code: "operator_busy", message: "Você já está em uma chamada." });
  });
});

/**
 * Issue #1365 — a recusa que escondia a causa.
 *
 * Produção, 2026-08-03: a VPS respondeu 404 com
 * `"51985960716: number is not on WhatsApp"`, a edge function repassava
 * `code: "vps_refused"` e o vendedor lia *"O serviço de chamadas recusou a
 * ligação"*. Ele não tem o que fazer com essa frase; a causa, essa sim, ele
 * resolve — corrige o telefone no cadastro.
 *
 * O que estes testes guardam é a MENSAGEM, não o código. Asserir só o código
 * passaria igual com a tabela de tradução vazia, que é o defeito original.
 */
describe("startCall — a causa da recusa chega ao vendedor (#1365)", () => {
  it("número sem WhatsApp diz o que fazer, não 'o serviço recusou'", async () => {
    const { startCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(404, {
        error: "5551985960716: number is not on WhatsApp",
        code: "peer_not_on_whatsapp",
      }),
    );

    await expect(startCall({ tcSessionId: "tc-1", leadId: "lead-1" }))
      .rejects.toMatchObject({
        code: "peer_not_on_whatsapp",
        message: "Este número não tem WhatsApp. Confira o telefone no cadastro do lead.",
      });
  });

  it("a frase genérica NÃO é mais o que este caso produz", async () => {
    const { startCall, CALL_DENY_MESSAGES } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(404, {
        error: "5551985960716: number is not on WhatsApp",
        code: "peer_not_on_whatsapp",
      }),
    );

    const erro = await startCall({ tcSessionId: "tc-1", leadId: "lead-1" }).catch((e) => e);
    expect(erro.message).not.toBe(CALL_DENY_MESSAGES.vps_refused);
  });

  // A prosa da VPS é texto de terceiro, em inglês, escrito para operador de
  // infraestrutura. Ela serve ao log; nunca à tela do vendedor.
  it("a prosa em inglês da VPS não vaza para a tela", async () => {
    const { startCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(404, {
        error: "5551985960716: number is not on WhatsApp",
        code: "peer_not_on_whatsapp",
      }),
    );

    const erro = await startCall({ tcSessionId: "tc-1", leadId: "lead-1" }).catch((e) => e);
    expect(erro.message).not.toContain("not on WhatsApp");
    expect(erro.message).not.toContain("5551985960716");
  });

  // Cada código novo tem que ter frase. Um código sem entrada cai no fallback
  // "Não foi possível completar a chamada." — que é o defeito de volta, com
  // outro nome.
  it("todo código de recusa da VPS tem tradução própria", async () => {
    const { CALL_DENY_MESSAGES } = await import("./torquecallsApi");

    for (
      const code of [
        "peer_not_on_whatsapp",
        "whatsapp_unreachable",
        "session_not_paired",
        "vps_unreachable",
        "invalid_peer",
        "operator_busy",
        "org_concurrency_reached",
        "vps_refused",
      ]
    ) {
      expect(CALL_DENY_MESSAGES[code], `sem frase para ${code}`).toBeTruthy();
    }
  });

  // E as frases têm que ser distintas entre si: duas causas com o mesmo texto
  // são, para quem lê, uma causa só — que é exatamente o estado anterior.
  it("as causas da VPS não compartilham a mesma frase", async () => {
    const { CALL_DENY_MESSAGES } = await import("./torquecallsApi");

    const frases = [
      "peer_not_on_whatsapp",
      "whatsapp_unreachable",
      "session_not_paired",
      "vps_unreachable",
      "vps_refused",
    ].map((c) => CALL_DENY_MESSAGES[c]);

    expect(new Set(frases).size).toBe(frases.length);
  });
});

/**
 * Desligar o que já acabou é sucesso, não erro.
 *
 * Defeito vivido em produção (2026-07-30): o outro lado desligava, o operador
 * clicava em Desligar e a tela ficava em "Encerrando…". Quem já não existe não
 * pode ser encerrado de novo — e transformar isso em exceção obriga todo
 * chamador a um `catch` cego, que engole junto os erros que IMPORTAM (rede
 * caída, permissão negada). A distinção mora aqui, uma vez.
 */
describe("endCall — encerrar chamada que já não existe", () => {
  it("não lança quando a chamada não é encontrada (404)", async () => {
    const { endCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(404, { error: "Chamada não encontrada", code: "call_not_found" }),
    );
    await expect(endCall({ tcSessionId: "tc-1", callId: "call-1" })).resolves.toBeUndefined();
  });

  it("não lança quando a chamada já estava encerrada (409 call_ended)", async () => {
    const { endCall } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(409, { error: "call_ended", code: "call_ended" }),
    );
    await expect(endCall({ tcSessionId: "tc-1", callId: "call-1" })).resolves.toBeUndefined();
  });

  // O contraponto que impede o conserto de virar um `catch {}` disfarçado: uma
  // recusa que o operador PODE resolver continua chegando até ele.
  it("continua lançando no que não é 'já acabou'", async () => {
    const { endCall, CallDeniedError } = await import("./torquecallsApi");
    invoke.mockResolvedValue(
      httpErrorInvokeResult(403, { error: "Chamada de outro operador", code: "not_operator" }),
    );
    await expect(endCall({ tcSessionId: "tc-1", callId: "call-1" }))
      .rejects.toBeInstanceOf(CallDeniedError);
  });
});
