import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OraculoProposta } from "../../hooks/useOraculoTurno";

interface Props {
  proposta: OraculoProposta;
  onConfirmar: (id: string) => void;
  ocupada: boolean;
  desabilitada?: boolean;
}

function texto(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function descricao(proposta: OraculoProposta): string {
  const p = proposta.parametros;
  switch (proposta.acao) {
    case "mover_etapa":
      return `Mover para ${texto(p.target_stage_name, "etapa selecionada")} em ${texto(p.pipeline_name, "funil selecionado")}`;
    case "criar_follow_up":
      return `Criar follow-up “${texto(p.titulo, "Retomar contato")}” em ${Number(p.prazo_dias) || 0} dia(s)`;
    case "atribuir_responsavel":
      return `Atribuir ${texto(p.team_member_name, "responsável selecionado")}`;
    case "adicionar_tag":
      return `Adicionar tag ${texto(p.tag_name, "selecionada")}`;
  }
}

function criterio(proposta: OraculoProposta): string {
  return proposta.criterio.tipo === "leads_parados"
    ? `Leads parados há ${proposta.criterio.dias} dias`
    : "Leads que ainda não avançaram do primeiro contato";
}

function descricaoResultado(proposta: OraculoProposta): string {
  const result = proposta.resultado;
  if (!result) return "Proposta encerrada. Gere uma nova previsão para continuar.";
  if (result.codigo === "proposta_expirada") return "Proposta expirada. Gere uma nova previsão.";
  if (result.codigo === "destino_indisponivel") return "O destino mudou. Gere uma nova proposta.";
  if (result.status === "aviso" && result.alterados === 0) {
    return "Nenhum lead continuava elegível no clique.";
  }
  return `${result.alterados} alterados${
    typeof result.ja_tratados === "number" ? ` · ${result.ja_tratados} já tratados` : ""
  }`;
}

export function OraculoPropostaCard({ proposta, onConfirmar, ocupada, desabilitada = false }: Props) {
  const result = proposta.resultado;
  const executed = proposta.status !== "pending";

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-amber-400/25 bg-amber-400/[0.04]">
      <div className="space-y-1.5 px-3 py-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-amber-500">
          <Sparkles className="h-3.5 w-3.5" />
          Proposta de ação
        </div>
        <p className="font-medium text-foreground">{descricao(proposta)}</p>
        <p className="text-xs text-muted-foreground">{criterio(proposta)}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          Previsão: {proposta.previsao} {proposta.previsao === 1 ? "lead" : "leads"}. O total será recalculado no clique.
        </p>
      </div>

      {executed ? (
        <div className="flex items-center gap-2 border-t border-amber-400/15 px-3 py-2.5 text-xs" aria-live="polite">
          {result?.status === "sucesso" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          )}
          <span>{descricaoResultado(proposta)}</span>
        </div>
      ) : (
        <div className="border-t border-amber-400/15 px-3 py-2.5">
          <Button
            type="button"
            size="sm"
            className="h-8 bg-amber-400 text-amber-950 hover:bg-amber-300"
            disabled={ocupada || desabilitada}
            onClick={() => onConfirmar(proposta.id)}
          >
            {ocupada && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Confirmar ação em {proposta.previsao} {proposta.previsao === 1 ? "lead" : "leads"}
          </Button>
          {proposta.erro && <p className="mt-2 text-xs text-destructive">{proposta.erro}</p>}
        </div>
      )}
    </section>
  );
}
