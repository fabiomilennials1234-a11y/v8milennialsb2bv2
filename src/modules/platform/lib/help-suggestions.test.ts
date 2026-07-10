import { describe, it, expect } from "vitest";
import { helpTopicsForRoute, rankHelpArticles } from "./help-suggestions";

type Article = Parameters<typeof rankHelpArticles>[0][number];

const article = (over: Partial<Article> & { id: string }): Article => ({
  title: "Titulo",
  summary: null,
  tags: [],
  category: { slug: "geral", name: "Geral" },
  ...over,
});

describe("helpTopicsForRoute", () => {
  it("deriva tópicos da rota", () => {
    expect(helpTopicsForRoute("/oportunidades")).toContain("oportunidades");
  });

  it("ignora a query string", () => {
    expect(helpTopicsForRoute("/oportunidades?pipe=whatsapp")).toEqual(
      helpTopicsForRoute("/oportunidades"),
    );
  });

  it("usa o primeiro segmento, não o id", () => {
    expect(helpTopicsForRoute("/leads/9f8a-1234")).toContain("leads");
    expect(helpTopicsForRoute("/leads/9f8a-1234")).not.toContain("9f8a-1234");
  });

  // Sem isto, o painel aberto na home sugeriria artigos de uma rota chamada "".
  it("a raiz não produz tópico vazio", () => {
    expect(helpTopicsForRoute("/")).not.toContain("");
    expect(helpTopicsForRoute("")).not.toContain("");
  });

  it("acrescenta sinônimos conhecidos da rota", () => {
    const topics = helpTopicsForRoute("/oportunidades");
    expect(topics).toContain("funil");
    expect(topics).toContain("kanban");
  });

  it("uma rota desconhecida devolve só o próprio segmento", () => {
    expect(helpTopicsForRoute("/rota-que-nao-existe")).toEqual(["rota-que-nao-existe"]);
  });
});

describe("rankHelpArticles — busca", () => {
  const artigos = [
    article({ id: "a", title: "Por que um lead não aparece no kanban?" }),
    article({ id: "b", title: "Configurar estágios do funil" }),
    article({ id: "c", title: "Como o Copilot qualifica um lead", summary: "kanban e estágios" }),
  ];

  it("casa no título, sem diferenciar maiúsculas", () => {
    expect(rankHelpArticles(artigos, { query: "KANBAN", pathname: "/" }).map((a) => a.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("casa no resumo", () => {
    expect(rankHelpArticles(artigos, { query: "estágios", pathname: "/" }).map((a) => a.id)).toContain(
      "c",
    );
  });

  it("casa nas tags", () => {
    const comTag = [article({ id: "z", title: "Nada a ver", tags: ["cobranca"] })];
    expect(rankHelpArticles(comTag, { query: "cobranca", pathname: "/" })).toHaveLength(1);
  });

  // Um usuário digitando "não aparece" não deveria depender do acento.
  it("ignora acentos dos dois lados", () => {
    expect(rankHelpArticles(artigos, { query: "estagios", pathname: "/" }).map((a) => a.id)).toContain(
      "b",
    );
    expect(rankHelpArticles(artigos, { query: "nao aparece", pathname: "/" }).map((a) => a.id)).toEqual(
      ["a"],
    );
  });

  it("uma busca sem resultado devolve vazio, não um fallback", () => {
    expect(rankHelpArticles(artigos, { query: "zzzzz", pathname: "/oportunidades" })).toEqual([]);
  });

  it("uma busca curta demais é tratada como ausente", () => {
    expect(rankHelpArticles(artigos, { query: "ka", pathname: "/" })).toHaveLength(3);
  });
});

describe("rankHelpArticles — sugestão por rota", () => {
  const artigos = [
    article({ id: "funil", title: "Estágios", category: { slug: "oportunidades", name: "Funil" } }),
    article({ id: "tag", title: "Tags", tags: ["leads"] }),
    article({ id: "outro", title: "Cobrança", category: { slug: "billing", name: "Billing" } }),
  ];

  it("prioriza o artigo cuja categoria casa a rota", () => {
    expect(rankHelpArticles(artigos, { pathname: "/oportunidades" })[0].id).toBe("funil");
  });

  it("prioriza o artigo cuja tag casa a rota", () => {
    expect(rankHelpArticles(artigos, { pathname: "/leads" })[0].id).toBe("tag");
  });

  // O painel abre em qualquer tela. Sem artigo relacionado, mostrar os que
  // existem é melhor que mostrar nada — mas nunca inventar relevância.
  it("sem casamento, devolve os artigos na ordem recebida", () => {
    expect(rankHelpArticles(artigos, { pathname: "/rota-orfa" }).map((a) => a.id)).toEqual([
      "funil",
      "tag",
      "outro",
    ]);
  });

  it("respeita o limite", () => {
    expect(rankHelpArticles(artigos, { pathname: "/", limit: 2 })).toHaveLength(2);
  });

  // Corpus vazio é o estado atual em produção: zero categorias, zero artigos.
  it("um corpus vazio devolve vazio, e não lança", () => {
    expect(rankHelpArticles([], { pathname: "/oportunidades" })).toEqual([]);
    expect(rankHelpArticles([], { query: "kanban", pathname: "/" })).toEqual([]);
  });
});
