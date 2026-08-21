/**
 * Derives the Uazapi managed-proxy region from the instance's own phone number
 * (#1477, PRD #1472).
 *
 * Why this exists
 * ---------------
 * Measured in production 2026-08-07: the Uazapi platform already places every
 * instance on its managed proxy pool (`mode=internal`,
 * `effective_detail=managed_pool` on 10/10 instances sampled across 8 orgs and 8
 * DDDs) — but `proxy_managed_city` is EMPTY on 10/10. The proxy exists and nobody
 * chose where it exits from. A number with DDD 47 may be talking through an IP
 * from anywhere, and geographic incoherence between number and IP is a known
 * automation signal for WhatsApp. ADR-0015 attacked the same ban risk from the
 * daily-volume side; this attacks it from the IP-coherence side.
 *
 * Granularity is STATE, deliberately
 * ----------------------------------
 * `DDD → UF` is deterministic: every DDD belongs to exactly one federative unit.
 * `DDD → city` is NOT (DDD 21 covers the whole Rio metro area; DDD 47 covers
 * Joinville and Blumenau, not the capital). So the honest unit is the state, and
 * the city is merely the vehicle the Uazapi API requires to express it — their
 * `POST /instance/connect` accepts `proxy_managed_city`, not a state alone.
 *
 * Selling city-level precision would be theatre: there is no endpoint that
 * reveals the egress IP (`proxy_url` comes back as `managed_pool://hidden`), so
 * nobody can verify whether the exit is in Joinville or Florianópolis.
 *
 * These tables are national facts, not configuration — hence hardcoded here and
 * not in the database. The city SLUG, by contrast, always comes from the live
 * catalog (`GET /proxy-managed/cities`), so a rename on their side cannot break
 * us.
 */

/** Every valid Brazilian area code, mapped to its federative unit. */
export const DDD_TO_UF: Record<string, string> = {
  // São Paulo
  "11": "sp", "12": "sp", "13": "sp", "14": "sp", "15": "sp",
  "16": "sp", "17": "sp", "18": "sp", "19": "sp",
  // Rio de Janeiro
  "21": "rj", "22": "rj", "24": "rj",
  // Espírito Santo
  "27": "es", "28": "es",
  // Minas Gerais
  "31": "mg", "32": "mg", "33": "mg", "34": "mg",
  "35": "mg", "37": "mg", "38": "mg",
  // Paraná
  "41": "pr", "42": "pr", "43": "pr", "44": "pr", "45": "pr", "46": "pr",
  // Santa Catarina
  "47": "sc", "48": "sc", "49": "sc",
  // Rio Grande do Sul
  "51": "rs", "53": "rs", "54": "rs", "55": "rs",
  // Centro-Oeste
  "61": "df",
  "62": "go", "64": "go",
  "63": "to",
  "65": "mt", "66": "mt",
  "67": "ms",
  // Norte
  "68": "ac",
  "69": "ro",
  "91": "pa", "93": "pa", "94": "pa",
  "92": "am", "97": "am",
  "95": "rr",
  "96": "ap",
  // Nordeste
  "71": "ba", "73": "ba", "74": "ba", "75": "ba", "77": "ba",
  "79": "se",
  "81": "pe", "87": "pe",
  "82": "al",
  "83": "pb",
  "84": "rn",
  "85": "ce", "88": "ce",
  "86": "pi", "89": "pi",
  "98": "ma", "99": "ma",
};

/** Capital city of each federative unit, as the preferred exit for that state. */
export const UF_CAPITAL: Record<string, string> = {
  ac: "Rio Branco",
  al: "Maceió",
  am: "Manaus",
  ap: "Macapá",
  ba: "Salvador",
  ce: "Fortaleza",
  df: "Brasília",
  es: "Vitória",
  go: "Goiânia",
  ma: "São Luís",
  mg: "Belo Horizonte",
  ms: "Campo Grande",
  mt: "Cuiabá",
  pa: "Belém",
  pb: "João Pessoa",
  pe: "Recife",
  pi: "Teresina",
  pr: "Curitiba",
  rj: "Rio de Janeiro",
  rn: "Natal",
  ro: "Porto Velho",
  rr: "Boa Vista",
  rs: "Porto Alegre",
  sc: "Florianópolis",
  se: "Aracaju",
  sp: "São Paulo",
  to: "Palmas",
};

/** One entry of `GET /proxy-managed/cities`. */
export interface CatalogCity {
  /** Slug accepted in `proxy_managed_city`. Authoritative — never hardcode it. */
  value: string;
  label: string;
  /** ISO 3166-2 subdivision, when the provider enriches it. */
  state?: string;
}

/** Fields appended to `POST /instance/connect`. */
export interface ManagedRegion {
  proxy_managed_country: string;
  proxy_managed_state: string;
  proxy_managed_city: string;
}

/** Accent- and case-insensitive comparison key for city names. */
function nameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Federative unit of a Brazilian number, or null when it cannot be determined.
 *
 * Accepts punctuation and both mobile (11 digits after +55) and landline
 * (10 digits) lengths. Anything that is not an unambiguous Brazilian number
 * returns null — guessing a region is worse than sending none.
 */
export function ufFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  const digits = String(phone).replace(/\D/g, "");
  // 55 + DDD(2) + subscriber(8 or 9)
  if (!/^55\d{10,11}$/.test(digits)) return null;

  return DDD_TO_UF[digits.slice(2, 4)] ?? null;
}

/**
 * Resolve the region to send on connect, or null to send nothing.
 *
 * Returning null is a first-class outcome: the connection then behaves exactly
 * as it does today. A failure to derive must never cost a connection.
 */
export function resolveManagedRegion(input: {
  phone: string | null | undefined;
  catalog: CatalogCity[] | null | undefined;
}): ManagedRegion | null {
  const uf = ufFromPhone(input.phone);
  if (!uf) return null;

  const inUf = (input.catalog ?? []).filter(
    (c) => c.state && c.state.toLowerCase() === uf && c.value
  );
  if (inUf.length === 0) return null;

  const capitalKey = nameKey(UF_CAPITAL[uf] ?? "");
  const capital = inUf.find((c) => nameKey(c.label ?? "") === capitalKey);

  // Capital absent from the catalog → any city of the right state still carries
  // the state, which is the unit that actually matters.
  const chosen = capital ?? inUf[0];

  return {
    proxy_managed_country: "br",
    proxy_managed_state: uf,
    proxy_managed_city: chosen.value,
  };
}
