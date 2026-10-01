import { describe, expect, it } from "vitest";
import { DEFAULT_FALLBACK, isHumanPortugueseMessage, toAppError, userMessageOf } from "./to-app-error";
import { unwrapFunctionsError } from "./unwrap-functions-error";

/** Formato real de `{ data, error }` do postgrest-js: objeto simples, não `Error`. */
function pg(code: string, message: string, details: string | null = null) {
  return { code, message, details, hint: null };
}

function functionsHttpError(status: number, body: unknown) {
  const response = new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const error = new Error("Edge Function returned a non-2xx status code") as Error & { context: Response };
  error.name = "FunctionsHttpError";
  error.context = response;
  return error;
}

function authError(name: string, code: string | undefined, status = 400) {
  const error = new Error("auth failure") as Error & Record<string, unknown>;
  error.name = name;
  error.__isAuthError = true;
  error.code = code;
  error.status = status;
  return error;
}

const FALLBACK = "Não foi possível salvar o lead.";

describe("toAppError — classificação", () => {
  it.each([
    [pg("42501", "new row violates row-level security policy for table \"leads\""), "permission.denied"],
    [pg("42501", "access_denied"), "permission.denied"],
    [pg("P0001", "forbidden: org not accessible"), "permission.denied"],
    [pg("PGRST301", "JWT expired"), "auth.session_expired"],
    [pg("PGRST116", "JSON object requested, multiple (or no) rows returned"), "record.not_found"],
    [pg("PT422", "reference_unavailable"), "record.not_found"],
    [pg("PT404", "context_unavailable"), "record.not_found"],
    [pg("23505", "duplicate key value violates unique constraint \"leads_phone_key\""), "record.duplicate"],
    [pg("23503", "update or delete on table \"pipelines\" violates foreign key constraint"), "record.in_use"],
    [pg("23503", "insert or update on table \"leads\" violates foreign key constraint"), "record.not_found"],
    [pg("23514", "new row for relation \"leads\" violates check constraint"), "validation.invalid"],
    [pg("22023", "invalid_scope"), "validation.invalid"],
    [pg("PT409", "draft_revision_conflict"), "conflict.stale"],
    [pg("57014", "canceling statement due to statement timeout"), "request.timeout"],
    [pg("", "TypeError: Failed to fetch"), "network.offline"],
    [pg("42703", "column \"sold_at\" does not exist"), "unknown"],
  ])("%j → %s", (error, code) => {
    expect(toAppError(error, FALLBACK).code).toBe(code);
  });

  it.each([
    [400, "validation.invalid"],
    [401, "auth.session_expired"],
    [403, "permission.denied"],
    [404, "record.not_found"],
    [409, "conflict.stale"],
    [429, "rate.limited"],
    [500, "server.unavailable"],
    [503, "server.unavailable"],
  ])("FunctionsHttpError %i → %s (sem ler o corpo)", (status, code) => {
    expect(toAppError(functionsHttpError(status, {}), FALLBACK).code).toBe(code);
  });

  it("FunctionsFetchError e FunctionsRelayError", () => {
    const fetchError = Object.assign(new Error("Failed to send a request"), { name: "FunctionsFetchError" });
    const relayError = Object.assign(new Error("Relay Error"), { name: "FunctionsRelayError" });
    expect(toAppError(fetchError).code).toBe("network.offline");
    expect(toAppError(relayError).code).toBe("server.unavailable");
  });

  it.each([
    ["invalid_credentials", "auth.invalid_credentials"],
    ["email_not_confirmed", "auth.email_not_confirmed"],
    ["weak_password", "auth.weak_password"],
    ["user_already_exists", "auth.user_exists"],
    ["refresh_token_not_found", "auth.session_expired"],
    ["over_request_rate_limit", "rate.limited"],
  ])("AuthApiError %s → %s", (authCode, code) => {
    expect(toAppError(authError("AuthApiError", authCode)).code).toBe(code);
  });

  it("AuthSessionMissingError e AuthRetryableFetchError", () => {
    expect(toAppError(authError("AuthSessionMissingError", undefined)).code).toBe("auth.session_expired");
    expect(toAppError(authError("AuthRetryableFetchError", undefined, 0)).code).toBe("network.offline");
  });

  it("AbortError → request.timeout", () => {
    const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(toAppError(abort).code).toBe("request.timeout");
  });
});

