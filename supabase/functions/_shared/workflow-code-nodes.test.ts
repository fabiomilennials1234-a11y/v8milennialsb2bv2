/**
 * Helpers dos nós de código. Tudo aqui é puro — nenhum mock, nenhum client.
 * `parseHttpsRequest` é o portão de forma do nó HTTPS: é aqui que se prova que
 * `http://` é recusado, que o teto de timeout apara o valor e que GET não leva corpo.
 */
import { assertEquals } from "@std/assert";
import {
  capString,
  flattenForContext,
  HTTPS_DEFAULT_TIMEOUT_MS,
  HTTPS_MAX_TIMEOUT_MS,
  jsonEscape,
  parseHttpsRequest,
  stripJsonbUnsafe,
  sweepLeaves,
} from "./workflow-code-nodes.ts";

/** Extrai o spec de um resultado que se espera OK (falha o teste se não for). */
function spec(input: unknown) {
  const res = parseHttpsRequest(input);
  if (!res.ok) throw new Error(`esperava ok, veio erro: ${res.error}`);
  return res.spec;
}

/** Extrai a mensagem de um resultado que se espera erro. */
function err(input: unknown): string {
  const res = parseHttpsRequest(input);
  if (res.ok) throw new Error("esperava erro, veio ok");
  return res.error;
}

// ─── jsonEscape ─────────────────────────────────────────────────────────────

Deno.test("jsonEscape — aspas do nome do lead não quebram o JSON.parse", () => {
  const raw = 'Pneus "Bom Preço" Ltda';
  assertEquals(jsonEscape(raw), 'Pneus \\"Bom Preço\\" Ltda');
  // O invariante que interessa: o resultado cabe dentro de uma string JSON.
  assertEquals(JSON.parse(`{"empresa":"${jsonEscape(raw)}"}`).empresa, raw);
});

Deno.test("jsonEscape — quebra de linha, tab e barra invertida", () => {
  assertEquals(jsonEscape("linha1\nlinha2"), "linha1\\nlinha2");
  assertEquals(jsonEscape("col1\tcol2"), "col1\\tcol2");
  assertEquals(jsonEscape("C:\\temp"), "C:\\\\temp");
  assertEquals(JSON.parse(`"${jsonEscape("a\n\t\\b")}"`), "a\n\t\\b");
});

// ─── parseHttpsRequest — url ────────────────────────────────────────────────

Deno.test("parseHttpsRequest — requisição mínima: só a url, method vira GET", () => {
  const s = spec({ url: "https://api.cliente.com/pedidos" });
  assertEquals(s.method, "GET");
  assertEquals(s.url, "https://api.cliente.com/pedidos");
  assertEquals(s.headers, {});
  assertEquals(s.body, undefined);
  assertEquals(s.timeoutMs, HTTPS_DEFAULT_TIMEOUT_MS);
});

Deno.test("parseHttpsRequest — http:// é recusado com mensagem explícita", () => {
  const msg = err({ url: "http://api.cliente.com/pedidos" });
  assertEquals(msg.includes("https://"), true);
  assertEquals(msg.includes("Authorization"), true);
});

Deno.test("parseHttpsRequest — outros esquemas também são recusados", () => {
  assertEquals(err({ url: "ftp://arquivo.cliente.com" }).includes("https://"), true);
  assertEquals(err({ url: "file:///etc/passwd" }).includes("https://"), true);
  assertEquals(err({ url: "api.cliente.com/pedidos" }).includes("https://"), true);
});

Deno.test("parseHttpsRequest — url ausente, vazia ou não-texto", () => {
  assertEquals(err({}).includes("\"url\""), true);
  assertEquals(err({ url: "   " }).includes("\"url\""), true);
  assertEquals(err({ url: 42 }).includes("\"url\""), true);
});

Deno.test("parseHttpsRequest — espaço em volta da url é aparado", () => {
  assertEquals(spec({ url: "  https://api.cliente.com/x  " }).url, "https://api.cliente.com/x");
});

Deno.test("parseHttpsRequest — o JSON inteiro precisa ser objeto, não array nem escalar", () => {
  assertEquals(err([{ url: "https://a.com" }]).includes("objeto JSON"), true);
  assertEquals(err("https://a.com").includes("objeto JSON"), true);
  assertEquals(err(null).includes("objeto JSON"), true);
});

