/**
 * O "+ Adicionar produto" desce em TODO card — inclusive no que ainda não tem
 * `deals`.
 *
 * O DEFEITO QUE ISTO TRAVA
 * ------------------------
 * `deal_items.deal_id` é NOT NULL, então o painel escondia o botão quando a
 * entrada não tinha Negócio, e imprimia *"Este card ainda não tem um negócio
 * aberto — abra um em Novo negócio"*. Medido em prod 2026-09-03: **9.256 de
 * 48.136 entradas (19,2%)** estavam assim, em 35 organizações. Para quem usa, o
 * produto simplesmente não existia naquele card — e o texto mandava para um
 * "Novo negócio" que abre OUTRO card, não o daquele.
 *
 * E não é dívida parada: nos 7 dias até 03/09, **645 cards novos nasceram sem
 * Negócio contra 332 com** (66%), em 27 orgs. Fechar essa torneira é fatia
 * própria (o card devia nascer com Negócio, por ADR-0034 D2); o que ESTE teste
 * guarda é que o painel não volte a esconder o botão.
 *
 * POR QUE ESTÁTICO
 * ----------------
 * A propriedade é da ÁRVORE, não do render: "a prop desce sem condição". Montar
 * o `DealCardPanel` de verdade exigiria `useDealCardData`, org, Supabase e o
 * provider do sheet — caro, e ainda assim provaria só o caso mockado. O modo de
 * falha real é alguém reintroduzir o gate `dealId ? ... : undefined` numa
 * refatoração, e isso se lê na fonte.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Só o código: os comentários CITAM o gate antigo para explicar por que saiu. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("produto em todo Negócio — o botão não volta a sumir", () => {
  it("o painel passa `onAdicionarProduto` SEM condicionar a `dealId`", () => {
    const fonte = semComentarios(ler("src/modules/leads/components/deal-card/DealCardPanel.tsx"));

    // O gate que escondia o botão. Qualquer forma de `onAdicionarProduto={dealId ? ...}`
    // reprova — inclusive `dealIdParaProduto ? ...`, que teria o mesmo efeito.
    expect(fonte).not.toMatch(/onAdicionarProduto=\{\s*deal[A-Za-z]*\s*\?/);
    expect(fonte).toMatch(/onAdicionarProduto=\{\s*adicionarProduto\s*\}/);
  });

  it("materializa o Negócio no clique, em vez de desistir", () => {
    const fonte = semComentarios(ler("src/modules/leads/components/deal-card/DealCardPanel.tsx"));

    expect(fonte).toContain("useGarantirNegocioDaEntrada");

    const hook = semComentarios(ler("src/modules/leads/components/deal-card/useItensDoNegocio.ts"));
    // A RPC é a porta canônica e é IDEMPOTENTE — dois cliques não criam dois
    // Negócios. Trocá-la por `abrir_negocio` criaria um card NOVO, que é outro
    // comportamento e o defeito de volta por outro caminho.
    expect(hook).toContain("garantir_negocio_da_entrada");
    expect(hook).not.toContain('rpc("abrir_negocio"');
  });

  it("não sobra texto mandando o usuário abrir negócio noutra tela", () => {
    const money = ler("src/modules/leads/components/deal-card/DealCardMoney.tsx");
    const renderizado = semComentarios(money);

    // A frase saiu do JSX. O comentário que explica a remoção pode citá-la —
    // por isso a asserção é sobre o código, não sobre o arquivo inteiro.
    expect(renderizado).not.toContain("ainda não tem um negócio aberto");
  });
});
