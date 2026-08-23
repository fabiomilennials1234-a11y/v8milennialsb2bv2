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
}: {
  aberto: boolean;
  aoFechar: () => void;
  /** `deals.id`. O diálogo só é montado quando existe — `deal_items.deal_id` é NOT NULL. */
  dealId: string;
  /** `pipeline_entries.id` — a chave que o painel usa para recarregar. */
  entryId: string | null;
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

  const escolher = (p: ProductSelection) => {
    setEscolhido(p);
    // Produto de catálogo chega com `ticket`; avulso chega com 0 e o campo fica
    // para quem está lançando. Nos dois casos o preço continua editável — o
    // ticket é o padrão da org, não o preço desta venda.
    setPreco(p.unit_price > 0 ? maskCurrencyInput(String(Math.round(p.unit_price * 100))) : "");
  };

  const qtd = Math.max(0, Number(quantidade.replace(",", ".")) || 0);
  const unit = parseCurrencyInput(preco);
  const desc = Math.min(100, Math.max(0, Number(desconto.replace(",", ".")) || 0));
  const totalLinha = qtd * unit * (1 - desc / 100);

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
      toast.success(`"${escolhido.product_name}" lançado no negócio.`);
      aoFechar();
    } catch {
      // O toast de erro é do `onError` da mutation — que traz a mensagem do
      // banco, mais útil que um texto genérico escrito aqui.
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-w-[460px]">
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
              <span className="min-w-0 flex-1 truncate text-[13px]">
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
            <div className="flex">
              <ProductCombobox onAdd={escolher} />
            </div>
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
                <span className="text-[13px] text-muted-foreground">Total desta linha</span>
                <span className="text-[17px] font-semibold tabular-nums tracking-[-0.02em]">
                  {totalLinha > 0 ? formatBRL(totalLinha, 2) : "—"}
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