// ─── parseHttpsRequest — method ─────────────────────────────────────────────

Deno.test("parseHttpsRequest — method é case-insensitive e sai maiúsculo", () => {
  assertEquals(spec({ url: "https://a.com", method: "post" }).method, "POST");
  assertEquals(spec({ url: "https://a.com", method: " Patch " }).method, "PATCH");
});

Deno.test("parseHttpsRequest — method desconhecido lista os aceitos", () => {
  const msg = err({ url: "https://a.com", method: "TRACE" });
  assertEquals(msg.includes("TRACE"), true);
  assertEquals(msg.includes("GET, POST, PUT, PATCH, DELETE, HEAD"), true);
});

Deno.test("parseHttpsRequest — method não-texto é recusado", () => {
  assertEquals(err({ url: "https://a.com", method: 3 }).includes("\"method\""), true);
});

// ─── parseHttpsRequest — headers ────────────────────────────────────────────

Deno.test("parseHttpsRequest — headers de strings passam intactos", () => {
  const s = spec({
    url: "https://a.com",
    headers: { Authorization: "Bearer abc", "X-Org": "torque" },
  });
  assertEquals(s.headers, { Authorization: "Bearer abc", "X-Org": "torque" });
});

Deno.test("parseHttpsRequest — header com valor não-texto é recusado sem citar o valor", () => {
  const msg = err({ url: "https://a.com", headers: { "X-Token": 12345 } });
  assertEquals(msg.includes("X-Token"), true);
  // O VALOR do header é onde mora o segredo — nunca entra na mensagem.
  assertEquals(msg.includes("12345"), false);
});

Deno.test("parseHttpsRequest — headers precisa ser objeto", () => {
  assertEquals(err({ url: "https://a.com", headers: ["a"] }).includes("\"headers\""), true);
  assertEquals(err({ url: "https://a.com", headers: "Bearer x" }).includes("\"headers\""), true);
});

// ─── parseHttpsRequest — body ───────────────────────────────────────────────

Deno.test("parseHttpsRequest — body objeto vira JSON e ganha Content-Type", () => {
  const s = spec({ url: "https://a.com", method: "POST", body: { lead: "Acme", total: 1990 } });
  assertEquals(s.body, '{"lead":"Acme","total":1990}');
  assertEquals(s.headers["Content-Type"], "application/json");
});

Deno.test("parseHttpsRequest — body array também vira JSON", () => {
  assertEquals(spec({ url: "https://a.com", method: "POST", body: [1, 2] }).body, "[1,2]");
});

Deno.test("parseHttpsRequest — body string vai como está, sem Content-Type inventado", () => {
  const s = spec({ url: "https://a.com", method: "POST", body: "a=1&b=2" });
  assertEquals(s.body, "a=1&b=2");
  assertEquals(s.headers["Content-Type"], undefined);
});

Deno.test("parseHttpsRequest — Content-Type declarado pelo usuário vence (case-insensitive)", () => {
  const s = spec({
    url: "https://a.com",
    method: "POST",
    headers: { "content-type": "application/vnd.api+json" },
    body: { a: 1 },
  });
  assertEquals(s.headers["content-type"], "application/vnd.api+json");
  assertEquals(s.headers["Content-Type"], undefined);
});

Deno.test("parseHttpsRequest — GET e HEAD ignoram o body (e não ganham Content-Type)", () => {
  const g = spec({ url: "https://a.com", body: { a: 1 } });
  assertEquals(g.body, undefined);
  assertEquals(g.headers["Content-Type"], undefined);

  assertEquals(spec({ url: "https://a.com", method: "head", body: "x" }).body, undefined);
});

Deno.test("parseHttpsRequest — body de tipo inválido é recusado", () => {
  assertEquals(err({ url: "https://a.com", method: "POST", body: 42 }).includes("\"body\""), true);
  assertEquals(err({ url: "https://a.com", method: "POST", body: true }).includes("\"body\""), true);
});

Deno.test("parseHttpsRequest — body null é ausência de corpo, não erro", () => {
  assertEquals(spec({ url: "https://a.com", method: "POST", body: null }).body, undefined);
});

// ─── parseHttpsRequest — timeoutMs ──────────────────────────────────────────

