/**
 * Testes de `mapAuthCreateError` — a tradução da recusa do Supabase Auth
 * (`auth.admin.createUser`) para a frase que o admin lê na tela.
 *
 * Caso real (2026-10-13 21:10 UTC): Auth devolveu 422 `weak_password`
 * (reasons ["pwned"]) com texto em inglês; a edge repassou o texto cru, o
 * front o descartou por não ser português e mostrou erro genérico com
 * referência. O admin não soube que o problema era a senha.
 *
 * Regra: a mensagem que sai daqui vai para a tela — sempre em português e
 * nunca com o texto técnico do Auth.
 */

import { assert, assertEquals, assertFalse } from "jsr:@std/assert@^1.0.0";
import { authCreateErrorLogDetail, mapAuthCreateError } from "./auth-create-error.ts";

const REAL_PWNED_TEXT = "Password is known to be weak and easy to guess, please choose a different one.";

Deno.test("caso real: weak_password + reasons [pwned] → 422 em português sobre vazamento", () => {
  const out = mapAuthCreateError({
    name: "AuthWeakPasswordError",
    code: "weak_password",
    status: 422,
    message: REAL_PWNED_TEXT,
    reasons: ["pwned"],
  });
  assertEquals(out.status, 422);
  assertEquals(out.kind, "weak_password");
  assert(out.message.includes("vazamentos"), out.message);
  assertFalse(out.message.includes("Password"));
});

Deno.test("caso real só pelo texto (sem code nem reasons) → mesma frase de vazamento", () => {
  const out = mapAuthCreateError({ status: 422, message: REAL_PWNED_TEXT });
  assertEquals(out.status, 422);
  assertEquals(out.kind, "weak_password");
  assert(out.message.includes("vazamentos"), out.message);
});

Deno.test("weak_password + reasons [length] → frase sobre tamanho", () => {
  const out = mapAuthCreateError({
    code: "weak_password",
    status: 422,
    message: "Password should be at least 8 characters.",
    reasons: ["length"],
  });
  assertEquals(out.status, 422);
  assert(out.message.includes("curta"), out.message);
  assert(out.message.includes("12 caracteres"), out.message);
});

Deno.test("weak_password + reasons [characters] → frase sobre tipos de caractere", () => {
  const out = mapAuthCreateError({
    code: "weak_password",
    status: 422,
    message: "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789",
    reasons: ["characters"],
  });
  assertEquals(out.status, 422);
  assert(out.message.includes("maiúsculas"), out.message);
  assertFalse(out.message.includes("abcdef"));
});

Deno.test("vários motivos: vazamento tem prioridade (é o que o admin não descobre sozinho)", () => {
  const out = mapAuthCreateError({ code: "weak_password", reasons: ["length", "pwned"] });
  assert(out.message.includes("vazamentos"), out.message);
});

Deno.test("weak_password sem reasons → frase genérica de senha fraca", () => {
  const out = mapAuthCreateError({ code: "weak_password", status: 422, message: "weak" });
  assertEquals(out.status, 422);
  assertEquals(
    out.message,
    "Essa senha é fraca ou já apareceu em vazamentos de dados. Escolha outra, com pelo menos 12 caracteres e sem palavras óbvias.",
  );
});

Deno.test("texto 'Password should be at least' sem code → tamanho", () => {
  const out = mapAuthCreateError({ status: 422, message: "Password should be at least 6 characters." });
  assertEquals(out.kind, "weak_password");
  assert(out.message.includes("curta"), out.message);
});

Deno.test("email_address_invalid → 422 'E-mail inválido.'", () => {
  const out = mapAuthCreateError({
    code: "email_address_invalid",
    status: 400,
    message: 'Email address "x@y" is invalid',
  });
  assertEquals(out, { status: 422, kind: "email_invalid", message: "E-mail inválido." });
});

Deno.test("texto 'invalid format' sem code → e-mail inválido", () => {
  const out = mapAuthCreateError({ status: 400, message: "Unable to validate email address: invalid format" });
  assertEquals(out.kind, "email_invalid");
  assertEquals(out.message, "E-mail inválido.");
});

for (const code of ["email_exists", "user_already_exists"]) {
  Deno.test(`${code} → 409 'Este email já está cadastrado.'`, () => {
    const out = mapAuthCreateError({ code, status: 422, message: "whatever" });
    assertEquals(out, { status: 409, kind: "email_exists", message: "Este email já está cadastrado." });
  });
}

Deno.test("texto 'already been registered' sem code → 409 (compat com o comportamento anterior)", () => {
  const out = mapAuthCreateError({ message: "A user with this email address has already been registered" });
  assertEquals(out.status, 409);
  assertEquals(out.kind, "email_exists");
});

for (const code of ["over_request_rate_limit", "over_email_send_rate_limit"]) {
  Deno.test(`${code} → 429`, () => {
    const out = mapAuthCreateError({ code, status: 429, message: "Request rate limit reached" });
    assertEquals(out, {
      status: 429,
      kind: "rate_limited",
      message: "Muitas tentativas. Aguarde um minuto e tente de novo.",
    });
  });
}

Deno.test("status 429 sem code → 429", () => {
  const out = mapAuthCreateError({ status: 429, message: "Too many requests" });
  assertEquals(out.kind, "rate_limited");
});

Deno.test("desconhecido 4xx → 400 genérico, sem vazar o texto técnico", () => {
  const out = mapAuthCreateError({ code: "something_new", status: 400, message: "Some technical failure xyz" });
  assertEquals(out, { status: 400, kind: "unknown", message: "Não foi possível criar o usuário." });
});

Deno.test("desconhecido 5xx/sem status → 502 genérico", () => {
  assertEquals(mapAuthCreateError({ status: 500, message: "Database error creating new user" }).status, 502);
  assertEquals(mapAuthCreateError({ message: "boom" }).status, 502);
});

Deno.test("entrada não-objeto não lança", () => {
  for (const input of [null, undefined, "x", 42]) {
    const out = mapAuthCreateError(input);
    assertEquals(out.kind, "unknown");
    assertEquals(out.message, "Não foi possível criar o usuário.");
  }
});

Deno.test("nenhuma mensagem mapeada contém o texto cru do Auth", () => {
  const inputs = [
    { code: "weak_password", message: REAL_PWNED_TEXT, reasons: ["pwned"] },
    { code: "email_address_invalid", message: "Unable to validate email address: invalid format" },
    { code: "over_request_rate_limit", message: "Request rate limit reached" },
    { code: "x", message: "Secret internal detail" },
  ];
  for (const input of inputs) {
    assertFalse(mapAuthCreateError(input).message.includes(input.message));
  }
});

Deno.test("authCreateErrorLogDetail mascara e-mail ecoado pelo Auth", () => {
  const out = authCreateErrorLogDetail({ message: 'Email address "fulano@empresa.com.br" is invalid' });
  assertEquals(out, 'Email address "[email]" is invalid');
});

Deno.test("authCreateErrorLogDetail preserva o texto técnico sem e-mail e não lança", () => {
  assertEquals(authCreateErrorLogDetail({ message: REAL_PWNED_TEXT }), REAL_PWNED_TEXT);
  assertEquals(authCreateErrorLogDetail(null), "");
});
