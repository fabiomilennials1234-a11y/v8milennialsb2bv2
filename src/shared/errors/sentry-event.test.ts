import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { reportError, setReportIdentity } from "./report";
import {
  exceptionFor,
  fingerprintFor,
  LIBRARY_CHUNKS,
  prepareEvent,
  scrubBreadcrumb,
  scrubRecordingEvent,
  scrubReplayEvent,
  scrubText,
  scrubUrl,
  stripQuery,
  tagsFor,
} from "./sentry-event";
import { toAppError } from "./to-app-error";

const rls = { message: 'new row violates row-level security policy for table "leads"', code: "42501", details: null, hint: null };

function event(partial: Partial<ErrorEvent> = {}): ErrorEvent {
  return { type: undefined, ...partial } as ErrorEvent;
}

afterEach(() => setReportIdentity(null));

describe("stripQuery", () => {
  it("corta query e fragmento — o token do Supabase Auth volta no #", () => {
    expect(stripQuery("https://x.supabase.co/rest/v1/leads?phone=eq.5511987654321")).toBe(
      "https://x.supabase.co/rest/v1/leads",
    );
    expect(stripQuery("https://app/auth/callback#access_token=eyJ.abc")).toBe("https://app/auth/callback");
    expect(stripQuery("/leads")).toBe("/leads");
  });
});

describe("scrubUrl", () => {
  it("token de redefinição de senha mora no path — vira marcador", () => {
    expect(scrubUrl("https://torquecrm.com.br/reset-password/9f2c1ab0deadbeef?x=1")).toBe(
      "https://torquecrm.com.br/reset-password/:token",
    );
  });

  it("objeto do Storage fica só com o bucket — o caminho tem org, lead e nome de arquivo", () => {
    expect(scrubUrl("https://x.supabase.co/storage/v1/object/sign/media/org-1/Contrato Joao.pdf?token=abc")).toBe(
      "https://x.supabase.co/storage/v1/object/sign/media/:path",
    );
    expect(scrubUrl("https://x.supabase.co/storage/v1/object/public/avatars/u1/foto.png")).toBe(
      "https://x.supabase.co/storage/v1/object/public/avatars/:path",
    );
  });
});

describe("scrubText", () => {
  it("URL dentro da mensagem de erro de rede perde query e segredo de path", () => {
    expect(
      scrubText("error sending request for url (https://graph.facebook.com/v19.0/me?access_token=EAAG123): timeout"),
    ).toBe("error sending request for url (https://graph.facebook.com/v19.0/me): timeout");
  });
});

describe("scrubBreadcrumb", () => {
  it("tira query da URL de requisição e mascara telefone", () => {
    const crumb = scrubBreadcrumb({
      category: "fetch",
      data: { method: "GET", url: "https://x.supabase.co/rest/v1/leads?phone=eq.5511987654321", status_code: 403 },
    });
    expect(crumb?.data).toEqual({ method: "GET", url: "https://x.supabase.co/rest/v1/leads", status_code: 403 });
  });

  it("clique perde o rótulo visível (onde mora o nome do lead), mantém a estrutura", () => {
    const crumb = scrubBreadcrumb({
      category: "ui.click",
      message: 'div.card > button.icon[aria-label="Excluir João Silva"][type="button"]',
    });
    expect(crumb?.message).toBe('div.card > button.icon[aria-label][type="button"]');
  });

  it("log de console não sai, de nível nenhum — o build de produção não tira console.*", () => {
    expect(scrubBreadcrumb({ category: "console", level: "log", message: "lead", data: {} })).toBeNull();
    expect(
      scrubBreadcrumb({ category: "console", level: "error", message: "falhou para João Silva", data: {} }),
    ).toBeNull();
  });

  it("navegação sem query e sem o token do reset", () => {
    const crumb = scrubBreadcrumb({ category: "navigation", data: { from: "/leads?q=joao", to: "/reset-password/abc123" } });
    expect(crumb?.data).toEqual({ from: "/leads", to: "/reset-password/:token" });
  });
});

describe("tagsFor", () => {
  it("referência e código do contrato, contexto mascarado e aparado", () => {
    const error = toAppError(rls);
    const tags = tagsFor(error, { source: "mutation", feature: "tel 5511987654321" });
    expect(tags).toMatchObject({ source: "mutation", feature: "tel 5511*****4321", error_code: error.code });
    expect(tags.reference).toBe(error.reference);
  });
});

describe("fingerprintFor", () => {
  it("erro de biblioteca agrupa por código + mensagem sem números — um problema por tabela", () => {
    const a = fingerprintFor(toAppError({ ...rls }), { source: "mutation" });
    const b = fingerprintFor(toAppError({ ...rls }), { source: "mutation" });
    const other = fingerprintFor(
      toAppError({ ...rls, message: 'new row violates row-level security policy for table "deals"' }),
      { source: "mutation" },
    );
    expect(a).toEqual(b);
    expect(a).not.toEqual(other);
  });

  it("números e UUIDs não partem o grupo", () => {
    const one = fingerprintFor(toAppError({ message: "timeout after 3001ms on 550e8400-e29b-41d4-a716-446655440000", code: "57014" }), {});
    const two = fingerprintFor(toAppError({ message: "timeout after 12ms on 660e8400-e29b-41d4-a716-446655440001", code: "57014" }), {});
    expect(one).toEqual(two);
  });

  it("erro de programação usa o agrupamento do Sentry, pela pilha", () => {
    expect(fingerprintFor(toAppError(new TypeError("Cannot read properties of undefined (reading 'id')")), {})).toBeUndefined();
  });
});