Deno.test("parseHttpsRequest — timeoutMs default é 15000", () => {
  assertEquals(spec({ url: "https://a.com" }).timeoutMs, 15_000);
});

Deno.test("parseHttpsRequest — timeoutMs acima do teto é aparado em 30000", () => {
  assertEquals(spec({ url: "https://a.com", timeoutMs: 120_000 }).timeoutMs, HTTPS_MAX_TIMEOUT_MS);
  assertEquals(HTTPS_MAX_TIMEOUT_MS, 30_000);
});

Deno.test("parseHttpsRequest — timeoutMs válido é respeitado, e o fracionário é truncado", () => {
  assertEquals(spec({ url: "https://a.com", timeoutMs: 10_000 }).timeoutMs, 10_000);
  assertEquals(spec({ url: "https://a.com", timeoutMs: 999.9 }).timeoutMs, 999);
});

Deno.test("parseHttpsRequest — timeoutMs zero, negativo ou não-numérico é recusado", () => {
  assertEquals(err({ url: "https://a.com", timeoutMs: 0 }).includes("\"timeoutMs\""), true);
  assertEquals(err({ url: "https://a.com", timeoutMs: -5 }).includes("\"timeoutMs\""), true);
  assertEquals(err({ url: "https://a.com", timeoutMs: "10s" }).includes("\"timeoutMs\""), true);
  assertEquals(err({ url: "https://a.com", timeoutMs: Number.NaN }).includes("\"timeoutMs\""), true);
});

// ─── parseHttpsRequest — o exemplo do cliente, ponta a ponta ────────────────

Deno.test("parseHttpsRequest — o exemplo da SPEC atravessa inteiro", () => {
  const s = spec(JSON.parse(`{
    "method": "POST",
    "url": "https://api.cliente.com/pedidos",
    "headers": { "Authorization": "Bearer TOKEN" },
    "body": { "lead": "Acme", "total": "199,90" },
    "timeoutMs": 10000
  }`));
  assertEquals(s.method, "POST");
  assertEquals(s.url, "https://api.cliente.com/pedidos");
  assertEquals(s.headers.Authorization, "Bearer TOKEN");
  assertEquals(s.body, '{"lead":"Acme","total":"199,90"}');
  assertEquals(s.timeoutMs, 10_000);
});

// ─── flattenForContext ──────────────────────────────────────────────────────

Deno.test("flattenForContext — objeto raso vira chaves pontilhadas", () => {
  const out: Record<string, string | number | boolean> = {};
  flattenForContext("payload", { total: 1990, pago: true, cliente: "Acme" }, out);
  assertEquals(out, {
    "payload.total": 1990,
    "payload.pago": true,
    "payload.cliente": "Acme",
  });
});

Deno.test("flattenForContext — desce até a profundidade 3", () => {
  const out: Record<string, string | number | boolean> = {};
  flattenForContext("p", { a: { b: { c: "fundo" } } }, out);
  assertEquals(out, { "p.a.b.c": "fundo" });
});

Deno.test("flattenForContext — para na profundidade 4", () => {
  const out: Record<string, string | number | boolean> = {};
  flattenForContext("p", { a: { b: { c: { d: "fundo demais" } } } }, out);
  assertEquals(out, {});
});

Deno.test("flattenForContext — array vira índice numérico (itens.0.sku)", () => {
  const out: Record<string, string | number | boolean> = {};
  flattenForContext("payload", { itens: [{ sku: "ABC" }, { sku: "XYZ" }] }, out);
  assertEquals(out, { "payload.itens.0.sku": "ABC", "payload.itens.1.sku": "XYZ" });
});

Deno.test("flattenForContext — para em 50 chaves", () => {
  const out: Record<string, string | number | boolean> = {};
  const big: Record<string, number> = {};
  for (let i = 0; i < 120; i++) big[`k${i}`] = i;
  flattenForContext("p", big, out);
  assertEquals(Object.keys(out).length, 50);
});

Deno.test("flattenForContext — ignora null e objeto/array vazio nas folhas", () => {
  const out: Record<string, string | number | boolean> = {};
  flattenForContext("p", { a: null, b: {}, c: [], d: 1 }, out);
  assertEquals(out, { "p.d": 1 });
});

