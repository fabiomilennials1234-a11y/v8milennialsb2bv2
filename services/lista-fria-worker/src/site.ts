/**
 * Contato público no site do negócio: e-mail, telefone e WhatsApp.
 *
 * O gosom já lê e-mail do site (`email: true`); isto cobre o que ele não traz,
 * principalmente o WhatsApp do botão "fale conosco" (`wa.me`), que é o canal que
 * importa para quem vende para PME no Brasil. Só dado que o próprio negócio
 * publicou.
 */
import { emailsDe, normalizarTelefoneBR, whatsappDoLink } from "./contatos.ts";
import { buscarPagina, type OpcoesDeBusca } from "./ssrf.ts";

export interface ContatosDoSite {
  emails: string[];
  /** WhatsApp (dígitos com 55) achados em links wa.me / api.whatsapp.com. */
  whatsapps: string[];
  telefones: string[];
}

const VAZIO: ContatosDoSite = { emails: [], whatsapps: [], telefones: [] };
const PAGINA_DE_CONTATO = /contato|contact|fale[-_ ]?conosco|atendimento|agende|agendamento/i;

function add(lista: string[], v: string | null) {
  if (v && !lista.includes(v)) lista.push(v);
}

/** E-mail protegido pelo Cloudflare (`data-cfemail`): primeiro byte é a chave do XOR. */
export function decodificarCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2 !== 0) return null;
  const chave = parseInt(hex.slice(0, 2), 16);
  let s = "";
  for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ chave);
  return s;
}

function textoVisivel(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#64;|&commat;|\[\s*(?:at|arroba)\s*\]|\(\s*(?:at|arroba)\s*\)/gi, "@")
    .replace(/&nbsp;/g, " ");
}

export function extrairContatosDoHtml(html: string, base: string): { contatos: ContatosDoSite; paginasDeContato: string[] } {
  const contatos: ContatosDoSite = { emails: [], whatsapps: [], telefones: [] };
  const paginas: string[] = [];
  let origem: URL | null = null;
  try {
    origem = new URL(base);
  } catch { /* base inválida: sem páginas de contato */ }

  for (const m of html.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (m[1] ?? m[2] ?? "").trim().replace(/&amp;/g, "&");
    if (/^mailto:/i.test(href)) {
      for (const e of emailsDe(decodeURIComponent(href.slice(7).split("?")[0]))) add(contatos.emails, e);
    } else if (/^tel:/i.test(href)) {
      add(contatos.telefones, normalizarTelefoneBR(decodeURIComponent(href.slice(4))));
    } else {
      const wa = whatsappDoLink(href);
      if (wa) {
        add(contatos.whatsapps, wa);
      } else if (origem && PAGINA_DE_CONTATO.test(href) && !/^(javascript|mailto|tel):/i.test(href)) {
        try {
          const u = new URL(href, origem);
          if (u.hostname === origem.hostname && !paginas.includes(u.toString()) && u.toString() !== origem.toString()) {
            paginas.push(u.toString());
          }
        } catch { /* href quebrado */ }
      }
    }
  }
  for (const m of html.matchAll(/data-cfemail\s*=\s*"([0-9a-f]+)"/gi)) {
    const e = decodificarCfEmail(m[1]);
    for (const x of emailsDe(e)) add(contatos.emails, x);
  }
  for (const e of emailsDe(textoVisivel(html).match(/[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)?.map((x) => x.replace(/\s/g, "")).join(" "))) {
    add(contatos.emails, e);
  }
  return { contatos, paginasDeContato: paginas };
}

export interface OpcoesDoSite extends OpcoesDeBusca {
  /** Páginas de contato além da inicial. */
  maxPaginasExtras?: number;
}

/** Home + até 2 páginas de contato do mesmo domínio. Falha de rede = sem contato, nunca erro. */
export async function lerSite(url: string, opcoes: OpcoesDoSite = {}): Promise<ContatosDoSite> {
  const home = await buscarPagina(url, opcoes);
  if (!home) return { ...VAZIO };
  const { contatos, paginasDeContato } = extrairContatosDoHtml(home.html, home.url);
  const extras = paginasDeContato.slice(0, opcoes.maxPaginasExtras ?? 2);
  for (const p of extras) {
    const pagina = await buscarPagina(p, opcoes);
    if (!pagina) continue;
    const { contatos: c } = extrairContatosDoHtml(pagina.html, pagina.url);
    for (const e of c.emails) add(contatos.emails, e);
    for (const w of c.whatsapps) add(contatos.whatsapps, w);
    for (const t of c.telefones) add(contatos.telefones, t);
  }
  return contatos;
}
