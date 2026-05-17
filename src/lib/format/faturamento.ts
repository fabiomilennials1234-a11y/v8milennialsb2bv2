/**
 * Normaliza o campo `leads.faturamento` (texto livre vindo de form/Meta Ads)
 * pra exibição legível.
 *
 * Inputs comuns observados:
 *   "+1_milhão."              → "Mais de R$ 1 milhão"
 *   "r$100_mil_a_r$150_mil"   → "R$ 100 mil – R$ 150 mil"
 *   "r$250_mil_a_r$500_mil"   → "R$ 250 mil – R$ 500 mil"
 *   "ate_50_mil"              → "Até R$ 50 mil"
 *   "menos_de_30_mil"         → "Menos de R$ 30 mil"
 *   "500"                     → "R$ 500"
 *   1500000                   → "R$ 1.500.000"
 *
 * Se for numérico, usa Intl. Se for string, normaliza tokens.
 */
export function formatFaturamento(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";

  // Numérico → moeda
  if (typeof value === "number" || /^\d+([.,]\d+)?$/.test(String(value).trim())) {
    const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (Number.isFinite(num)) {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(num);
    }
  }

  let s = String(value).trim();
  if (!s) return "—";

  // Trim pontuação final repetida
  s = s.replace(/[.\s]+$/g, "");

  // Lowercase tudo e aplica substituições em ordem
  s = s.toLowerCase();

  // Substitui "r$" → token estável, espaço normalizado depois
  s = s.replace(/r\$\s*/g, "R$ ");

  // Separa intervalos: "_a_" / " a " / "-" entre quantidades
  s = s.replace(/_a_/g, " – ");

  // Prefixos
  s = s.replace(/^\+\s*/, "Mais de ");
  s = s.replace(/^ate[_\s]+/, "Até ");
  s = s.replace(/^menos[_\s]+de[_\s]+/, "Menos de ");
  s = s.replace(/^mais[_\s]+de[_\s]+/, "Mais de ");

  // Unifica underscores restantes em espaços
  s = s.replace(/_/g, " ");

  // Garante "R$ " antes de números puros (quando não havia r$ no início e não é texto "mil"/"milhão" puro)
  s = s.replace(/(^|[\s–])(\d+(?:[.,]\d+)?)(?=\s+(mil|milhão|milhões|milhao|milhoes|bi|bilhão|bilhões))/gi,
    (_m, pre: string, num: string) => `${pre}R$ ${num}`);

  // Casing: capitaliza primeira letra de cada palavra começo, mantém R$ ok
  // Garante "Mais de" / "Até" capitalizados (já feito acima). Demais palavras lowercase exceto R$.
  s = s.replace(/\s+/g, " ").trim();

  // Capitaliza primeira letra global
  if (s.length > 0 && s[0] !== "R") {
    s = s[0].toUpperCase() + s.slice(1);
  }

  // Normaliza variações: "milhao" → "milhão", "milhoes" → "milhões"
  s = s.replace(/\bmilhao\b/gi, "milhão");
  s = s.replace(/\bmilhoes\b/gi, "milhões");
  s = s.replace(/\bbilhao\b/gi, "bilhão");
  s = s.replace(/\bbilhoes\b/gi, "bilhões");

  return s;
}