Deno.test("flattenForContext — nunca grava o próprio prefixo", () => {
  // O executor já gravou `context[prefix]` com o JSON compacto; sobrescrever aqui
  // trocaria o objeto inteiro por uma folha.
  const out: Record<string, string | number | boolean> = {};
  flattenForContext("payload", "só uma string", out);
  assertEquals(out, {});
});

// ─── capString ──────────────────────────────────────────────────────────────

Deno.test("capString — abaixo (ou em cima) do teto devolve intacto", () => {
  assertEquals(capString("abc", 10), "abc");
  assertEquals(capString("abc", 3), "abc");
});

Deno.test("capString — corta e anexa reticências, respeitando o teto", () => {
  const cortado = capString("abcdefghij", 5);
  assertEquals(cortado, "abcd…");
  assertEquals(cortado.length, 5);
});

Deno.test("capString — não parte par surrogate", () => {
  // "aa😀bb": o corte em 4 cairia no meio do emoji e deixaria um surrogate órfão,
  // que quebra o JSON.stringify na hora de gravar o passo.
  assertEquals(capString("aa😀bb", 4), "aa…");
});

Deno.test("capString — teto zero ou negativo devolve vazio", () => {
  assertEquals(capString("abc", 0), "");
  assertEquals(capString("abc", -1), "");
});

// ─── Saneamento para jsonb ──────────────────────────────────────────────────

Deno.test("stripJsonbUnsafe — remove U+0000", () => {
  // Um byte 0x00 no corpo de uma API vira U+0000 no `res.text()`. Dentro de `context`
  // (jsonb) o Postgres recusa a conversão com 22P05, o UPDATE do heartbeat falha calado
  // e o reclaim re-executa a partir do nó de código a cada 10 min.
  assertEquals(stripJsonbUnsafe("a\u0000b"), "ab");
  assertEquals(stripJsonbUnsafe("\u0000"), "");
});

Deno.test("stripJsonbUnsafe — remove surrogate órfão, preserva par válido", () => {
  assertEquals(stripJsonbUnsafe("a\ud83db"), "ab");
  assertEquals(stripJsonbUnsafe("a\ude00b"), "ab");
  assertEquals(stripJsonbUnsafe("a😀b"), "a😀b");
});

Deno.test("capString — saneia U+0000 mesmo abaixo do teto", () => {
  // O caminho perigoso não é o corte: é a string curta, que passava direto.
  assertEquals(capString("a\u0000b", 100), "ab");
});

Deno.test("flattenForContext — folha string é saneada e cortada em 2000", () => {
  const out: Record<string, string | number | boolean> = {};
  flattenForContext("resposta", { nota: "x\u0000y", gigante: "z".repeat(5000) }, out);

  assertEquals(out["resposta.nota"], "xy");
  // Sem teto por folha, 50 folhas de tamanho livre empurravam o context por cima da
  // guarda de 128 KB do heartbeat — e a pausa seguinte retomava com o context velho.
  assertEquals(String(out["resposta.gigante"]).length, 2000);
});

Deno.test("flattenForContext — varre as folhas da passada anterior", () => {
  const out: Record<string, string | number | boolean> = {};

  flattenForContext("resposta", { status: "erro", mensagem: "cartão recusado" }, out);
  assertEquals(out["resposta.mensagem"], "cartão recusado");

  // Volta 2 do laço: a API responde com outra FORMA, sem `mensagem`.
  flattenForContext("resposta", { status: "ok" }, out);

  assertEquals(out["resposta.status"], "ok");
  // Sem a varredura, `{{resposta.mensagem}}` mandaria "cartão recusado" ao lead depois
  // de um pagamento aprovado — com o passo gravado como `success`.
  assertEquals(out["resposta.mensagem"], undefined);
});

Deno.test("sweepLeaves — apaga só as folhas do prefixo", () => {
  const out: Record<string, unknown> = {
    "resposta": "{...}",
    "resposta.id": 1,
    "resposta.erro.codigo": 502,
    "outra": "fica",
    "outra.folha": "fica",
  };

  sweepLeaves("resposta", out);

  // A chave do próprio prefixo é do executor — quem mexe nela é `clearCodeOutput`.
  assertEquals(out["resposta"], "{...}");
  assertEquals(out["resposta.id"], undefined);
  assertEquals(out["resposta.erro.codigo"], undefined);
  assertEquals(out["outra"], "fica");
  assertEquals(out["outra.folha"], "fica");
});