describe("toAppError — mensagem para o usuário", () => {
  it("usa o catálogo quando o código é conhecido", () => {
    const error = toAppError(pg("23505", "duplicate key value violates unique constraint"), FALLBACK);
    expect(error.userMessage).toBe("Já existe um registro com esses dados.");
  });

  it("usa o fallback do chamador quando o código é desconhecido", () => {
    const error = toAppError(pg("42703", "column \"sold_at\" does not exist"), FALLBACK);
    expect(error.userMessage).toBe(FALLBACK);
    expect(error.action?.kind).toBe("support");
  });

  it("mostra a recusa humana em PT que a RPC escreveu", () => {
    const error = toAppError(pg("P0001", "Acesso negado: apenas usuarios master podem executar esta acao"), FALLBACK);
    expect(error.userMessage).toBe("Acesso negado: apenas usuarios master podem executar esta acao");
  });

  it("tira da frase o id entre parênteses, que não diz nada ao cliente", () => {
    const error = toAppError(
      pg("P0001", "Comprador incompleto: nome, e-mail e documento fiscal andam juntos (link 3f2a0c1e-9b7d-4c2a-8f11-2b6e5d4c3a10)"),
      FALLBACK,
    );
    expect(error.userMessage).toBe("Comprador incompleto: nome, e-mail e documento fiscal andam juntos");
  });

  it("tira o prefixo de máquina e mostra a frase PT, mantendo a classificação", () => {
    const error = toAppError(pg("42501", "forbidden: apenas admin da organização ajusta estas configurações"), FALLBACK);
    expect(error.code).toBe("permission.denied");
    expect(error.userMessage).toBe("Apenas admin da organização ajusta estas configurações");
  });

  it("prefixo de máquina com cauda técnica continua técnico", () => {
    const error = toAppError(pg("P0001", "query_too_short: minimum 3 characters required"), FALLBACK);
    expect(error.code).toBe("validation.invalid");
    expect(error.userMessage).toBe("Algum dado enviado não é válido. Revise e tente de novo.");
  });

  it("junta o hint PT do banco à frase principal", () => {
    const error = toAppError(
      { code: "P0001", message: "Negócio ganho sem valor de venda.", details: null, hint: "Abra o card e preencha o valor da venda." },
      FALLBACK,
    );
    expect(error.userMessage).toBe("Negócio ganho sem valor de venda. Abra o card e preencha o valor da venda.");
  });

  it("hint PT sozinho quando a frase principal é técnica", () => {
    const error = toAppError(
      { code: "22P02", message: "invalid input syntax for type numeric", details: null, hint: "Use apenas números, com ponto como separador decimal." },
      FALLBACK,
    );
    expect(error.userMessage).toBe("Use apenas números, com ponto como separador decimal.");
  });

  it("mostra a frase PT de um Error lançado pelo próprio app", () => {
    expect(toAppError(new Error("Selecione uma etapa antes de salvar."), FALLBACK).userMessage).toBe(
      "Selecione uma etapa antes de salvar.",
    );
  });

  it.each([null, undefined, "", "   ", {}, "Erro desconhecido", "[object Object]"])(
    "ausência de informação (%j) cai no fallback",
    (input) => {
      expect(toAppError(input, FALLBACK).userMessage).toBe(FALLBACK);
    },
  );

  it("fallback vazio vira o padrão", () => {
    expect(toAppError({}, "  ").userMessage).toBe(DEFAULT_FALLBACK);
  });

  it("sessão vencida oferece entrar de novo", () => {
    expect(toAppError(pg("PGRST303", "JWT expired")).action?.kind).toBe("sign_in");
  });

  it("nunca vaza texto técnico, para nenhuma entrada", () => {
    const inputs: unknown[] = [
      pg("42501", "new row violates row-level security policy for table \"organizations\""),
      pg("23502", "null value in column \"name\" of relation \"leads\" violates not-null constraint"),
      pg("42883", "function public.foo(uuid) does not exist"),
      pg("PGRST204", "Could not find the 'sold_at' column of 'deals' in the schema cache"),
      pg("P0001", "sale_events é append-only (ADR-0017): UPDATE proibido — corrija com evento novo"),
      pg("P0001", "metric_period_bounds: organization % not found"),
      pg("P0001", "query_too_short: minimum 3 characters required"),
      new Error("Cannot read properties of undefined (reading 'map')"),
      new TypeError("Failed to fetch"),
      "Edge Function returned a non-2xx status code",
      { message: "Permission denied", code: "P0001", details: null, hint: null },
    ];
    const forbidden = /violates|policy|PGRST|null value|relation|schema|undefined|append-only|ADR-|_|Failed to fetch|non-2xx|Permission denied|\(\w{5}\)/;
    for (const input of inputs) {
      expect(toAppError(input, FALLBACK).userMessage).not.toMatch(forbidden);
    }
  });
});

