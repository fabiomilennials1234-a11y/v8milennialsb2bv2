import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FocusCard, FocusTile, InkPanel, InkRow, InkSplit } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Product } from "@/modules/carteira/hooks/useProducts";
import { TIPO_PRODUTO, brlCompacto, type ItemAbc } from "./curva-abc";

function brl(v: number | null | undefined) {
  if (!v) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

/** O herói da tela: a curva ABC em tinta, o produto escolhido no ouro. */
export function CurvaAbcHero({
  itens,
  produtos,
  carregando,
  onAbrir,
}: {
  itens: ItemAbc[];
  produtos: Product[];
  carregando: boolean;
  onAbrir: (p: Product) => void;
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const total = itens.reduce((s, i) => s + Number(i.total_value), 0);
  const max = itens[0]?.total_value ?? 1;
  const sel = itens.find((i) => i.product_id === selId) ?? itens[0];
  const legenda = (
    <span className="hidden items-center gap-3 text-[11px] text-tinta-muted sm:inline-flex">
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-primary" />A · até 80%</span>
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-white/70" />B · até 95%</span>
      <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-white/30" />C · resto</span>
    </span>
  );

  if (!sel) {
    return (
      <InkPanel title="Curva ABC · 90 dias" actions={legenda}>
        <p className="px-2 pb-6 pt-2 text-center text-[13px] text-tinta-muted">
          {carregando ? "Calculando a curva…" : "Nenhuma venda com produto nos últimos 90 dias."}
        </p>
      </InkPanel>
    );
  }

  const produto = produtos.find((p) => p.id === sel.product_id);
  const tipo = TIPO_PRODUTO[produto?.type ?? sel.product_type] ?? TIPO_PRODUTO.projeto;
  const TipoIcon = tipo.icon;

  return (
    <InkSplit
      title="Curva ABC · 90 dias"
      count={`${brlCompacto(total)} em receita`}
      actions={legenda}
      listClassName="max-h-[460px] overflow-y-auto"
      list={itens.map((i) => {
        const selected = i.product_id === sel.product_id;
        return (
          <InkRow key={i.product_id} selected={selected} onClick={() => setSelId(i.product_id)} className="py-2">
            <span className={cn("w-6 shrink-0 text-[12px] font-bold tabular-nums", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
              {i.posicao}º
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-bold">{i.product_name}</span>
              <span className={cn("mt-1 block h-1 overflow-hidden rounded-full", selected ? "bg-primary-foreground/15" : "bg-white/10")}>
                <span
                  className={cn(
                    "block h-full rounded-full",
                    selected ? "bg-tinta" : i.classe === "A" ? "bg-primary" : i.classe === "B" ? "bg-white/70" : "bg-white/30",
                  )}
                  style={{ width: `${Math.max(4, (i.total_value / max) * 100)}%` }}
                />
              </span>
            </span>
            <span className="shrink-0 text-[12.5px] font-extrabold tabular-nums">{brlCompacto(i.total_value)}</span>
            <span
              className={cn(
                "w-4 shrink-0 text-center text-[12px] font-extrabold",
                selected ? "" : i.classe === "A" ? "text-primary" : "text-tinta-muted",
              )}
            >
              {i.classe}
            </span>
          </InkRow>
        );
      })}
      detail={
        <FocusCard className="gap-3.5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1 basis-[14rem]">
              <p className="text-[12px] font-bold text-primary-foreground/70">
                Classe {sel.classe} · {sel.posicao}º em receita ·{" "}
                {sel.share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total
              </p>
              <p className="mt-0.5 text-[1.45rem] font-extrabold leading-tight tracking-[-0.035em]">{sel.product_name}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="ink" className="gap-1">
                  <TipoIcon className="h-3 w-3" />
                  {tipo.label}
                </Badge>
                {produto?.sku && <span className="font-mono text-[12px] text-primary-foreground/70">{produto.sku}</span>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[2rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums">{brlCompacto(sel.total_value)}</p>
              <p className="mt-1 text-[11.5px] font-semibold text-primary-foreground/70">receita em 90 dias</p>
            </div>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
            <FocusTile>
              <p className="text-[1rem] font-extrabold tabular-nums">{sel.qty_sold}</p>
              <p className="text-[11px] font-semibold text-primary-foreground/70">{sel.qty_sold === 1 ? "venda" : "vendas"}</p>
            </FocusTile>
            <FocusTile>
              <p className="truncate text-[1rem] font-extrabold tabular-nums">{brl(sel.ticket_medio)}</p>
              <p className="text-[11px] font-semibold text-primary-foreground/70">ticket médio real</p>
            </FocusTile>
            <FocusTile>
              <p className="truncate text-[1rem] font-extrabold tabular-nums">{brl(produto?.ticket)}</p>
              <p className="text-[11px] font-semibold text-primary-foreground/70">ticket de tabela</p>
            </FocusTile>
          </div>
          {produto && (
            <div className="mt-auto pt-1">
              <Button
                variant="on-gold"
                onClick={() => onAbrir(produto)}
              >
                Abrir produto
                <ArrowRight />
              </Button>
            </div>
          )}
        </FocusCard>
      }
    />
  );
}
