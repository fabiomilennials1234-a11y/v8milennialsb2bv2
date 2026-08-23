import { Package, Plus, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { DealCardItem } from "./types";
import { contaDoNegocio } from "./conta-do-negocio";

/**
 * "Produtos e Valores" — o bloco de dinheiro do negócio, no formato do print.
 *
 * ── O QUE O PRINT PEDE E O BANCO NÃO TEM ──────────────────────────────────
 * O DataCrazy fecha o bloco com três linhas — Desconto (−), Acréscimo (+) e
 * Frete (+) — e um Total. No Torque, das três só o **Desconto** tem lastro:
 * `deal_items.discount_percent` existe por item desde a Wave 1, então o
 * desconto do negócio é a soma do que cada item abateu. **Acréscimo e Frete
 * não existem em coluna nenhuma** (o único `frete` do schema mora em
 * `org_unit_economics_inputs`, que é configuração de unit economics e nada tem
 * a ver com negócio), e por decisão do dono do produto em 21/08 este bloco sai
 * **sem migration**: linha que não pode ser preenchida não entra.
 *
 * A ausência é dita, não escondida — desenhar "Frete R$ 0,00" travado seria
 * afirmar que o negócio tem frete zero, quando a verdade é que o Torque não
 * guarda frete.
 *
 * ── O TOTAL NÃO É `deals.value` ───────────────────────────────────────────
 * Quando há itens, o total é a soma deles, que é o número que confere com a
 * lista logo acima. `deals.value` é campo digitado à mão e pode divergir; ele
 * aparece como Valor Total no ladrilho do topo, que é onde ele é a resposta
 * certa. Sem itens, o bloco cai para `deals.value` e diz de onde tirou.
 */

function Linha({
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  tom,
}: {
  icone: typeof Tag;
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: "abate";
}) {
  return (
    <div className="flex items-baseline gap-3 py-[7px]">
      <span className="flex items-center gap-2 text-[13px] text-foreground/85">
        <Icone
          className={cn("size-[15px] shrink-0", tom === "abate" ? "text-amber-400" : "text-muted-foreground")}
          aria-hidden="true"
        />
        {rotulo}
      </span>
      {detalhe && <span className="truncate text-[11.5px] text-muted-foreground/70">{detalhe}</span>}
      <span
        className={cn(
          "ml-auto shrink-0 text-[13px] tabular-nums",
          tom === "abate" ? "text-amber-400" : "text-foreground",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

export function DealCardMoney({
  itens,
  valorDoNegocio,
  valorDoFunil,
  onAdicionarProduto,
}: {
  itens: DealCardItem[];
  /** `deals.value` — o valor digitado. Vira o total quando não há itens. */
  valorDoNegocio: number | null;
  valorDoFunil?: number;
  /** Sem ela o "+ Adicionar produto" não aparece — botão que não faz nada mente. */
  onAdicionarProduto?: () => void;
}) {
  /**
   * A ausência do botão é DITA, não escondida.
   *
   * `deal_items.deal_id` é NOT NULL e `pipeline_entries.deal_id` é nulo em quase
   * todas as entradas em produção — então, na maioria dos negócios, não há onde
   * lançar item e o botão não desce. Sem esta frase o bloco fica idêntico ao que
   * era antes (uma lista sem saída), e quem abrir vai concluir de novo que a
   * tela simplesmente não deixa cadastrar produto.
   */
  const semNegocio = !onAdicionarProduto;
  const { temItens, desconto, total } = contaDoNegocio(itens, valorDoNegocio, valorDoFunil);

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-3 pb-1">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">
          <Package className="size-[17px] text-muted-foreground" aria-hidden="true" />
          Produtos e Valores
        </h3>
        {onAdicionarProduto && (
          <button
            type="button"
            onClick={onAdicionarProduto}
            className={cn(
              "inline-flex items-center gap-1 text-[12.5px] text-primary underline-offset-2 hover:underline",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            <Plus className="size-3.5" />
            Adicionar produto
          </button>
        )}
      </div>

      <div className="flex flex-col divide-y divide-border/50">
        {temItens ? (
          <div className="flex flex-col">
            {itens.map((i) => (
              <Linha
                key={i.id}
                icone={Package}
                rotulo={i.nome}
                detalhe={
                  i.quantidade > 1
                    ? `${i.quantidade} × ${formatBRL(i.precoUnitario, 2)}`
                    : undefined
                }
                valor={formatBRL(i.total, 2)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1 py-4">
            <p className="text-[12.5px] text-muted-foreground/70">
              Nenhum produto lançado neste negócio.
            </p>
            {semNegocio && (
              <p className="text-[11.5px] text-muted-foreground/55">
                Este card ainda não tem um negócio aberto — é nele que os produtos
                ficam. Abra um em "Novo negócio" para poder lançá-los.
              </p>
            )}
          </div>
        )}

        {desconto > 0 && (
          <div className="flex flex-col">
            <Linha
              icone={Tag}
              rotulo="Desconto (−)"
              valor={formatBRL(desconto, 2)}
              detalhe="somado dos itens"
              tom="abate"
            />
          </div>
        )}

        <div className="flex items-baseline gap-3 pt-3">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Total</span>
          {!temItens && valorDoNegocio != null && (
            <span className="text-[11.5px] text-muted-foreground/70">valor do negócio</span>
          )}
          {/* Mesma regra do ladrilho: sem lastro nenhum o Total diz "—".
              "R$ 0,00" afirmaria que o negócio vale zero; "—" diz que não se
              sabe, que é a verdade em 98,9% dos negócios. */}
          <span className="ml-auto text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
            {total > 0 ? formatBRL(total, 2) : "—"}
          </span>
        </div>
      </div>
    </section>
  );
}
