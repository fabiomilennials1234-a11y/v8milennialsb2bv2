import { useState } from "react";
import { formatBRL, maskCurrencyInput, parseCurrencyInput } from "@/lib/format";
import type { CorrecaoVendaHistorica } from "./useCorrigirVendaHistorica";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { diaDaVenda } from "./dia-da-venda";

export function CorrigirVendaHistorica({
  valor,
  data,
  onSalvar,
  onCancelar,
  versao,
  timezone = "America/Sao_Paulo",
  valorDosProdutos = false,
}: {
  valor: number;
  /** AAAA-MM-DD atual da venda. */
  data: string;
  onSalvar: (correcao: CorrecaoVendaHistorica) => Promise<void>;
  onCancelar: () => void;
  versao?: string | null;
  timezone?: string;
  valorDosProdutos?: boolean;
}) {
  const [valorCampo, setValorCampo] = useState(() => maskCurrencyInput(String(Math.round(valor * 100))));
  const [dataCampo, setDataCampo] = useState(data);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  // A versão pertence ao formulário aberto, inclusive se houver refetch ao fundo.
  const [versaoAberta] = useState(versao);
  const novoValor = parseCurrencyInput(valorCampo);
  const valido =
    novoValor > 0 && novoValor < 1e10 && /^\d{4}-\d{2}-\d{2}$/.test(dataCampo) && dataCampo <= diaDaVenda(new Date().toISOString(), timezone);
  const mudou = novoValor !== valor || dataCampo !== data;
  const salvar = async () => {
    if (salvando || !valido || !mudou || !motivo.trim()) return;
    setSalvando(true);
    setErro("");
    try {
      await onSalvar({ valor: novoValor, data: dataCampo, motivo: motivo.trim(), ...(versaoAberta && { versao: versaoAberta }) });
      onCancelar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar a correção. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <section
      className="flex flex-col gap-4 rounded-xl border border-primary/40 bg-card p-4"
      aria-label="Correção da venda ganha"
    >
      <div>
        <h3 className="font-semibold">Corrigir data e valor da venda</h3>
        <p className="text-sm text-muted-foreground">
          O negócio, a receita e o pedido são corrigidos juntos. O valor e a data anteriores ficam registrados.
        </p>
      </div>
      <fieldset disabled={salvando} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            Data da venda
            <Input
              type="date"
              className="tabular-nums"
              aria-label="Data da venda"
              max={diaDaVenda(new Date().toISOString(), timezone)}
              value={dataCampo}
              onChange={(e) => setDataCampo(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Valor da venda
            <Input
              className="tabular-nums"
              readOnly={valorDosProdutos}
              aria-label="Valor da venda"
              inputMode="decimal"
              value={valorCampo}
              onChange={(e) => setValorCampo(maskCurrencyInput(e.target.value))}
            />
          </label>
        </div>
        {valorDosProdutos && <p className="text-sm text-muted-foreground">Para alterar o valor dos produtos, use Ajustar pedido ganho. Aqui você pode corrigir a data.</p>}
        <label className="block text-sm">
          Motivo da correção
          <Textarea
            className="min-h-24"
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
        <Button
          type="button"
          disabled={salvando}
          onClick={onCancelar}
          variant="ghost"
        >
          Cancelar correção
        </Button>
        <Button
          type="button"
          disabled={salvando || !valido || !mudou || !motivo.trim()}
          onClick={salvar}
        >
          {salvando ? "Salvando…" : "Salvar correção"}
        </Button>
      </div>
    </section>
  );
}
