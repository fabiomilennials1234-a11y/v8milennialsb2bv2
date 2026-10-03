/**
 * notificame-message — a regra de segurança do `postMessage` do Seamless,
 * isolada como função PURA para que a asserção de origem more onde o Vitest a lê.
 *
 * O popup do Seamless (`/v2/oauth/meta/start`) devolve o resultado por
 * `window.postMessage`. Isso significa que QUALQUER página aberta pelo usuário
 * pode postar na nossa janela: a única coisa que separa "o NotificaMe concluiu
 * a conexão" de "um site hostil disse que concluiu" é o `event.origin`.
 *
 * IGUALDADE ESTRITA, nunca `endsWith`. O precedente
 * `useConnectWhatsAppCloud.ts` usa `event.origin.endsWith("facebook.com")`, que
 * aceitaria `https://evil-facebook.com`. Traduzido para cá, `endsWith(
 * "notificame.com.br")` aceitaria `https://evil-notificame.com.br` — um domínio
 * que qualquer um registra. Aqui a comparação é `===` contra a origem completa,
 * COM esquema: `http://` (sem TLS) e `https://api.notificame.com.br.evil.io`
 * são rejeitados pelo mesmo teste.
 *
 * Esta função NÃO decide nada sobre o vínculo do canal — ela só classifica a
 * mensagem. Quem descobre QUAL canal nasceu é a edge function
 * `notificame-channel-finish`, server-side, usando o token da SUBCONTA daquela
 * org — nunca o da conta-mãe, que jamais sai do servidor e não é usado neste
 * fluxo. É essa escopagem que faz o `GET /v1/channels` do finish já chegar
 * limitado aos canais daquela org. Um `'success'` daqui é permissão para
 * PERGUNTAR ao servidor, nunca um fato sobre o banco.
 */

/**
 * Origem PADRÃO do popup, correspondente a `NOTIFICAME_DEFAULT_BASE_URL` em
 * `supabase/functions/_shared/notificame.ts`. As duas constantes são o mesmo fato
 * e têm que andar juntas.
 *
 * ATENÇÃO — ela é só o FALLBACK. A base do fornecedor é configurável por env
 * (`NOTIFICAME_BASE_URL`, lido pelas edge functions), e é dessa base que sai a
 * `start_url` do popup. Apontar a env para outro host (`hub.*`, um mock, um
 * ambiente de staging) e deixar a comparação presa nesta constante faria TODO
 * `postMessage` legítimo ser descartado — a conexão falharia em silêncio, sem erro
 * no console e sem toast, porque `'ignore'` é indistinguível de ruído.
 *
 * Por isso a origem esperada deve ser DERIVADA DA MESMA FONTE que a base: a
 * própria `start_url` que o servidor devolveu, via `seamlessOriginFromStartUrl`.
 */
export const NOTIFICAME_ORIGIN = "https://api.notificame.com.br";

/**
 * Extrai a origem (esquema + host + porta, sem barra final) da URL do popup.
 *
 * É a ÚNICA derivação correta no cliente: o navegador carimba `event.origin` com a
 * origem do documento aberto em `window.open(start_url)`. Logo a origem esperada é,
 * por construção, a origem da `start_url` — sem duplicar env nenhuma e sem chance de
 * as duas divergirem.
 *
 * Devolve `null` para qualquer entrada que não seja uma URL absoluta com host. O
 * chamador que recebe `null` deve tratar como FALHA FECHADA (nada é aceito), nunca
 * cair no default silenciosamente: uma `start_url` malformada é exatamente o caso em
 * que não se sabe quem está falando.
 */
export function seamlessOriginFromStartUrl(startUrl: unknown): string | null {
  if (typeof startUrl !== "string" || startUrl.trim() === "") return null;
  try {
    const { origin } = new URL(startUrl);
    // `new URL('mailto:x').origin` e similares devolvem "null" (string) ou "".
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * `'success'` = o Seamless concluiu; pode chamar o finish.
 * `'failure'` = o Seamless falhou/negou; encerra com aviso.
 * `'ignore'`  = não é do NotificaMe (ou é ruído de outra integração) — silêncio.
 */
export type SeamlessOutcome = "success" | "failure" | "ignore";

/** Payload que o popup posta. Só `status` é contratual. */
interface SeamlessMessageData {
  status?: unknown;
}

/**
 * Classifica um `MessageEvent` do popup do Seamless.
 *
 * Aceita a forma mínima `{ origin, data }` (em vez do `MessageEvent` inteiro)
 * para ser testável sem DOM.
 *
 * @param expectedOrigin Origem contra a qual comparar, por IGUALDADE ESTRITA.
 *   Passe `seamlessOriginFromStartUrl(startUrl)` — assim a origem esperada e a URL
 *   do popup saem da MESMA fonte (a base configurável do servidor) e não podem
 *   divergir. `null` é fail-closed DE PROPÓSITO: derivação falhou ⇒ não se sabe
 *   quem está falando ⇒ nada é aceito. Omitir cai no default
 *   `NOTIFICAME_ORIGIN`, que só está certo enquanto `NOTIFICAME_BASE_URL` não for
 *   sobrescrita no servidor.
 */
export function readSeamlessMessage(
  event: { origin: unknown; data: unknown },
  expectedOrigin: string | null = NOTIFICAME_ORIGIN,
): SeamlessOutcome {
  // Fail-closed: sem origem esperada não há com o que comparar. Nunca cair no
  // default aqui — isso reintroduziria o host fixo pela porta dos fundos.
  if (typeof expectedOrigin !== "string" || expectedOrigin === "") return "ignore";

  // Porta de entrada. Tudo depois disto já passou pela checagem de origem.
  if (typeof event.origin !== "string" || event.origin !== expectedOrigin) {
    return "ignore";
  }

  let payload: SeamlessMessageData | null = null;
  if (typeof event.data === "string") {
    try {
      payload = JSON.parse(event.data) as SeamlessMessageData;
    } catch {
      // String que não é JSON — ruído de outra integração na mesma janela.
      return "ignore";
    }
  } else if (event.data && typeof event.data === "object") {
    payload = event.data as SeamlessMessageData;
  }

  const status = payload?.status;
  if (status === "channel-success") return "success";
  // Qualquer outro `status` string é falha declarada pelo próprio Seamless.
  if (typeof status === "string") return "failure";
  return "ignore";
}
