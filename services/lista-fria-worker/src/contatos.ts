/**
 * Telefone e e-mail: normalização e validação, funções puras.
 *
 * Telefone sai em dígitos com DDI 55 (formato que `lista_fria_resultados`
 * aceita: 10 a 15 dígitos). Só entra número brasileiro plausível; o que não for
 * é descartado aqui, não no banco.
 */

export function soDigitos(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * Número brasileiro em dígitos com 55: 12 (fixo) ou 13 (celular).
 *
 *   - DDD 11 a 99, sem zero no fim (10, 20…, não existem);
 *   - fixo: 8 dígitos começando em 2 a 5;
 *   - celular: 9 dígitos começando em 9;
 *   - número de 10 dígitos começando em 8 ou 9 é celular de ANTES do nono dígito (o plano de numeração
 *     reservou 2 a 5 para fixo): ganha o 9 na frente. A base do CNPJ da Receita guarda quase todo celular
 *     assim (~50% dos telefones), e descartá-los deixava a busca "Com telefone" sem telefone;
 *   - número de 10 dígitos começando em 6 ou 7 é ambíguo (celular antigo, rádio/trunking): descarta em vez
 *     de chutar;
 *   - dígitos todos iguais (11 1111-1111) é lixo.
 */
export function normalizarTelefoneBR(bruto: string | null | undefined): string | null {
  let d = soDigitos(bruto).replace(/^0+/, "");
  if (d.length === 12 || d.length === 13) {
    if (!d.startsWith("55")) return null;
    d = d.slice(2);
  }
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^(\d)\1+$/.test(d)) return null;

  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99 || ddd % 10 === 0) return null;

  const numero = d.slice(2);
  if (numero.length === 9) {
    if (numero[0] !== "9") return null;
  } else if (/^[89]/.test(numero)) {
    // Celular de 8 dígitos (antes do nono dígito): o 9 entra depois do DDD.
    return `55${d.slice(0, 2)}9${numero}`;
  } else if (!/^[2-5]/.test(numero)) {
    return null;
  }
  return `55${d}`;
}

/** Celular (13 dígitos com 55): é o que dá para chamar no WhatsApp. */
export function ehCelular(telefone: string | null): boolean {
  return telefone !== null && telefone.length === 13;
}

/**
 * WhatsApp dentro de um link: wa.me/55…, api.whatsapp.com/send?phone=…,
 * web.whatsapp.com/send?phone=…, whatsapp://send?phone=…. Devolve o número já
 * normalizado, ou null se o link não é de WhatsApp ou o número não é brasileiro.
 */
export function whatsappDoLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const s = link.trim();
  const wame = s.match(/^(?:https?:\/\/)?(?:www\.)?wa\.me\/\+?(\d{8,15})/i);
  if (wame) return normalizarTelefoneBR(wame[1]);
  const send = s.match(/^(?:https?:\/\/(?:api|web)\.whatsapp\.com|whatsapp:\/)\/send\/?\?(.*)$/i);
  if (send) {
    const phone = new URLSearchParams(send[1]).get("phone");
    return phone ? normalizarTelefoneBR(phone) : null;
  }
  return null;
}

const EMAIL = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
const EXTENSOES_DE_ARQUIVO = /\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf|pdf)$/i;
// Placeholders e serviços que aparecem em HTML de site sem ser contato do negócio.
const DOMINIOS_DE_LIXO = new Set([
  "example.com", "example.org", "domain.com", "email.com", "seuemail.com", "seudominio.com",
  "sentry.io", "sentry.wixpress.com", "wixpress.com", "godaddy.com", "yourdomain.com",
]);

export function emailValido(e: string): boolean {
  if (e.length > 254 || !EMAIL.test(e)) return false;
  if (EXTENSOES_DE_ARQUIVO.test(e)) return false;
  const dominio = e.slice(e.indexOf("@") + 1);
  return !DOMINIOS_DE_LIXO.has(dominio);
}

/** Separa uma célula do tipo "a@x.com, b@y.com" e fica só com os válidos, sem repetir. */
export function emailsDe(texto: string | null | undefined): string[] {
  const out: string[] = [];
  for (const parte of (texto ?? "").split(/[\s,;|]+/)) {
    const e = parte.trim().toLowerCase().replace(/^mailto:/, "").replace(/[.,;:)>\]]+$/, "");
    if (e && emailValido(e) && !out.includes(e)) out.push(e);
  }
  return out;
}