describe("toAppError — o que vira relatório", () => {
  it("RLS cru do Postgres é defeito e vira evento", () => {
    expect(toAppError(pg("42501", "new row violates row-level security policy")).reportable).toBe(true);
  });

  it("recusa deliberada de RPC não vira evento", () => {
    expect(toAppError(pg("42501", "access_denied")).reportable).toBe(false);
    expect(toAppError(pg("PT422", "reference_unavailable")).reportable).toBe(false);
  });

  it("recusa humana não vira evento", () => {
    expect(toAppError(new Error("Selecione uma etapa antes de salvar.")).reportable).toBe(false);
  });

  it("erro desconhecido e servidor fora viram evento", () => {
    expect(toAppError(pg("42703", "column does not exist")).reportable).toBe(true);
    expect(toAppError(functionsHttpError(500, {})).reportable).toBe(true);
  });

  it("sessão vencida, rede e duplicado não viram evento", () => {
    expect(toAppError(pg("PGRST301", "JWT expired")).reportable).toBe(false);
    expect(toAppError(pg("", "TypeError: Failed to fetch")).reportable).toBe(false);
    expect(toAppError(pg("23505", "duplicate key")).reportable).toBe(false);
  });
});

describe("toAppError — referência", () => {
  it("é um código de 8 hex maiúsculo", () => {
    expect(toAppError(new Error("x")).reference).toMatch(/^[0-9A-F]{8}$/);
  });

  it("a mesma causa recebe a mesma referência", () => {
    const cause = pg("42703", "column does not exist");
    expect(toAppError(cause, "a").reference).toBe(toAppError(cause, "b").reference);
  });

  it("causas diferentes recebem referências diferentes", () => {
    expect(toAppError(new Error("x")).reference).not.toBe(toAppError(new Error("x")).reference);
  });

  it("é idempotente: normalizar um AppError devolve o mesmo objeto", () => {
    const once = toAppError(pg("23505", "duplicate key"));
    expect(toAppError(once)).toBe(once);
  });

  it("guarda a causa original intacta", () => {
    const cause = pg("23505", "duplicate key");
    expect(toAppError(cause).cause).toBe(cause);
  });
});

describe("unwrapFunctionsError + toAppError", () => {
  it("mostra a recusa PT do corpo da edge function", async () => {
    const error = functionsHttpError(400, { error: "Usuário não vinculado a uma organização" });
    const app = toAppError(await unwrapFunctionsError(error), FALLBACK);
    expect(app.code).toBe("validation.invalid");
    expect(app.userMessage).toBe("Usuário não vinculado a uma organização");
    expect(app.reportable).toBe(false);
    expect(app.cause).toBe(error);
  });

  it("rótulo HTTP em `error`, frase em `message`: vence a frase (formato de 12 edge functions)", async () => {
    const error = functionsHttpError(409, { success: false, error: "Conflict", message: "Este email já está cadastrado." });
    const app = toAppError(await unwrapFunctionsError(error), FALLBACK);
    expect(app.userMessage).toBe("Este email já está cadastrado.");
  });

  it("identificador de máquina vence rótulo HTTP quando não há frase", async () => {
    const error = functionsHttpError(400, { error: "Bad request", message: "rate_limited" });
    expect(toAppError(await unwrapFunctionsError(error)).code).toBe("rate.limited");
  });

  it("não mostra o inglês do corpo", async () => {
    const app = toAppError(await unwrapFunctionsError(functionsHttpError(401, { error: "Unauthorized" })), FALLBACK);
    expect(app.code).toBe("auth.session_expired");
    expect(app.userMessage).toBe("Sua sessão expirou. Entre novamente para continuar.");
  });

  it("o `code` do envelope vence o status", async () => {
    const error = functionsHttpError(400, { error: "x", code: "permission.denied" });
    expect(toAppError(await unwrapFunctionsError(error)).code).toBe("permission.denied");
  });

  it("identificador de máquina no corpo classifica", async () => {
    const error = functionsHttpError(400, { error: "rate_limited" });
    expect(toAppError(await unwrapFunctionsError(error)).code).toBe("rate.limited");
  });

  it("corpo já consumido degrada para o status", async () => {
    const error = functionsHttpError(403, { error: "Sem acesso a esta caixa" });
    await error.context.text();
    const app = toAppError(await unwrapFunctionsError(error), FALLBACK);
    expect(app.code).toBe("permission.denied");
  });

  it("corpo não-JSON é lido como texto", async () => {
    const app = toAppError(await unwrapFunctionsError(functionsHttpError(400, "TinyERP não conectado")), FALLBACK);
    expect(app.userMessage).toBe("TinyERP não conectado");
  });

  it("deixa passar qualquer outro erro", async () => {
    const other = pg("23505", "duplicate");
    expect(await unwrapFunctionsError(other)).toBe(other);
  });
});

