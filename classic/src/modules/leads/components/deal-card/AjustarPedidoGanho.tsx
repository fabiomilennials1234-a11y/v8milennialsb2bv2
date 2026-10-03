import { useState } from "react";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import type { DealCardItem } from "./types";

export interface AjustePedidoGanho {
  valor: number;
  motivo: string;
  itens: Array<{
    id: string;
    quantity: number;
    unit_price: number;
    discount_percent: number;
  }> | null;
}

/** Rascunho único: os itens e o total são gravados juntos, no mesmo pedido. */
export function AjustarPedidoGanho({
  itens,
  valor,
  onSalvar,
  onCancelar,
}: {
  itens: DealCardItem[];
  valor: number;
  onSalvar: (ajuste: AjustePedidoGanho) => Promise<void>;
  onCancelar: () => void;
}) {
  const [linhas, setLinhas] = useState(() =>
    itens.map((i) => ({
      id: i.id,
      nome: i.nome,
      quantidade: String(i.quantidade),
      preco: maskCurrencyInput(String(Math.round(i.precoUnitario * 100))),
      desconto: String(i.descontoPercent),
    })),
  );
  const [valorManual, setValorManual] = useState(() =>
    maskCurrencyInput(String(Math.round(valor * 100))),
  );
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const novosItens = linhas.map((i) => ({
    id: i.id,
    quantity: Number(i.quantidade.replace(",", ".")),
    unit_price: parseCurrencyInput(i.preco),
    discount_percent: Number(i.desconto.replace(",", ".")),
  }));
  const total = linhas.length
    ? Math.round(
        novosItens.reduce(
          (s, i) =>
            s + i.quantity * i.unit_price * (1 - i.discount_percent / 100),
          0,
        ) * 100,
      ) / 100
    : parseCurrencyInput(valorManual);
  const valido =
    Number.isFinite(total) &&
    total > 0 &&
    total < 1e12 &&
    novosItens.every(
      (i) =>
        Number.isFinite(i.quantity) &&
        i.quantity > 0 &&
        Number.isFinite(i.unit_price) &&
        i.unit_price >= 0 &&
        Number.isFinite(i.discount_percent) &&
        i.discount_percent >= 0 &&
        i.discount_percent <= 100,
    );
  const mudou =
    total !== valor ||
    novosItens.some(
      (i, n) =>
        i.quantity !== itens[n].quantidade ||
        i.unit_price !== itens[n].precoUnitario ||
        i.discount_percent !== itens[n].descontoPercent,
    );
  const salvar = async () => {
    if (salvando || !valido || !mudou || !motivo.trim()) return;
    setSalvando(true);
    setErro("");
    try {
      await onSalvar({
        valor: total,
        motivo: motivo.trim(),
        itens: linhas.length ? novosItens : null,
      });
      onCancelar();
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o ajuste. Tente novamente.",
      );
    } finally {
      setSalvando(false);
    }
  };
  const campo =
    "h-9 w-full rounded-md border border-border bg-background px-2 text-sm tabular-nums";
  return (
    <section
      className="rounded-xl border border-primary/40 bg-card p-4 space-y-4"
      data-summary-pending="true"
      aria-label="Ajuste do pedido ganho"
    >
      <div>
        <h3 className="font-semibold">Ajustar pedido ganho</h3>
        <p className="text-sm text-muted-foreground">
          O pedido continua ganho, com a mesma data da venda. O ajuste fica
          registrado no histórico.
        </p>
      </div>
      <fieldset disabled={salvando} className="space-y-3">
        {linhas.map((linha, n) => (
          <div key={linha.id} className="space-y-2 border-b border-border pb-3">
            <p className="text-sm font-medium">{linha.nome}</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["quantidade", "Quantidade"],
                  ["preco", "Valor unitário"],
                  ["desconto", "Desconto (%)"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs text-muted-foreground">
                  {label}
                  <input
                    className={campo}
                    aria-label={`${label} de ${linha.nome}`}
                    inputMode="decimal"
                    value={linha[key]}
                    onChange={(e) =>
                      setLinhas((prev) =>
                        prev.map((l, idx) =>
                          idx === n
                            ? {
                                ...l,
                                [key]:
                                  key === "preco"
                                    ? maskCurrencyInput(e.target.value)
                                    : e.target.value,
                              }
                            : l,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        {!linhas.length && (
          <label className="block text-sm">
            Novo valor do pedido
            <input
              className={campo}
              aria-label="Novo valor do pedido"
              inputMode="decimal"
              value={valorManual}
              onChange={(e) =>
                setValorManual(maskCurrencyInput(e.target.value))
              }
            />
          </label>
        )}
        <label className="block text-sm">
          Motivo do ajuste
          <textarea
          className="min-h-24 w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
            aria-label="Motivo do ajuste"
            maxLength={1000}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: cliente aumentou a quantidade após a aprovação"
          />
        </label>
      </fieldset>
      <p className="text-sm">
        Valor anterior: {formatBRL(valor, 2)}{" "}
        <span className="block font-semibold">
          Novo total: {valido ? formatBRL(total, 2) : "Confira os valores"}
        </span>
      </p>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={salvando}
          onClick={onCancelar}
          className="rounded-md px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          Cancelar ajuste
        </button>
        <button
          type="button"
          disabled={salvando || !valido || !mudou || !motivo.trim()}
          onClick={salvar}
          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar ajuste"}
        </button>
      </div>
    </section>
  );
}
