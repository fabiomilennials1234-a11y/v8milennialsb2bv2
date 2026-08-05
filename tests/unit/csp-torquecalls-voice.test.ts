/**
 * A CSP tem que permitir o stream de eventos de voz.
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * Medido em produção em 2026-07-30, com o CTO na tela: o pareamento por QR
 * falhava com "A conexão com o servidor de voz caiu", e a causa NÃO era a VPS
 * nem o token. Era a CSP do próprio CRM:
 *
 *   Connecting to 'https://calls.torquecrm.com.br/api/events' violates the
 *   following Content Security Policy directive: "connect-src 'self' ...".
 *   The action has been blocked.
 *
 * O navegador barrava a requisição ANTES de ela sair. Por isso o diagnóstico
 * era enganoso em todas as direções: as edge functions devolviam 200, a VPS
 * gerava o QR e registrava tudo normalmente, e o log dela não tinha recusa
 * nenhuma — porque a requisição nunca chegou lá. Um erro de rede do lado do
 * cliente parecendo falha do servidor.
 *
 * A `connect-src` foi escrita quando `calls.torquecrm.com.br` ainda não
 * existia; a voz é a primeira coisa do produto que fala com um host fora do
 * Supabase.
 *
 * O HOST É LITERAL, E ISSO É UMA AMARRA REAL
 * ------------------------------------------
 * O endereço da VPS chega ao cliente em tempo de execução, por
 * `TORQUECALLS_PUBLIC_URL` (secret do Supabase, lido por `publicVpsUrl()`),
 * mas a CSP é estática, escrita no build. Ou seja: trocar aquele secret sem
 * trocar estas duas linhas quebra a voz de novo, com exatamente o mesmo
 * sintoma enganoso. Não há como derivar um do outro — o que dá para fazer é
 * deixar o vínculo escrito, e é o que este teste faz.
 *
 * Os DOIS lugares importam: a meta tag do `index.html` vale no dev server, e o
 * header do nginx (`Dockerfile`) vale em produção. Corrigir um só produz o
 * defeito que só aparece depois do deploy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const indexHtml = readFileSync(resolve(root, "index.html"), "utf8");
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");

/** Host da VPS de voz. Ver `TORQUECALLS_PUBLIC_URL` nos secrets do Supabase. */
const VOICE_HOST = "https://calls.torquecrm.com.br";

function directive(csp: string, name: string): string {
  const m = csp.match(new RegExp(`${name}([^;]*)`, "i"));
  return m ? m[1] : "";
}

/**
 * Confere a fonte como TOKEN da diretiva, não como substring dela.
 *
 * `includes()` aqui seria um teste que passa sem medir o que diz medir:
 * `"https://calls.torquecrm.com.br.evil.com"` contém o nosso host, e a
 * asserção ficaria verde com uma CSP que libera outro domínio. A diretiva é
 * uma lista separada por espaços, então a comparação certa é por igualdade de
 * item — e é assim que o navegador também a interpreta.
 *
 * O CodeQL apontou isto como `js/incomplete-url-substring-sanitization`, e
 * estava certo: mesmo fora de um contexto de sanitização, a checagem por
 * substring acerta por acidente.
 */
function hasSource(csp: string, name: string, source: string): boolean {
  return directive(csp, name).trim().split(/\s+/).includes(source);
}

function metaCsp(): string {
  const m = indexHtml.match(/Content-Security-Policy"\s+content="([\s\S]*?)"/i);
  expect(m, "index.html precisa ter a meta CSP").toBeTruthy();
  return m![1];
}

function nginxCsp(): string {
  const m = dockerfile.match(/Content-Security-Policy\s+\\"([\s\S]*?)\\"\s+always/i);
  expect(m, "Dockerfile precisa ter o header CSP do nginx").toBeTruthy();
  return m![1];
}

describe("CSP permite o stream de eventos de voz", () => {
  it("libera o host da VPS no connect-src da meta tag (dev server)", () => {
    expect(hasSource(metaCsp(), "connect-src", VOICE_HOST)).toBe(true);
  });

  it("libera o host da VPS no connect-src do nginx (produção)", () => {
    expect(hasSource(nginxCsp(), "connect-src", VOICE_HOST)).toBe(true);
  });

  it("mantém os dois em acordo — corrigir um só é o defeito que só aparece no deploy", () => {
    expect(hasSource(metaCsp(), "connect-src", VOICE_HOST))
      .toBe(hasSource(nginxCsp(), "connect-src", VOICE_HOST));
  });

  it("não aceita um host que apenas CONTENHA o nosso — a checagem é por token", () => {
    const impostor = "connect-src 'self' https://calls.torquecrm.com.br.evil.com;";
    expect(hasSource(impostor, "connect-src", VOICE_HOST)).toBe(false);
  });
});
