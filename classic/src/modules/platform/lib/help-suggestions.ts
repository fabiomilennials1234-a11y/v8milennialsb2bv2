/**
 * help-suggestions — a camada de deflexão do Chamado (ADR-0018).
 *
 * Ajuda antes de humano: todo vendor estudado front-loada artigo antes do
 * contato. Aqui isso é busca e sugestão por rota, sem IA — 30 organizações não
 * pagam um LLM, e um bot ruim entre o cliente e a Torque custa mais confiança do
 * que economiza hora.
 *
 * Lógica pura: sem React, sem rede, sem Supabase. Os artigos já vieram.
 */

export interface RankableArticle {
  id: string;
  title: string;
  summary: string | null;
  tags: string[];
  category: { slug: string; name: string } | null;
}

/** Menos que isto e a busca casa quase tudo. */
const MIN_QUERY = 3;
const DEFAULT_LIMIT = 3;

/**
 * Sinônimos que o usuário conhece pela tela, mas que a categoria não usa.
 * Quem está no funil pensa "kanban", não "oportunidades".
 */
const ROUTE_SYNONYMS: Record<string, string[]> = {
  oportunidades: ["funil", "kanban", "pipeline"],
  orcamentos: ["proposta", "orcamento", "fechamento"],
  leads: ["lead", "contato"],
  carteira: ["cliente", "pos-venda", "upsell"],
  copilot: ["agente", "ia", "copiloto"],
  automacoes: ["workflow", "automacao"],
  campanhas: ["campanha", "disparo"],
  agenda: ["reuniao", "agendamento"],
  configuracoes: ["pitstop", "configuracao"],
  equipe: ["time", "membro", "permissao"],
};

/** Remove acento e caixa: quem digita "estagios" quer achar "estágios". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Os tópicos que a rota sugere. O primeiro segmento é o assunto; um id na URL
 * não é.
 */
export function helpTopicsForRoute(pathname: string): string[] {
  const segment = pathname.split("?")[0].split("/").filter(Boolean)[0];
  if (!segment) return [];

  const key = fold(segment);
  return [key, ...(ROUTE_SYNONYMS[key] ?? [])];
}

function haystack(article: RankableArticle): string {
  return fold(
    [article.title, article.summary ?? "", article.tags.join(" "), article.category?.name ?? ""].join(
      " ",
    ),
  );
}

function matchesTopic(article: RankableArticle, topics: string[]): boolean {
  const slug = fold(article.category?.slug ?? "");
  const tags = article.tags.map(fold);
  return topics.some((t) => slug === t || tags.includes(t));
}

export interface RankOptions {
  pathname: string;
  query?: string;
  limit?: number;
}

/**
 * Com busca, filtra — e devolve vazio quando nada casa. Um "resultado" que não
 * casou a busca é ruído travestido de ajuda.
 *
 * Sem busca, sugere pela rota: primeiro os artigos cuja categoria ou tag casa o
 * assunto da tela, depois os demais, na ordem em que vieram. Nunca inventa
 * relevância.
 */
export function rankHelpArticles<T extends RankableArticle>(
  articles: T[],
  { pathname, query, limit = DEFAULT_LIMIT }: RankOptions,
): T[] {
  const q = fold((query ?? "").trim());

  if (q.length >= MIN_QUERY) {
    return articles.filter((a) => haystack(a).includes(q)).slice(0, limit);
  }

  const topics = helpTopicsForRoute(pathname);
  if (topics.length === 0) return articles.slice(0, limit);

  const related = articles.filter((a) => matchesTopic(a, topics));
  const rest = articles.filter((a) => !matchesTopic(a, topics));

  return [...related, ...rest].slice(0, limit);
}
