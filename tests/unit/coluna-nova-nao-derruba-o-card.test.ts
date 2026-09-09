import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Coluna que ainda não existe em prod não pode derrubar a tela.
 *
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 *
 * `deals.outcome` nasce na migration `20270904000000`, aplicada DEPOIS do merge
 * do front — é a ordem normal do repo, não um acidente. Entre um e outro, o
 * PostgREST responde `42703` / `PGRST204` para qualquer projeção que peça a
 * coluna.
 *
 * A primeira versão de `useLeadsDeals` pedia `select("id, title, outcome")` numa
 * consulta só, com `if (dealsError) throw dealsError` logo abaixo. O efeito não
 * era "o desfecho não aparece": era a query `leads-deals` inteira falhando, e o
 * CARD sumindo da tela em 107 organizações — por causa de uma coluna opcional.
 *
 * A regra, então: campo OBRIGATÓRIO e campo que depende de migration pendente
 * não viajam na mesma projeção. O obrigatório pode estourar; o opcional degrada.
 *
 * POR QUE ASSERÇÃO SOBRE A FONTE
 *
 * O caminho que quebra só existe contra um banco SEM a coluna. Depois do apply
 * ele deixa de ser alcançável em teste — e é justamente aí que alguém junta as
 * duas projeções de novo "para economizar uma ida ao banco", sem nada reclamar.
 * Mesmo espírito de `role-vocabulary.test.ts` e
 * `pipe-whatsapp-espelho-sem-leitores.test.ts`.
 */

const RAIZ = resolve(__dirname, "../..");

function ler(caminho: string): string {
  return readFileSync(resolve(RAIZ, caminho), "utf8");
}

/** Colunas que só existem depois de uma migration ainda pendente em prod. */
const COLUNAS_PENDENTES = ["outcome", "outcome_at", "outcome_source", "requires_sale_value"];

describe("coluna nova não derruba o card", () => {
  const fonte = ler("src/modules/leads/hooks/useLeadsDeals.ts");

  it("nenhuma projeção mistura coluna pendente com campo obrigatório", () => {
    // Todo `.select("...")` do arquivo, com as aspas já removidas.
    const projecoes = [...fonte.matchAll(/\.select\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(projecoes.length).toBeGreaterThan(0);

    for (const projecao of projecoes) {
      const campos = projecao.split(",").map((c) => c.trim());
      const pendentes = campos.filter((c) => COLUNAS_PENDENTES.includes(c));
      if (pendentes.length === 0) continue;

      // A projeção que carrega coluna pendente só pode carregar a chave junto —
      // ela existe para o join, não para trazer dado obrigatório.
      const acompanhantes = campos.filter((c) => !COLUNAS_PENDENTES.includes(c));
      expect(
        acompanhantes,
        `projeção "${projecao}" mistura ${pendentes.join("/")} com campo obrigatório. ` +
          `Se a migration não rodou, o PostgREST reprova a projeção INTEIRA e o card some. ` +
          `Separe em duas consultas: a obrigatória pode estourar, a opcional degrada.`,
      ).toEqual(["id"]);
    }
  });

  it("a leitura da coluna pendente tolera migration ausente", () => {
    // O `throw` do caminho obrigatório é legítimo. O do opcional não pode
    // existir: é ele que apagaria o card.
    expect(
      fonte.includes("isMissingSchemaError"),
      "useLeadsDeals lê coluna pendente sem tratar migration ausente — " +
        "importe isMissingSchemaError de @/lib/rpc-errors",
    ).toBe(true);
  });

  it("o botão de desfecho degrada em vez de erro cru quando a RPC não existe", () => {
    const painel = ler("src/modules/leads/components/deal-card/DealCardPanel.tsx");

    expect(painel).toContain("definir_desfecho_da_entrada");
    // Sem este ramo, os 113 funis que TINHAM etapa terminal fechavam negócio
    // ontem e parariam hoje — regressão pura enquanto a migration não roda.
    expect(
      painel.includes("isMissingSchemaError"),
      "DealCardPanel chama a RPC de desfecho sem degradar quando ela não existe",
    ).toBe(true);
  });
});
