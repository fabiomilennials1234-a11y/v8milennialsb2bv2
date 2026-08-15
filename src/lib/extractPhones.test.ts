import { describe, it, expect } from "vitest";

import { extractPhoneCandidates } from "./extractPhones";

/**
 * O extrator lê texto que a pessoa digitou no chat (Instagram, WhatsApp) e
 * devolve os telefones que ela mencionou, já normalizados para casar com
 * `leads.normalized_phone`, junto do trecho cru — a evidência que o vendedor
 * confere na tela.
 */
describe("extractPhoneCandidates — celular em formato humano", () => {
  it("extrai celular com DDD entre parênteses e hífen", () => {
    const found = extractPhoneCandidates("pode chamar no (11) 98765-4321 que eu respondo");

    expect(found).toHaveLength(1);
    expect(found[0].normalized).toBe("11987654321");
    expect(found[0].raw).toBe("(11) 98765-4321");
  });

  it("extrai celular com código do país", () => {
    const found = extractPhoneCandidates("meu zap: +55 11 98765-4321");

    expect(found).toHaveLength(1);
    expect(found[0].normalized).toBe("11987654321");
    expect(found[0].raw).toBe("+55 11 98765-4321");
  });

  it("extrai celular escrito só em dígitos", () => {
    const found = extractPhoneCandidates("anota 11987654321");

    expect(found).toHaveLength(1);
    expect(found[0].normalized).toBe("11987654321");
    expect(found[0].raw).toBe("11987654321");
  });

  it("extrai celular com o nono dígito separado", () => {
    const found = extractPhoneCandidates("é 11 9 8765-4321");

    expect(found).toHaveLength(1);
    expect(found[0].normalized).toBe("11987654321");
  });

  it("devolve os dois telefones quando a mensagem traz dois", () => {
    const found = extractPhoneCandidates("fixo (11) 3456-7890 e o cel (21) 99876-5432");

    expect(found.map((c) => c.normalized)).toEqual(["11934567890", "21998765432"]);
  });

  it("não repete o mesmo telefone escrito de duas formas", () => {
    const found = extractPhoneCandidates("11987654321 — ou (11) 98765-4321 se preferir");

    expect(found).toHaveLength(1);
    expect(found[0].raw).toBe("11987654321");
  });

  it("devolve vazio para texto sem telefone", () => {
    expect(extractPhoneCandidates("oi, tudo bem? quero saber o preço")).toEqual([]);
  });

  it("devolve vazio para entrada nula ou vazia", () => {
    expect(extractPhoneCandidates(null)).toEqual([]);
    expect(extractPhoneCandidates(undefined)).toEqual([]);
    expect(extractPhoneCandidates("")).toEqual([]);
  });
});

/**
 * O ICP (fábricas e distribuidoras B2B) manda documento, valor e código no
 * chat o tempo todo. Cada falso positivo aqui vira uma sugestão de duplicata
 * errada na cara do vendedor — o extrator tem de ser conservador.
 */
describe("extractPhoneCandidates — o que NÃO é telefone", () => {
  it("ignora CNPJ formatado", () => {
    expect(extractPhoneCandidates("nosso CNPJ é 12.345.678/0001-95")).toEqual([]);
  });

  it("ignora CNPJ só em dígitos", () => {
    expect(extractPhoneCandidates("CNPJ 12345678000195")).toEqual([]);
  });

  it("ignora CPF formatado", () => {
    expect(extractPhoneCandidates("meu CPF: 123.456.789-09")).toEqual([]);
  });

  it("ignora CPF só em dígitos — tem 11 dígitos, igual a celular", () => {
    expect(extractPhoneCandidates("CPF 12345678909")).toEqual([]);
  });

  it("ignora CEP", () => {
    expect(extractPhoneCandidates("CEP 01310-100, Av Paulista")).toEqual([]);
  });

  it("ignora valor em reais", () => {
    expect(extractPhoneCandidates("fecha em R$ 12.345,67 à vista")).toEqual([]);
    expect(extractPhoneCandidates("orçamento de R$ 1.234.567,89")).toEqual([]);
  });

  it("ignora data", () => {
    expect(extractPhoneCandidates("entrega 12/08/2026")).toEqual([]);
    expect(extractPhoneCandidates("reunião dia 12-08-2026 às 14:30")).toEqual([]);
  });

  it("ignora código de pedido / nota fiscal", () => {
    expect(extractPhoneCandidates("pedido 123456789012345678")).toEqual([]);
  });

  it("ignora DDD que não existe no Brasil", () => {
    expect(extractPhoneCandidates("o número 30 98765-4321")).toEqual([]);
    expect(extractPhoneCandidates("23987654321")).toEqual([]);
  });

  it("ignora celular de 11 dígitos que não começa com 9 depois do DDD", () => {
    expect(extractPhoneCandidates("11887654321")).toEqual([]);
  });

  it("ignora número com um dígito a mais", () => {
    expect(extractPhoneCandidates("11 9 98765-4321")).toEqual([]);
  });

  it("ignora telefone com dígito sobrando grudado no fim", () => {
    expect(extractPhoneCandidates("(11) 98765-43210")).toEqual([]);
  });

  it("ignora telefone com dígito sobrando grudado no começo", () => {
    expect(extractPhoneCandidates("111 98765-4321")).toEqual([]);
  });

  it("ignora dígito repetido", () => {
    expect(extractPhoneCandidates("teste 99999999999")).toEqual([]);
  });

  it("ignora fixo com prefixo impossível", () => {
    expect(extractPhoneCandidates("(11) 0123-4567")).toEqual([]);
  });
});