describe("exceptionFor", () => {
  it("causa Error vai inteira — pilha real", () => {
    const cause = new TypeError("x is undefined");
    expect(exceptionFor(toAppError(cause))).toBe(cause);
  });

  it("objeto do PostgREST vira Error com o resumo técnico, sem details", () => {
    const exception = exceptionFor(toAppError({ ...rls, details: "Key (phone)=(5511987654321)" }));
    expect(exception).toBeInstanceOf(Error);
    expect(exception.message).toContain("42501");
    expect(exception.message).not.toContain("5511987654321");
  });
});

describe("prepareEvent", () => {
  it("mascara exceção e mensagem, corta a query da página, derruba details/hint do extra", () => {
    const out = prepareEvent(
      event({
        message: "falhou para joao@empresa.com.br",
        exception: { values: [{ type: "Error", value: "duplicate 5511987654321" }] },
        request: { url: "https://app/leads?search=joao", headers: { cookie: "sb=1" }, query_string: "search=joao" },
        extra: {
          __serialized__: { code: "23505", details: "Key (phone)=(5511987654321)", hint: "x", message: "dup" },
          // o que o SDK anexa quando o erro nasce dentro de um listener embrulhado
          arguments: [{ isTrusted: true, data: "J", inputType: "insertText" }],
        },
      }),
      {},
    );
    expect(out?.message).toBe("falhou para j***@empresa.com.br");
    expect(out?.exception?.values?.[0].value).toBe("duplicate 5511*****4321");
    expect(out?.request).toEqual({ url: "https://app/leads" });
    expect(out?.extra).toEqual({ __serialized__: { code: "23505", message: "dup" } });
  });

  it("usuário: só o UUID; organização e papel como tag", () => {
    setReportIdentity({ userId: "u-1", organizationId: "org-1", role: "admin" });
    const out = prepareEvent(event({ user: { id: "u-1", email: "a@b.com", ip_address: "1.2.3.4" } }), {});
    expect(out?.user).toEqual({ id: "u-1", ip_address: null });
    expect(out?.tags).toMatchObject({ organization_id: "org-1", role: "admin" });
  });

  it("não mexe no contexto de trace (ids hex com dígitos)", () => {
    const trace = { trace_id: "12345678901234567890123456789012", span_id: "1234567890123456" };
    const out = prepareEvent(event({ contexts: { trace } }), {});
    expect(out?.contexts?.trace).toEqual(trace);
  });

  it("captura automática de recusa esperada não vira evento", () => {
    const expired = { message: "JWT expired", code: "PGRST301", details: null, hint: null };
    expect(toAppError(expired).reportable).toBe(false);
    expect(prepareEvent(event(), { originalException: expired })).toBeNull();
  });

  it("captura automática do que a tela já relatou é duplicata", () => {
    const cause = { ...rls };
    reportError(toAppError(cause));
    expect(prepareEvent(event(), { originalException: cause })).toBeNull();
  });

  it("evento do nosso reporter passa — ele já decidiu", () => {
    const cause = { ...rls };
    reportError(toAppError(cause));
    expect(prepareEvent(event({ tags: { reference: "ABCD1234" } }), { originalException: cause })).not.toBeNull();
  });

  it("defeito não tratado passa", () => {
    expect(prepareEvent(event(), { originalException: new TypeError("boom") })).not.toBeNull();
  });
});

describe("scrubRecordingEvent", () => {
  it("evento custom do replay (span de rede) perde a query", () => {
    const out = scrubRecordingEvent({
      type: 5,
      timestamp: 1,
      data: { tag: "performanceSpan", payload: { op: "resource.fetch", description: "https://x/rest/v1/leads?phone=eq.5511987654321" } },
    });
    expect(out?.data.payload.description).toBe("https://x/rest/v1/leads");
  });

  it("evento Meta leva o href da página — sem query nem segredo de path", () => {
    const out = scrubRecordingEvent({ type: 4, timestamp: 1, data: { href: "https://app/reset-password/abc?x=1", width: 1, height: 1 } });
    expect(out?.data).toEqual({ href: "https://app/reset-password/:token", width: 1, height: 1 });
  });

  it("clique gravado pelo próprio replay perde o rótulo visível — não passa pelo beforeBreadcrumb", () => {
    const out = scrubRecordingEvent({
      type: 5,
      timestamp: 1,
      data: {
        tag: "breadcrumb",
        payload: { category: "ui.click", message: 'div > button.icon[aria-label="Excluir João Silva"][type="button"]' },
      },
    });
    expect(out?.data.payload.message).toBe('div > button.icon[aria-label][type="button"]');
  });

  it("log de console gravado pelo replay é descartado", () => {
    expect(
      scrubRecordingEvent({ type: 5, timestamp: 1, data: { tag: "breadcrumb", payload: { category: "console", message: "lead" } } }),
    ).toBeNull();
  });

  it("snapshot de DOM passa intocado — já sai mascarado e varrê-lo custaria caro", () => {
    const snapshot = { type: 2, timestamp: 1, data: { node: { text: "5511987654321" } } };
    expect(scrubRecordingEvent(snapshot)).toBe(snapshot);
  });
});

