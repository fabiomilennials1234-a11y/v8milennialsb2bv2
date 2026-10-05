import { useState } from "react";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import type { CorrecaoVendaHistorica } from "./types";

const hojeLocal = () => new Date().toLocaleDateString("en-CA");

export function CorrigirVendaHistorica({
  valor,
  data,
  onSalvar,
  onCancelar,
}: {
  valor: number;
  /** AAAA-MM-DD atual da venda. */
  data: string;
  onSalvar: (correcao: CorrecaoVendaHistorica) => Promise<void>;
  onCancelar: () => void;
}) {
  const [valorCampo, setValorCampo] = useState(() => maskCurrencyInput(String(Math.round(valor * 100))));
  const [dataCampo, setDataCampo] = useState(data);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const novoValor = parseCurrencyInput(valorCampo);
  const valido =
    novoValor > 0 && novoValor < 1e10 && /^\d{4}-\d{2}-\d{2}$/.test(dataCampo) && dataCampo <= hojeLocal();
  const mudou = novoValor !== valor || dataCampo !== data;
  const salvar = async () => {
    if (salvando || !valido || !mudou || !motivo.trim()) return;
    setSalvando(true);
    setErro("");
    try {
      await onSalvar({ valor: novoValor, data: dataCampo, motivo: motivo.trim() });
      onCancelar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar a correção. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  };
  const campo = "h-9 w-full rounded-lg border border-input bg-card px-2 text-sm tabular-nums";
  return (
    <section
      className="space-y-4 rounded-xl border border-primary/40 bg-card p-4"
      aria-label="Correção da venda histórica"
    >
      <div>
        <h3 className="font-semibold">Corrigir data e valor da venda</h3>
        <p className="text-sm text-muted-foreground">
          O negócio, a receita e o pedido são corrigidos juntos. O valor e a data anteriores ficam registrados.
        </p>
      </div>
      <fieldset disabled={salvando} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            Data da venda
            <input
              type="date"
              className={campo}
              aria-label="Data da venda"
              max={hojeLocal()}
              value={dataCampo}
              onChange={(e) => setDataCampo(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Valor da venda
            <input
              className={campo}
              aria-label="Valor da venda"
              inputMode="decimal"
              value={valorCampo}
              onChange={(e) => setValorCampo(maskCurrencyInput(e.target.value))}
            />
          </label>
        </div>
        <label className="block text-sm">
          Motivo da correção
          <textarea
            className="min-h-24 w-full rounded-lg border border-input bg-card px-2 py-2 text-sm"
            aria-label="Motivo da correção"
            maxLength={1000}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: a venda foi faturada em outra data"
          />
        </label>
      </fieldset>
      <p className="text-sm">
        Valor anterior: {formatBRL(valor, 2)}{" "}
        <span className="block font-semibold">
          Novo valor: {valido ? formatBRL(novoValor, 2) : "Confira a data e o valor"}
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
          className="inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
        >
          Cancelar correção
        </button>
        <button
          type="button"
          disabled={salvando || !valido || !mudou || !motivo.trim()}
          onClick={salvar}
          className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar correção"}
        </button>
      </div>
    </section>
  );
}