describe("isHumanPortugueseMessage", () => {
  it.each([
    "funil não encontrado",
    "TinyERP não conectado",
    "Usuário não vinculado a uma organização",
    "Acesso negado: apenas usuarios master podem executar esta acao",
    "sao no maximo 5 anexos por mensagem",
    "Este funil ainda é o padrão da organização.",
    "Negócio não encontrado ou sem acesso.",
    "Sem permissão para registrar vendas.",
    "O negócio mudou de funil. Atualize a seleção.",
    "Pergunta com botões: use um a três botões e prazo positivo",
    // Sem acento, um sinal só (`e`) — o texto que o fluxo de links de pagamento usa.
    "Comprador incompleto: nome, e-mail e documento fiscal andam juntos",
    "Somente propostas abertas podem receber valor manual",
    "Apenas administradores podem excluir conversas",
    "Sem acesso",
    "Falha ao salvar",
    // "no" e "se for" são PT — não podem contar como inglês.
    "Selecione ao menos uma etapa no funil se for mover o negócio.",
    // Caminho de menu — o texto de `communication/lib/edgeFunctionError.ts`.
    "A instância do WhatsApp está desconectada. Reconecte em Configurações > WhatsApp.",
  ])("aceita %j", (message) => {
    expect(isHumanPortugueseMessage(message)).toBe(true);
  });

  it.each([
    "new row violates row-level security policy for table \"leads\"",
    "Permission denied",
    "No active organization membership",
    "No organization context",
    "Do not do that",
    "access_denied",
    "sale_events é append-only (ADR-0017): UPDATE proibido",
    "metric_period_bounds: organization % not found",
    "Edge Function returned a non-2xx status code",
    "Cannot read properties of undefined (reading 'map')",
    // Guardas de migration e texto de operador — medidos no schema de prod.
    "FAIL: deals.source continua anulável.",
    "GUARDA: a família de qualidade não tem as três medidas no catálogo",
    "SCRUM641 FALHA: funil da org fantasma sobreviveu ao DELETE.",
    "DINHEIRO NAO BATE: soma dos itens migrados difere da origem",
    "DELETE não afetou nenhuma linha",
    "metrics.view não foi semeada — NÃO faça o deploy do gate no front",
    "commissions.source é imutável (#994): linha manual não vira projeção nem o contrário",
    // Inglês técnico sem as palavras da lista inglesa — não pode passar.
    "dead-letter replay gate unavailable",
    "Load failed",
    "Not found",
    "recovery gap capacity exhausted",
    "Ambiguous active subscription; reconcile before navigation import",
    "anon ganhou EXECUTE numa funcao SECURITY DEFINER",
    "o valor chegou -> sem destino na organização",
    // Prefixo PT, cauda inglesa: o acento não pode liberar.
    "Erro ao enviar áudio: The object exceeded the maximum allowed size",
    "Forbidden: geração de link de pagamento é autoridade de master",
    "<div>não é frase</div>",
    "Erro",
    "",
  ])("recusa %j", (message) => {
    expect(isHumanPortugueseMessage(message)).toBe(false);
  });
});

describe("userMessageOf", () => {
  it("devolve só a mensagem segura, para erro mostrado inline", () => {
    expect(userMessageOf(pg("42703", "column does not exist"), FALLBACK)).toBe(FALLBACK);
    expect(userMessageOf(new Error("Selecione uma etapa antes de salvar."), FALLBACK)).toBe(
      "Selecione uma etapa antes de salvar.",
    );
  });

  it("sem fallback, usa o padrão", () => {
    expect(userMessageOf({})).toBe(DEFAULT_FALLBACK);
  });
});