describe("scrubReplayEvent", () => {
  it("lista de URLs visitadas e URL da página do replay_event saem limpas", () => {
    const out = scrubReplayEvent({
      type: "replay_event",
      urls: ["https://app/leads?search=joao", "https://app/reset-password/abc"],
      request: { url: "https://app/chat?phone=5511987654321" },
    });
    expect(out.urls).toEqual(["https://app/leads", "https://app/reset-password/:token"]);
    expect(out.request).toEqual({ url: "https://app/chat" });
  });

  it("evento que não é de replay passa intocado (o beforeSend cuida dele)", () => {
    const event = { type: undefined, urls: ["https://app/x?y=1"] };
    expect(scrubReplayEvent(event)).toEqual({ type: undefined, urls: ["https://app/x?y=1"] });
  });
});

/**
 * Todo problema do front tinha o mesmo culpado, `ef(assets/sentry-…)` — o
 * reporter. Os quadros abaixo são os do TORQUE-WEB-9 em produção.
 */
describe("prepareEvent — culpado", () => {
  const ORIGIN = "https://torquecrm.com.br";
  const frame = (file: string, fn: string) => ({ filename: `${ORIGIN}/assets/${file}`, abs_path: `${ORIGIN}/assets/${file}`, function: fn, in_app: true });

  function reported(tags: Record<string, string>, url: string) {
    return event({
      tags: { reference: "52213C06", ...tags },
      request: { url },
      exception: {
        values: [{
          type: "AppError",
          value: "validation.invalid · 22P02",
          stacktrace: {
            frames: [
              frame("ChatWhatsApp-CGA5zn1_.js", "moveStage"),
              frame("query-kznv8RwB.js", "We.execute"),
              frame("index-O3e3aBH8.js", "Object.onError"),
              frame("sentry-Dxg-HdwQ.js", "In"),
              frame("sentry-Dxg-HdwQ.js", "ef"),
            ],
          },
        }],
      },
    });
  }

  it("quadros de biblioteca e do reporter saem do app; o código da tela fica", () => {
    const out = prepareEvent(reported({ source: "mutation", mutation: "anonymous" }, `${ORIGIN}/chat-whatsapp`), {})!;
    const inApp = out.exception!.values![0].stacktrace!.frames!.map((f) => [f.function, f.in_app]);
    expect(inApp).toEqual([
      ["moveStage", true],
      ["We.execute", false],
      ["Object.onError", true],
      ["In", false],
      ["ef", false],
    ]);
  });

  it("source map no ar: node_modules e src/shared/errors também saem", () => {
    const e = event({
      tags: { reference: "X" },
      exception: { values: [{ stacktrace: { frames: [
        { filename: "webpack:///node_modules/@tanstack/query-core/build/modern/mutation.js", in_app: true },
        { abs_path: "app:///src/shared/errors/report.ts", in_app: true },
        { abs_path: "app:///src/modules/leads/hooks/lead/useLeadPipeHandlers.ts", in_app: true },
      ] } }] },
    });
    const frames = prepareEvent(e, {})!.exception!.values![0].stacktrace!.frames!;
    expect(frames.map((f) => f.in_app)).toEqual([false, false, true]);
  });

  it("culpado = tela + operação, sem id nem query", () => {
    const query = prepareEvent(reported({ source: "query", query: "leads-count" }, `${ORIGIN}/funil/confirmacao?lead=5511987654321`), {})!;
    expect(query.transaction).toBe("/funil/confirmacao · query leads-count");

    const mutation = prepareEvent(
      reported({ source: "mutation", mutation: "anonymous" }, `${ORIGIN}/leads/660e8400-e29b-41d4-a716-446655440001/negocios/42`),
      {},
    )!;
    expect(mutation.transaction).toBe("/leads/:id/negocios/:n · mutation");
  });

  it("erro não tratado tem pilha real — o culpado fica com o Sentry", () => {
    const out = prepareEvent(event({ request: { url: `${ORIGIN}/chat-whatsapp` } }), { originalException: new TypeError("x is undefined") })!;
    expect(out.transaction).toBeUndefined();
  });

  it("a lista de chunks de biblioteca acompanha o manualChunks do vite.config", () => {
    const config = readFileSync(resolve(__dirname, "../../../vite.config.ts"), "utf8");
    const block = config.slice(config.indexOf("manualChunks: {"), config.indexOf("},", config.indexOf("manualChunks: {")));
    const chunks = [...block.matchAll(/^\s*'?([\w-]+)'?\s*:\s*\[/gm)].map((m) => m[1]);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(LIBRARY_CHUNKS).toContain(chunk);
  });
});
