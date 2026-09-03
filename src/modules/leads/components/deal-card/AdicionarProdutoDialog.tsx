import { useEffect, useState } from "react";
import { Package, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ProductCombobox,
  type ProductSelection,
} from "@/modules/carteira/components/client/ProductCombobox";

import { useAdicionarItemDoNegocio } from "./useItensDoNegocio";
import type { DealCardItem } from "./types";

/**
 * "Adicionar produto" — lançar um item em `deal_items`.
 *
 * ── POR QUE ELE MORA NO PAINEL E NÃO NO CARD ──────────────────────────────
 * `DealCard` e `DealCardMoney` são alcançáveis a partir de `/preview.html`, e o
 * teste `preview-cards-sem-banco.test.ts` (inv:H5-17) reprova se qualquer
 * arquivo daquele grafo escrever a palavra `supabase` — a rota abre sem login e
 * a chave anon está no bundle. Este arquivo fala com o banco, então ele é
 * montado pelo `DealCardPanel`, que já está fora daquele grafo. O card só
 * recebe `onAdicionarProduto` e não sabe o que acontece do outro lado.
 *
 * ── DOIS CAMINHOS, QUE É EXATAMENTE O QUE FOI PEDIDO ──────────────────────
 * O `ProductCombobox` da carteira já resolve os dois: escolher do catálogo da
 * org (e aí o preço vem do `products.ticket` e só falta a quantidade) ou digitar
 * um nome que não está cadastrado e lançar como **avulso**. Reusá-lo em vez de
 * escrever outro seletor evita a segunda lista de produtos que diverge da
 * primeira. O precedente de importar carteira a partir de leads já existe e é
 * do mesmo tipo: `BudgetFieldBlock.tsx:24-30`.
 *
 * ── O QUE NÃO ESTÁ AQUI, DE PROPÓSITO ─────────────────────────────────────
 * Acréscimo e frete não existem em coluna nenhuma do Torque, então não há campo
 * para eles — pelo mesmo motivo que o bloco de leitura não desenha as linhas.
 * O desconto por item existe (`discount_percent`) e entra, porque o "Desconto
 * (−)" do bloco é a soma exata do que cada item abateu.
 */

function CampoNumero({
  rotulo,
  children,
  dica,
}: {
  rotulo: string;
  children: React.ReactNode;
  dica?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        {rotulo}
      </span>
      {children}
      {dica && <span className="text-[11px] text-muted-foreground/70">{dica}</span>}
    </label>
  );
}

const ENTRADA = cn(
  "h-9 w-full rounded-lg border border-border/60 bg-muted/40 px-3 text-[13px] tabular-nums",
  "outline-none transition-colors focus:border-border",
);

