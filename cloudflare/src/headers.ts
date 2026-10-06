/**
 * Headers das respostas geradas pelo Worker. Os valores moram em
 * `cloudflare/headers.json` (espelho do Dockerfile); aqui só se aplica.
 *
 * Tudo com `Headers.set`, que SUBSTITUI. Nunca `append`: um header repetido
 * vira lista separada por vírgula, e duas CSPs juntas valem pela interseção —
 * a página quebra sem ninguém ter mudado política nenhuma.
 */
import config from "../headers.json";

export type Profile = "app" | "lp";

export const PROFILES: Readonly<Record<Profile, Readonly<Record<string, string>>>> = config.profiles;

export const CACHE = config.cache;

export const ROBOTS_HEADER = "X-Robots-Tag";
export const ROBOTS_VALUE = "noindex, nofollow";

/** Cópia mutável da resposta, com o perfil e o Cache-Control impostos. */
export function applyProfile(response: Response, profile: Profile, cacheControl: string): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(PROFILES[profile])) out.headers.set(name, value);
  out.headers.set("Cache-Control", cacheControl);
  return out;
}

/**
 * Completa o que faltar, sem tocar no que veio (Div9). Para a resposta da API:
 * a CSP da function é mais estrita que a do app e continua sendo a única.
 */
export function addIfAbsent(headers: Headers, profile: Profile): void {
  for (const [name, value] of Object.entries(PROFILES[profile])) {
    if (!headers.has(name)) headers.set(name, value);
  }
}