/**
 * `normalize_brazilian_phone` (e o espelho TS `normalizePhone`) enfia um `9`
 * em QUALQUER número de 10 dígitos. Um fixo vira um celular que talvez não
 * exista — e pode colidir com o celular de outra pessoa. O candidato precisa
 * carregar essa marca para o consumidor exigir evidência mais forte.
 */
describe("extractPhoneCandidates — fixo vira celular na normalização", () => {
  it("marca o candidato quando o nono dígito foi inventado", () => {
    const [fixo] = extractPhoneCandidates("liga no (11) 3456-7890");

    expect(fixo.normalized).toBe("11934567890");
    expect(fixo.raw).toBe("(11) 3456-7890");
    expect(fixo.inferredNinthDigit).toBe(true);
  });

  it("diz que o número digitado era de fixo — é isso que torna a colisão possível", () => {
    const [fixo] = extractPhoneCandidates("liga no (11) 3456-7890");

    expect(fixo.kind).toBe("landline");
  });

  it("não marca o candidato quando o número já tinha o nono dígito", () => {
    const [cel] = extractPhoneCandidates("(11) 98765-4321");

    expect(cel.inferredNinthDigit).toBe(false);
    expect(cel.kind).toBe("mobile");
  });

  it("não marca quando veio com código do país e nono dígito", () => {
    const [cel] = extractPhoneCandidates("5511987654321");

    expect(cel.normalized).toBe("11987654321");
    expect(cel.inferredNinthDigit).toBe(false);
  });
});

/**
 * Celular escrito no formato antigo (DDD + 8 dígitos começando em 8 ou 9) é
 * comum em base importada e em quem digita de cabeça. Fixo nunca começa em 8
 * ou 9 — então aqui o `9` que a normalização insere reconstrói o número atual
 * de verdade, e não há colisão com terceiro.
 */
describe("extractPhoneCandidates — celular no formato antigo", () => {
  it("aceita celular antigo começando em 9", () => {
    const [cel] = extractPhoneCandidates("meu número é 11 9876-5432");

    expect(cel.normalized).toBe("11998765432");
    expect(cel.kind).toBe("mobile");
    expect(cel.inferredNinthDigit).toBe(true);
  });

  it("aceita celular antigo começando em 8", () => {
    const [cel] = extractPhoneCandidates("(21) 8876-5432");

    expect(cel.normalized).toBe("21988765432");
    expect(cel.kind).toBe("mobile");
  });
});

/** Guardas de regressão para o que já chega do chat hoje. */
describe("extractPhoneCandidates — formatos que o chat produz", () => {
  it("extrai número colado no parêntese, sem espaço", () => {
    expect(extractPhoneCandidates("(11)98765-4321")[0].normalized).toBe("11987654321");
  });

  it("extrai número separado por ponto", () => {
    expect(extractPhoneCandidates("11.98765-4321")[0].normalized).toBe("11987654321");
  });

  it("extrai número colado em emoji", () => {
    const [cel] = extractPhoneCandidates("meu whats é 11987654321📱");

    expect(cel.normalized).toBe("11987654321");
    expect(cel.raw).toBe("11987654321");
  });

  it("extrai o telefone de dentro de um JID do WhatsApp", () => {
    expect(extractPhoneCandidates("5511987654321@s.whatsapp.net")[0].normalized).toBe(
      "11987654321",
    );
  });

  it("extrai números em linhas diferentes", () => {
    const found = extractPhoneCandidates("comercial: (11) 98765-4321\nsuporte: (21) 99876-5432");

    expect(found.map((c) => c.normalized)).toEqual(["11987654321", "21998765432"]);
  });

  it("ignora 0800", () => {
    expect(extractPhoneCandidates("central 0800 771 7000")).toEqual([]);
  });

  it("ignora telefone de outro país", () => {
    expect(extractPhoneCandidates("escritório US: +1 415 555 2671")).toEqual([]);
  });
});
