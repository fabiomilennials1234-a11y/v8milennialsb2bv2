import { NEGOCIO_PARAM, caminhoDoNegocio, negocioDaUrl, semNegocio } from "./negocio-no-funil";

const FUNIL = "8106f2dc-e13b-4aaa-8058-05034c1e239a";
const NEGOCIO = "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f";

describe("caminhoDoNegocio", () => {
  it("leva ao board do funil pelo UUID, com o negócio no parâmetro", () => {
    expect(caminhoDoNegocio({ pipelineId: FUNIL, entryId: NEGOCIO })).toBe(
      `/funil/${FUNIL}?${NEGOCIO_PARAM}=${NEGOCIO}`,
    );
  });

  it("o board lê de volta exatamente o negócio pedido", () => {
    const url = new URL(caminhoDoNegocio({ pipelineId: FUNIL, entryId: NEGOCIO }), "https://torquecrm.com.br");
    expect(url.pathname).toBe(`/funil/${FUNIL}`);
    expect(negocioDaUrl(url.searchParams)).toBe(NEGOCIO);
  });
});

describe("negocioDaUrl", () => {
  it("sem o parâmetro, não há negócio pedido", () => {
    expect(negocioDaUrl(new URLSearchParams("view=abc"))).toBeNull();
  });

  it("valor que não é UUID é ignorado — nada chega ao banco", () => {
    expect(negocioDaUrl(new URLSearchParams("negocio=1"))).toBeNull();
    expect(negocioDaUrl(new URLSearchParams("negocio="))).toBeNull();
    expect(negocioDaUrl(new URLSearchParams(`negocio=${NEGOCIO}x`))).toBeNull();
    expect(negocioDaUrl(new URLSearchParams("negocio=%22%5D%20*"))).toBeNull();
  });

  it("normaliza para minúsculas: o card no DOM carrega o id como o banco o devolve", () => {
    expect(negocioDaUrl(new URLSearchParams(`negocio=${NEGOCIO.toUpperCase()}`))).toBe(NEGOCIO);
  });
});

describe("semNegocio", () => {
  it("tira só o pedido do negócio e preserva o resto da busca", () => {
    const antes = new URLSearchParams(`view=v1&${NEGOCIO_PARAM}=${NEGOCIO}`);
    const depois = semNegocio(antes);
    expect(depois.get(NEGOCIO_PARAM)).toBeNull();
    expect(depois.get("view")).toBe("v1");
    // Não muta a busca recebida.
    expect(antes.get(NEGOCIO_PARAM)).toBe(NEGOCIO);
  });
});