export function AdicionarProdutoDialog({
  aberto,
  aoFechar,
  dealId,
  entryId,
  itensAtuais = [],
}: {
  aberto: boolean;
  aoFechar: () => void;
  /** `deals.id`. O diálogo só é montado quando existe — `deal_items.deal_id` é NOT NULL. */
  dealId: string;
  /** `pipeline_entries.id` — a chave que o painel usa para recarregar. */
  entryId: string | null;
  /**
   * O que já está lançado. Serve para uma coisa só: **avisar antes** quando o
   * produto escolhido já está no negócio, porque nesse caso a regra é
   * CONSOLIDAR — a quantidade soma na linha existente em vez de criar uma
   * segunda. Sem o aviso, quem lança 3 num negócio que já tinha 2 vê 5 aparecer
   * e não entende de onde veio.
   */
  itensAtuais?: DealCardItem[];
}) {
  const [escolhido, setEscolhido] = useState<ProductSelection | null>(null);
  const [quantidade, setQuantidade] = useState("1");
  const [preco, setPreco] = useState("");
  const [desconto, setDesconto] = useState("0");

  const adicionar = useAdicionarItemDoNegocio(entryId);

  // Reabrir o diálogo não pode trazer o produto da vez passada: lançar dois
  // itens seguidos é o caso comum, e herdar o anterior faz o segundo sair
  // errado sem ninguém notar.
  useEffect(() => {
    if (!aberto) return;
    setEscolhido(null);
    setQuantidade("1");
    setPreco("");
    setDesconto("0");
  }, [aberto]);

  /**
   * A linha que este produto vai ENGROSSAR, quando já existir.
   *
   * Catálogo casa por `product_id`; avulso casa por nome normalizado, que é a
   * única identidade que ele tem. É a mesma regra que a RPC aplica no banco —
   * repetida aqui só para poder AVISAR, nunca para decidir: duas abas lançando
   * ao mesmo tempo passariam pelas duas checagens de tela e criariam as duas
   * linhas assim mesmo. Quem decide é o `FOR UPDATE` lá dentro.
   */
  const jaLancado = escolhido
    ? (itensAtuais.find((i) =>
        escolhido.product_id
          ? i.produtoId === escolhido.product_id
          : i.produtoId === null &&
            i.nome.trim().toLowerCase() === escolhido.product_name.trim().toLowerCase(),
      ) ?? null)
    : null;

  const escolher = (p: ProductSelection) => {
    setEscolhido(p);

    // Se o produto já está no negócio, o padrão passa a ser o preço e o
    // desconto DAQUELA linha — não o `ticket` do catálogo. Assim quem só quer
    // somar quantidade confirma sem mexer em preço nenhum, e quem quer
    // corrigir o preço no mesmo gesto tem o valor atual na frente para
    // comparar.
    const existente = itensAtuais.find((i) =>
      p.product_id
        ? i.produtoId === p.product_id
        : i.produtoId === null &&
          i.nome.trim().toLowerCase() === p.product_name.trim().toLowerCase(),
    );

    if (existente) {
      setPreco(maskCurrencyInput(String(Math.round(existente.precoUnitario * 100))));
      setDesconto(String(existente.descontoPercent));
      return;
    }

    // Produto de catálogo chega com `ticket`; avulso chega com 0 e o campo fica
    // para quem está lançando. Nos dois casos o preço continua editável — o
    // ticket é o padrão da org, não o preço desta venda.
    setPreco(p.unit_price > 0 ? maskCurrencyInput(String(Math.round(p.unit_price * 100))) : "");
  };

  const qtd = Math.max(0, Number(quantidade.replace(",", ".")) || 0);
  const unit = parseCurrencyInput(preco);
  const desc = Math.min(100, Math.max(0, Number(desconto.replace(",", ".")) || 0));
  const totalLinha = qtd * unit * (1 - desc / 100);
  /** Consolidando, a linha final leva a quantidade SOMADA. */
  const totalResultante = jaLancado
    ? (jaLancado.quantidade + qtd) * unit * (1 - desc / 100)
    : totalLinha;

  const podeAdicionar = !!escolhido && qtd > 0 && !adicionar.isPending;

  const confirmar = async () => {
    if (!escolhido || qtd <= 0) return;
    try {
      await adicionar.mutateAsync({
        dealId,
        productId: escolhido.product_id ?? null,
        nome: escolhido.product_name,
        quantidade: qtd,
        precoUnitario: unit,
        descontoPercent: desc,
      });
      toast.success(
        jaLancado
          ? `"${escolhido.product_name}" agora está com ${jaLancado.quantidade + qtd} no negócio.`
          : `"${escolhido.product_name}" lançado no negócio.`,
      );
      aoFechar();
    } catch {
      // O toast de erro é do `onError` da mutation — que traz a mensagem do
      // banco, mais útil que um texto genérico escrito aqui.
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      {/*
        `z-[60]` nos DOIS — conteúdo e overlay — pelo mesmo motivo que a
        confirmação de excluir o negócio já sobe: no celular o painel do Negócio
        é um `Sheet`, e `SheetContent` é `z-[51]`. Este diálogo é IRMÃO dele no
        `body`, então com o `z-50` do primitivo ele nasce ATRÁS da folha —
        invisível. E não é só o desenho que quebra: o Radix põe a camada de
        baixo em `pointer-events: none`, então o toque atravessa a folha e cai
        num diálogo que ninguém está vendo. Medido em 390×844: o diálogo existia
        no DOM, recebia o clique, e a tela mostrava só a folha.

        `grid-cols-1` é o ENQUADRAMENTO. O `DialogContent` é `grid` sem
        `grid-template-columns`, então a coluna é implícita e `auto` — e o
        mínimo de uma track `auto` é a maior min-content dos itens, sem teto: o
        `max-w-[460px]` segura a CAIXA do painel, nunca a track. Com um nome de
        produto longo o `truncate` do span vira `white-space: nowrap`, cuja
        min-content é a linha inteira, e a coluna é desenhada nessa largura
        dentro do painel estreito — campos, total e rodapé saem pela borda e
        pintam sobre a página, e a descrição do header para de quebrar linha.
        Medido em 1440×900: track de mais de 1000px num content-box de 410px,
        com o conteúdo passando ~1000px da borda direita. O valor exato varia
        com o comprimento do nome — a track ACOMPANHA o texto linearmente.

        `grid-cols-1` é `repeat(1, minmax(0,1fr))`, e o que ele troca é a MIN
        track sizing function, de `auto` para `0`. Isso desliga o *automatic
        minimum size* do item (CSS Grid §6.6, que só vale para item cruzando
        track de mínimo `auto`), então o `min-width:auto` dos filhos vira 0 e a
        track deixa de perseguir a min-content de quem está dentro.
        ⚠️ **Não é o `min-w-0` do span que passa a valer** — medido: tirar o
        `min-w-0` mantendo `grid-cols-1` não muda nada (track segue 410px, nome
        segue truncando). Aquele `min-w-0` já valia antes; só nunca precisava
        encolher, porque tinha a track inteira de espaço.

        Com nome curto é no-op, medido número por número: uma track `auto` que
        já cabe e uma `1fr` dão os mesmos 410px.
      */}
      <DialogContent className="z-[60] max-w-[460px] grid-cols-1" overlayClassName="z-[60]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Package className="size-4 text-muted-foreground" aria-hidden="true" />
            Adicionar produto
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Escolha do catálogo da sua organização ou digite um nome para lançar
            como avulso. O total do negócio é recalculado sozinho.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {escolhido ? (
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
              <Package className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {/* O `title` é a contrapartida do truncate: agora que o nome
                  longo é cortado em vez de esticar o diálogo, o resto dele
                  precisa continuar alcançável em algum lugar. */}
              <span className="min-w-0 flex-1 truncate text-[13px]" title={escolhido.product_name}>
                {escolhido.product_name}
              </span>
              {!escolhido.product_id && (
                <span className="shrink-0 rounded-full border border-dashed border-border px-2 py-[1px] text-[10.5px] text-muted-foreground/80">
                  avulso
                </span>
              )}
              <button
                type="button"
                onClick={() => setEscolhido(null)}
                title="Escolher outro produto"
                aria-label="Escolher outro produto"
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex">
                <ProductCombobox onAdd={escolher} />
              </div>
              {/*
                O botão "Adicionar" nasce desabilitado e não dizia por quê.
                Digitar o nome na busca não é escolher: enquanto ninguém clica
                num item da lista (ou confirma o avulso), o diálogo não tem
                produto, e o clique no botão de baixo não faz nada — que é
                exatamente como um botão quebrado se parece.
              */}
              <p className="text-[11.5px] text-muted-foreground/70">
                Escolha um produto da lista para liberar a quantidade, o preço e
                o botão de lançar. Digitar na busca ainda não escolhe.
              </p>
            </div>
          )}

          {jaLancado && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-200/90">
              Este produto já está neste negócio ({jaLancado.quantidade} ×{" "}
              {formatBRL(jaLancado.precoUnitario, 2)}). A quantidade vai{" "}
              <strong className="font-semibold">somar</strong> na linha que já
              existe — o negócio não fica com o produto duplicado.
            </p>
          )}

          {escolhido && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <CampoNumero rotulo="Quantidade">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={quantidade}
                    onChange={(e) => setQuantidade(e.target.value)}
                    className={ENTRADA}
                    autoFocus
                  />
                </CampoNumero>
                <CampoNumero rotulo="Preço unit.">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={preco}
                    onChange={(e) => setPreco(maskCurrencyInput(e.target.value))}
                    placeholder="R$ 0,00"
                    className={ENTRADA}
                  />
                </CampoNumero>
                <CampoNumero rotulo="Desc. %">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={desconto}
                    onChange={(e) => setDesconto(e.target.value)}
                    className={ENTRADA}
                  />
                </CampoNumero>
              </div>

              <div className="flex items-baseline justify-between border-t border-border/50 pt-3">
                <span className="text-[13px] text-muted-foreground">
                  {/* Consolidando, a prévia mostra o RESULTADO, não a parcela.
                      Mostrar só o que está sendo somado faria o número do
                      diálogo não bater com o que aparece na tabela depois. */}
                  {jaLancado
                    ? `Como a linha vai ficar (${jaLancado.quantidade + qtd} un.)`
                    : "Total desta linha"}
                </span>
                <span className="text-[17px] font-semibold tabular-nums tracking-[-0.02em]">
                  {totalResultante > 0 ? formatBRL(totalResultante, 2) : "—"}
                </span>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar} disabled={adicionar.isPending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!podeAdicionar}>
            {adicionar.isPending ? "Lançando…" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
