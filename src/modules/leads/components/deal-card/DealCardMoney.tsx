import { useEffect, useState } from "react";
import { Check, Package, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import type { DealCardItem, ItemEditado } from "./types";
import { contaDoNegocio } from "./conta-do-negocio";

/**
 * "Produtos e Valores" — o bloco de dinheiro do negócio.
 *
 * ── DE LISTA PARA TABELA, E POR QUÊ ───────────────────────────────────────
 * O bloco nasceu como uma lista: nome à esquerda, total à direita, e o
 * "2 × R$ 100,00" só aparecia **quando a quantidade era maior que 1**. Ou
 * seja: no caso mais comum — quantidade 1 — a tela mostrava "Produto X …
 * R$ 1.200,00" sem dizer se aquilo era um item de mil e duzentos ou uma conta
 * que alguém não fez. Preço unitário invisível é preço que ninguém confere.
 *
 * Agora são colunas fixas — Produto · Qtd · Valor unit. · Total · Ações — e
 * cada número tem uma casa própria, sempre, inclusive quando a quantidade é 1.
 *
 * ── POR QUE ISTO CONTINUA SEM BANCO ───────────────────────────────────────
 * Este arquivo é alcançável a partir de `/preview.html`, e
 * `preview-cards-sem-banco.test.ts` (inv:H5-17) reprova qualquer arquivo
 * daquele grafo que importe react-query ou **escreva a palavra do client** em
 * código. A rota abre sem login e a chave anon está no bundle. Por isso editar
 * e remover chegam como CALLBACK (`onEditarItem`, `onRemoverItem`), do mesmo
 * jeito que `onAdicionarProduto` e os quatro callbacks de comentário — quem
 * fala com o banco é o `DealCardPanel`.
 *
 * ── CONFIRMAÇÃO DE REMOÇÃO É NA PRÓPRIA LINHA ─────────────────────────────
 * Não abre diálogo. `cards-nunca-empilham.test.tsx` conta `[role=dialog]` e um
 * AlertDialog montado dentro do painel reprovaria — e o repo já resolveu isso
 * uma vez, em `DealCardComments`, confirmando na linha. Mesmo idioma aqui.
 *
 * ── O QUE O PRINT PEDE E O BANCO NÃO TEM ──────────────────────────────────
 * O DataCrazy fecha o bloco com Desconto (−), Acréscimo (+) e Frete (+). No
 * Torque, das três só o **Desconto** tem lastro: `deal_items.discount_percent`
 * existe por item desde a Wave 1. **Acréscimo e Frete não existem em coluna
 * nenhuma** (o único `frete` do schema mora em `org_unit_economics_inputs`,
 * que é unit economics e nada tem a ver com negócio). A ausência é dita, não
 * escondida — desenhar "Frete R$ 0,00" travado afirmaria que o negócio tem
 * frete zero, quando a verdade é que o Torque não guarda frete.
 *
 * ── O VALOR DO NEGÓCIO É A SOMA DOS PRODUTOS ──────────────────────────────
 * Não é escolha desta tela: `trg_deal_items_sync_value` roda a cada toque em
 * item e faz `UPDATE deals SET value = SUM(deal_items.total)`. Havendo itens,
 * `deals.value` **é** o total deles. O rodapé mostra os dois números com o
 * nome de cada um justamente para que o impacto seja visível em vez de
 * subentendido. Sem itens, o Total cai para `deals.value` — o valor digitado à
 * mão — e diz de onde tirou.
 */

const ENTRADA = cn(
  "h-7 w-full min-w-0 rounded-md border border-border bg-background px-1.5",
  "text-right text-[12.5px] tabular-nums outline-none",
  "focus:border-primary/60",
);

/** Grid único para cabeçalho e linhas — é o que mantém as colunas alinhadas. */
const GRADE = "grid grid-cols-[minmax(0,1fr)_58px_92px_92px_56px] items-center gap-2";

function Rodape({
  rotulo,
  valor,
  detalhe,
  tom,
  destaque,
}: {
  rotulo: string;
  valor: string;
  detalhe?: string;
  tom?: "abate";
  destaque?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3 py-[7px]">
      <span
        className={cn(
          "flex items-center gap-2 text-foreground/85",
          destaque ? "text-[15px] font-semibold tracking-[-0.01em]" : "text-[13px]",
        )}
      >
        {tom === "abate" && <Tag className="size-[15px] shrink-0 text-amber-400" aria-hidden="true" />}
        {rotulo}
      </span>
      {detalhe && <span className="truncate text-[11.5px] text-muted-foreground/70">{detalhe}</span>}
      <span
        className={cn(
          "ml-auto shrink-0 tabular-nums",
          destaque ? "text-[19px] font-semibold tracking-[-0.02em]" : "text-[13px]",
          tom === "abate" ? "text-amber-400" : "text-foreground",
        )}
      >
        {valor}
      </span>
    </div>
  );
}

function LinhaDeItem({
  item,
  onEditar,
  onRemover,
}: {
  item: DealCardItem;
  onEditar?: (edicao: ItemEditado) => Promise<void>;
  onRemover?: (itemId: string) => Promise<void>;
}) {
  const [modo, setModo] = useState<"leitura" | "editando" | "confirmando">("leitura");
  const [ocupado, setOcupado] = useState(false);
  const [quantidade, setQuantidade] = useState("1");
  const [preco, setPreco] = useState("");
  const [desconto, setDesconto] = useState("0");

  // Entrar em edição SEMPRE parte do que está gravado. Guardar o rascunho
  // entre aberturas faria a segunda edição começar do que foi digitado e
  // abandonado na primeira — e o número errado sairia parecendo o atual.
  useEffect(() => {
    if (modo !== "editando") return;
    setQuantidade(String(item.quantidade));
    setPreco(maskCurrencyInput(String(Math.round(item.precoUnitario * 100))));
    setDesconto(String(item.descontoPercent));
  }, [modo, item.quantidade, item.precoUnitario, item.descontoPercent]);

  const qtd = Math.max(0, Number(quantidade.replace(",", ".")) || 0);
  const unit = parseCurrencyInput(preco);
  const desc = Math.min(100, Math.max(0, Number(desconto.replace(",", ".")) || 0));
  const previa = qtd * unit * (1 - desc / 100);

  const podeEditar = !!onEditar;
  const podeRemover = !!onRemover;

  const salvar = async () => {
    if (!onEditar || qtd <= 0 || ocupado) return;
    setOcupado(true);
    try {
      await onEditar({
        itemId: item.id,
        quantidade: qtd,
        precoUnitario: unit,
        descontoPercent: desc,
      });
      setModo("leitura");
    } catch {
      // A mensagem vem do `onError` da mutation, que traz o texto do banco —
      // mais útil que um genérico escrito aqui. A linha CONTINUA em edição de
      // propósito: fechar apagaria o que a pessoa digitou.
    } finally {
      setOcupado(false);
    }
  };

  const remover = async () => {
    if (!onRemover || ocupado) return;
    setOcupado(true);
    try {
      await onRemover(item.id);
      // Sem `setModo` no sucesso: a linha deixa de existir na próxima leitura.
    } catch {
      setModo("leitura");
    } finally {
      setOcupado(false);
    }
  };

  if (modo === "editando") {
    return (
      <div className={cn(GRADE, "rounded-lg bg-muted/30 px-1.5 py-1.5")}>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px]" title={item.nome}>
            {item.nome}
          </span>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
            Desc.
            <input
              type="text"
              inputMode="decimal"
              value={desconto}
              onChange={(e) => setDesconto(e.target.value)}
              aria-label={`Desconto em % de ${item.nome}`}
              className={cn(ENTRADA, "h-6 w-14 text-[11.5px]")}
            />
            %
          </label>
        </div>

        <input
          type="text"
          inputMode="decimal"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          aria-label={`Quantidade de ${item.nome}`}
          className={ENTRADA}
          autoFocus
        />

        <input
          type="text"
          inputMode="numeric"
          value={preco}
          onChange={(e) => setPreco(maskCurrencyInput(e.target.value))}
          placeholder="R$ 0,00"
          aria-label={`Valor unitário de ${item.nome}`}
          className={ENTRADA}
        />

        <span className="text-right text-[13px] font-medium tabular-nums">
          {previa > 0 ? formatBRL(previa, 2) : "—"}
        </span>

        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={salvar}
            disabled={qtd <= 0 || ocupado}
            title="Salvar"
            aria-label={`Salvar ${item.nome}`}
            className="rounded p-1 text-emerald-400 transition-colors hover:bg-emerald-400/10 disabled:opacity-40"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setModo("leitura")}
            disabled={ocupado}
            title="Cancelar"
            aria-label={`Cancelar edição de ${item.nome}`}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  if (modo === "confirmando") {
    return (
      <div className={cn(GRADE, "rounded-lg bg-destructive/10 px-1.5 py-2")}>
        <span className="col-span-3 min-w-0 truncate text-[12.5px] text-foreground/90">
          Remover "{item.nome}" deste negócio?
        </span>
        <div className="col-span-2 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={remover}
            disabled={ocupado}
            className="rounded-md px-2 py-1 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-40"
          >
            {ocupado ? "Removendo…" : "Remover"}
          </button>
          <button
            type="button"
            onClick={() => setModo("leitura")}
            disabled={ocupado}
            className="rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(GRADE, "group px-1.5 py-[7px]")}>
      <span className="flex min-w-0 items-center gap-2">
        <Package className="size-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-[13px] text-foreground/90" title={item.nome}>
          {item.nome}
        </span>
        {/* O selo de avulso só existia DURANTE o cadastro e sumia ao gravar.
            Agora ele sobrevive à linha, que é quando ele importa: item avulso
            não entra em `lead_products` quando o negócio é ganho, e sem a
            marca ninguém sabe qual dos dois está olhando. */}
        {!item.produtoId && (
          <span className="shrink-0 rounded-full border border-dashed border-border px-1.5 text-[10px] leading-4 text-muted-foreground/80">
            avulso
          </span>
        )}
        {item.descontoPercent > 0 && (
          <span className="shrink-0 text-[10.5px] text-amber-400/90" title="Desconto desta linha">
            −{item.descontoPercent}%
          </span>
        )}
      </span>

      <span className="text-right text-[13px] tabular-nums text-foreground/85">
        {item.quantidade}
      </span>
      <span className="text-right text-[13px] tabular-nums text-foreground/85">
        {formatBRL(item.precoUnitario, 2)}
      </span>
      <span className="text-right text-[13px] font-medium tabular-nums">
        {formatBRL(item.total, 2)}
      </span>

      <div className="flex items-center justify-end gap-0.5">
        {podeEditar && (
          <button
            type="button"
            onClick={() => setModo("editando")}
            title="Editar quantidade, valor ou desconto"
            aria-label={`Editar ${item.nome}`}
            className={cn(
              "rounded p-1 text-muted-foreground transition-[color,opacity] hover:text-foreground",
              // Discretos, nunca INVISÍVEIS. `opacity-0` até o hover é o padrão
              // do repo em lista de leitura — mas aqui não serve: no celular o
              // painel vira `Sheet` e **não existe hover**, então editar e
              // remover simplesmente não teriam como ser alcançados.
              "opacity-60 focus-visible:opacity-100 group-hover:opacity-100",
            )}
          >
            <Pencil className="size-3.5" />
          </button>
        )}
        {podeRemover && (
          <button
            type="button"
            onClick={() => setModo("confirmando")}
            title="Remover do negócio"
            aria-label={`Remover ${item.nome}`}
            className={cn(
              "rounded p-1 text-muted-foreground transition-[color,opacity] hover:text-destructive",
              "opacity-60 focus-visible:opacity-100 group-hover:opacity-100",
            )}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function DealCardMoney({
  itens,
  valorDoNegocio,
  valorDoFunil,
  onAdicionarProduto,
  onEditarItem,
  onRemoverItem,
}: {
  itens: DealCardItem[];
  /** `deals.value` — o valor digitado. Vira o total quando não há itens. */
  valorDoNegocio: number | null;
  valorDoFunil?: number;
  /** Sem ela o "+ Adicionar produto" não aparece — botão que não faz nada mente. */
  onAdicionarProduto?: () => void;
  /** Idem para o lápis de cada linha. */
  onEditarItem?: (edicao: ItemEditado) => Promise<void>;
  /** Idem para a lixeira de cada linha. */
  onRemoverItem?: (itemId: string) => Promise<void>;
}) {
  const { temItens, desconto, total } = contaDoNegocio(itens, valorDoNegocio, valorDoFunil);
  const bruto = itens.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0);
  const totalDosProdutos = itens.reduce((s, i) => s + i.total, 0);

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-3 pb-1">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">
          <Package className="size-[17px] text-muted-foreground" aria-hidden="true" />
          Produtos do Negócio
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
            {/* Cabeçalho de colunas. Existe para o preço unitário ter nome —
                sem ele, um número no meio da linha não se explica. */}
            <div
              className={cn(
                GRADE,
                "border-b border-border/50 px-1.5 pb-1.5",
                "text-[10.5px] font-semibold uppercase tracking-widest text-muted-foreground/60",
              )}
            >
              <span>Produto</span>
              <span className="text-right">Qtd</span>
              <span className="text-right">Valor unit.</span>
              <span className="text-right">Total</span>
              <span className="sr-only">Ações</span>
            </div>

            <div className="flex flex-col divide-y divide-border/30">
              {itens.map((i) => (
                <LinhaDeItem
                  key={i.id}
                  item={i}
                  onEditar={onEditarItem}
                  onRemover={onRemoverItem}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 py-4">
            {/*
              Só a frase do vazio. A que vinha abaixo dela — *"Este card ainda
              não tem um negócio aberto — abra um em Novo negócio"* — saiu
              porque deixou de ser verdade: o "+ Adicionar produto" agora desce
              em todo card, e o negócio é materializado no clique. Mandar a
              pessoa a outra tela com o botão ali do lado seria pior que não
              dizer nada.
            */}
            <p className="text-[12.5px] text-muted-foreground/70">
              Nenhum produto lançado neste negócio.
            </p>
          </div>
        )}

        {temItens && (
          <div className="flex flex-col">
            {/* Subtotal só aparece quando há desconto: sem abatimento ele é
                igual ao total dos produtos, e repetir o mesmo número com dois
                nomes é como se ensina alguém a parar de ler o rodapé. */}
            {desconto > 0 && (
              <>
                <Rodape rotulo="Subtotal dos produtos" valor={formatBRL(bruto, 2)} />
                <Rodape
                  rotulo="Desconto (−)"
                  valor={formatBRL(desconto, 2)}
                  detalhe="somado dos itens"
                  tom="abate"
                />
              </>
            )}
            <Rodape
              rotulo="Total dos produtos"
              valor={formatBRL(totalDosProdutos, 2)}
              detalhe={`${itens.length} ${itens.length === 1 ? "item" : "itens"}`}
            />
          </div>
        )}

        <div className="flex items-baseline gap-3 pt-3">
          <span className="text-[15px] font-semibold tracking-[-0.01em]">Valor do negócio</span>
          <span className="text-[11.5px] text-muted-foreground/70">
            {temItens
              ? "soma dos produtos"
              : valorDoNegocio != null
                ? "valor digitado"
                : undefined}
          </span>
          {/* Mesma regra do ladrilho: sem lastro nenhum o Total diz "—".
              "R$ 0,00" afirmaria que o negócio vale zero; "—" diz que não se
              sabe, que é a verdade na maioria dos negócios. */}
          <span className="ml-auto text-[19px] font-semibold tabular-nums tracking-[-0.02em]">
            {total > 0 ? formatBRL(total, 2) : "—"}
          </span>
        </div>
      </div>
    </section>
  );
}
