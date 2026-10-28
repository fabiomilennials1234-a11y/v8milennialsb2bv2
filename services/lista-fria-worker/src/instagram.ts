/**
 * Instagram: item do Actor da Apify → candidato a contato.
 *
 * Actor: `data-slayer/instagram-followers-scraper---no-login`, modo `enriched`.
 * Campos conforme o README do Actor (build lido na API pública em 27/10/2026):
 *   username, full_name, is_private, is_business, enrichment_status,
 *   public_email, biography_email, email_found, contact_phone_number,
 *   external_url, bio_links[{title,url}], biography, category, country.
 *
 * Só dado que o próprio perfil publica. Conta privada volta com
 * `enrichment_status: "skipped_private"` e campos nulos: entra como "sem contato".
 */
import { ehCelular, emailsDe, normalizarTelefoneBR, whatsappDoLink } from "./contatos.ts";
import type { Candidato } from "./executor.ts";

export const ACTOR_PADRAO = "data-slayer~instagram-followers-scraper---no-login";
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
/** O Actor processa ~50 contas por página. */
export const CONTAS_POR_PAGINA = 50;

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Número brasileiro escrito na bio com separador ("(11) 99999-9999", "11 99999-9999"). Sem separador não conta: id e data viram "telefone". */
export function telefonesDaBio(bio: string | null): string[] {
  const out: string[] = [];
  for (const m of (bio ?? "").matchAll(/(?:\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]\d{4}\b/g)) {
    const t = normalizarTelefoneBR(m[0]);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function candidatoDoItem(item: Record<string, unknown>): Candidato | null {
  const username = texto(item.username);
  if (!username || !HANDLE.test(username)) return null;

  const emails = emailsDe([item.public_email, item.biography_email, item.email_found].map(texto).filter(Boolean).join(" "));
  const bio = texto(item.biography);
  for (const e of emailsDe(bio)) if (!emails.includes(e)) emails.push(e);

  // Telefone: o do botão de contato do perfil, o WhatsApp de um link e o da bio, nessa ordem.
  const links = Array.isArray(item.bio_links) ? (item.bio_links as Array<{ url?: unknown }>).map((l) => texto(l?.url)) : [];
  const externa = texto(item.external_url);
  const candidatos = [
    normalizarTelefoneBR(texto(item.contact_phone_number)),
    ...[externa, ...links].map((u) => whatsappDoLink(u)),
    ...telefonesDaBio(bio),
  ].filter((t): t is string => t !== null);

  // Site: o link da bio, ou o primeiro link que não é de WhatsApp.
  const site = [externa, ...links].find((u) => u && /^https?:\/\//i.test(u) && !whatsappDoLink(u)) ?? null;

  return {
    ref: username.toLowerCase(),
    titulo: texto(item.full_name) ?? username,
    categoria: texto(item.category),
    endereco: texto(item.country),
    bairro: null,
    // Um telefone só: o celular (dá para chamar no WhatsApp) vence o fixo.
    telefone: candidatos.find((t) => ehCelular(t)) ?? candidatos[0] ?? null,
    site,
    emails,
    situacao: null,
    instagram: username,
  };
}
