/**
 * Qualidade do contato (`lista_fria_resultados.qualidade`).
 *
 * "Verificado" aqui quer dizer VALIDADO NO FORMATO, não "confirmado por quem
 * atende": telefone celular brasileiro plausível, ou e-mail cujo domínio recebe
 * e-mail (registro MX). Não consulta WhatsApp nem manda nada. Checar se o número
 * tem WhatsApp exige uma instância conectada da própria org, e fica para depois.
 */
import dns from "node:dns/promises";

export type Qualidade = "verificado" | "sem_whatsapp" | "email_invalido" | "nao_verificado";

export type ResolverMx = (dominio: string) => Promise<boolean>;

/** Domínio com MX (ou, sem MX, com A/AAAA: RFC 5321 aceita). Erro de rede conta como "não sei". */
export function mxPelaRede(): ResolverMx {
  const cache = new Map<string, Promise<boolean>>();
  return (dominio) => {
    const d = dominio.toLowerCase();
    let p = cache.get(d);
    if (!p) {
      p = (async () => {
        try {
          const mx = await dns.resolveMx(d);
          if (mx.length > 0) return true;
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code;
          // Falha transitória: não condena o e-mail por problema nosso.
          if (code !== "ENOTFOUND" && code !== "ENODATA") return true;
        }
        try {
          return (await dns.resolve4(d)).length > 0;
        } catch {
          return false;
        }
      })();
      cache.set(d, p);
    }
    return p;
  };
}

export async function qualidadeDoContato(
  c: { telefone: string | null; email: string | null; celular: boolean },
  mx: ResolverMx,
): Promise<Qualidade> {
  const emailOk = c.email ? await mx(c.email.slice(c.email.indexOf("@") + 1)) : null;
  if (c.celular || emailOk === true) return "verificado";
  if (c.email && emailOk === false && !c.telefone) return "email_invalido";
  return "nao_verificado";
}
