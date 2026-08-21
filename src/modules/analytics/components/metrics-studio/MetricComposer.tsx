import { useCallback, useMemo, useState } from "react";
import { AlertCircle, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMetricMeasure } from "@/modules/analytics/hooks/useMetricMeasure";
import type { MetricCustomDefinition, MetricCustomDraft } from "@/modules/analytics/hooks/useMetricCustomDefinitions";
import {
  ENGINE_METRICS,
  UNIDADE_DA_MEDIDA,
} from "@/modules/analytics/lib/metrics-studio-engine-map";
import {
  OPERADORES,
  PROFUNDIDADE_MAXIMA,
  SIMBOLO_DO_OPERADOR,
  descreverArvore,
  ehErro,
  formatosDaUnidade,
  profundidade,
  rotuloDaUnidade,
  validarArvore,
  type MetricTreeNode,
  type MetricTreeOp,
} from "@/modules/analytics/lib/metric-tree";
import type { MetricFormatId } from "@/modules/analytics/lib/metric-vocabulary";
import {
  periodoAtual,
  type StudioPeriod,
  type StudioRange,
} from "@/modules/analytics/lib/metrics-studio-period";
import { EM_DASH, formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";

/**
 * Compositor de métrica personalizada — Emenda 1 do ADR-0023 (SCRUM-316..320).
 *
 * A tela É a árvore. Cada bloco é um nó; agrupar cria um operador com dois
 * filhos; desagrupar devolve o filho da esquerda. Não existe caixa de fórmula
 * em texto, e a ausência é a decisão: fórmula em texto seria expressão para
 * PARSEAR, que é exatamente o que a emenda manteve vetado. Aqui a composição
 * nasce estruturada e nunca deixa de ser.
 *
 * ⚠ ESTE COMPOSITOR NÃO MULTIPLICA POR 100. `count ÷ count` é razão (1,35), não
 * percentual (135%). Quem quer percentual acrescenta `× 100` — a profundidade 2
 * comporta, e o aviso abaixo do resultado diz isso quando a unidade é razão e o
 * formato escolhido é percentual.
 *
 * A prévia usa `kind='tree'`: a mesma função, o mesmo validador e o mesmo
 * avaliador da métrica salva. Prévia por caminho privilegiado mostraria número
 * que o salvo não reproduz.
 */

const MEDIDAS_COMPONIVEIS = ENGINE_METRICS.filter(
  (m) => m.measureRef.kind === "leaf" && UNIDADE_DA_MEDIDA[m.measureRef.id],
).map((m) => ({
  id: (m.measureRef as { kind: "leaf"; id: string }).id,
  label: m.label,
}));

const ROTULO_DA_MEDIDA = new Map(MEDIDAS_COMPONIVEIS.map((m) => [m.id, m.label]));

const ROTULO_DO_FORMATO: Record<MetricFormatId, string> = {
  currency_brl: "Moeda (R$)",
  integer: "Número inteiro",
  percent_1: "Percentual (%)",
  duration_human: "Duração",
  ratio_2: "Razão (2 casas)",
};

const NO_INICIAL: MetricTreeNode = {
  type: "op",
  op: "div",
  left: { type: "measure", id: "receita" },
  right: { type: "measure", id: "leads_criados" },
};

interface MetricComposerProps {
  aberto: boolean;
  period: StudioPeriod;
  range?: StudioRange | null;
  /** Definição em edição. `null` = criando uma nova. */
  editando: MetricCustomDefinition | null;
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (draft: MetricCustomDraft) => Promise<void>;
}

export function MetricComposer({
  aberto, period, range, editando, salvando, onFechar, onSalvar,
}: MetricComposerProps) {
  const [nome, setNome] = useState(editando?.name ?? "");
  const [arvore, setArvore] = useState<MetricTreeNode>(editando?.tree ?? NO_INICIAL);
  const [formato, setFormato] = useState<MetricFormatId | null>(editando?.format_id ?? null);

  const validacao = useMemo(
    () => validarArvore(arvore, (id) => UNIDADE_DA_MEDIDA[id]),
    [arvore],
  );
  const unidade = ehErro(validacao) ? null : validacao.unit;
  const formatosOk = unidade ? formatosDaUnidade(unidade) : [];

  // O formato escolhido pode deixar de ser coerente quando a árvore muda —
  // trocar `÷` por `+` leva `ratio` a `currency`. Cair no primeiro válido é
  // melhor que deixar a tela oferecer um formato que o banco recusa.
  const formatoEfetivo: MetricFormatId | null =
    formato && formatosOk.includes(formato) ? formato : (formatosOk[0] ?? null);

  const atual = periodoAtual(period, undefined, range);
  const previa = useMetricMeasure({
    measureRef: unidade && formatoEfetivo ? { kind: "tree", tree: arvore, format_id: formatoEfetivo } : null,
    recorte: "total",
    period: atual.period,
    ref: atual.ref,
    start: atual.start,
    end: atual.end,
    enabled: aberto && !!unidade,
  });

  const nomeLimpo = nome.trim();
  const podeSalvar = !!unidade && !!formatoEfetivo && nomeLimpo.length > 0 && !salvando;

  const salvar = useCallback(async () => {
    if (!formatoEfetivo || ehErro(validacao)) return;
    try {
      await onSalvar({ name: nomeLimpo, tree: arvore, format_id: formatoEfetivo });
      onFechar();
    } catch (e) {
      // O banco é a autoridade: mesmo com o cliente validando, um `INSERT`
      // pode cair (nome repetido, regra apertada depois da gravação). A
      // mensagem dele é mais precisa que qualquer coisa que se invente aqui.
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a métrica");
    }
  }, [arvore, formatoEfetivo, nomeLimpo, onFechar, onSalvar, validacao]);

  const nivel = profundidade(arvore);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-extrabold tracking-[-0.02em]">
            {editando ? "Editar métrica" : "Nova métrica"}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Combine as métricas que já existem. Até {PROFUNDIDADE_MAXIMA} operações encaixadas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="metrica-nome" className="text-[11px] font-semibold text-muted-foreground">
              Nome
            </label>
            <input
              id="metrica-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              placeholder="Receita por lead"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">Composição</span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {nivel} de {PROFUNDIDADE_MAXIMA}
              </span>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-3">
              <NoEditor node={arvore} nivel={1} onChange={setArvore} onRemover={null} />
            </div>
          </div>

          {/* Resultado — o número real do período, não uma simulação. */}
          <div className="rounded-xl border border-border/70 bg-card/50 px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
                {ehErro(validacao)
                  ? "Composição incompleta"
                  : descreverArvore(arvore, (id) => ROTULO_DA_MEDIDA.get(id) ?? id)}
              </span>
              <span className="shrink-0 text-[18px] font-extrabold tracking-[-0.03em] tabular-nums">
                {ehErro(validacao) ? EM_DASH
                  : previa.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
                  : formatMetricValue(previa.data?.value ?? null, formatoEfetivo ?? "ratio_2")}
              </span>
            </div>

            {ehErro(validacao) && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-destructive">
                <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                {validacao.erro}
              </p>
            )}
          </div>

          {unidade && (
            <div className="space-y-1.5">
              <label htmlFor="metrica-formato" className="text-[11px] font-semibold text-muted-foreground">
                Como mostrar · resultado em {rotuloDaUnidade(unidade)}
              </label>
              <select
                id="metrica-formato"
                value={formatoEfetivo ?? ""}
                onChange={(e) => setFormato(e.target.value as MetricFormatId)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] outline-none focus:border-primary/50"
              >
                {formatosOk.map((f) => (
                  <option key={f} value={f}>{ROTULO_DO_FORMATO[f]}</option>
                ))}
              </select>

              {/* A armadilha de 100×, dita em português no único lugar onde
                  alguém pode cair nela. */}
              {formatoEfetivo === "percent_1" && (
                <p className="text-[10px] leading-relaxed text-amber-500/90">
                  O número não é multiplicado por 100. Para ver percentual, acrescente
                  “× 100” à composição — senão 0,42 aparece como “0,4%”.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={!podeSalvar}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary px-4 py-[7px] text-[12px] font-bold text-primary-foreground transition-transform duration-150 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40"
          >
            {salvando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editando ? "Salvar" : "Criar métrica"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const VALOR_LITERAL = "__literal__";

interface NoEditorProps {
  node: MetricTreeNode;
  nivel: number;
  onChange: (n: MetricTreeNode) => void;
  /** `null` na raiz: a árvore inteira não se remove de dentro dela mesma. */
  onRemover: (() => void) | null;
}

/**
 * Um nó da árvore. Recursivo de propósito — é a mesma forma do dado, e é o que
 * faz "agrupar" ser uma operação local em vez de uma reescrita da expressão.
 */
function NoEditor({ node, nivel, onChange, onRemover }: NoEditorProps) {
  const podeAgrupar = nivel < PROFUNDIDADE_MAXIMA;

  if (node.type === "op") {
    return (
      <div className={cn(
        "flex flex-col gap-1.5 rounded-lg",
        nivel > 1 && "border border-dashed border-border/60 bg-muted/20 p-1.5",
      )}>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <NoEditor
              node={node.left}
              nivel={nivel + 1}
              onChange={(n) => onChange({ ...node, left: n })}
              onRemover={null}
            />
          </div>

          <select
            value={node.op}
            onChange={(e) => onChange({ ...node, op: e.target.value as MetricTreeOp })}
            aria-label="Operação"
            className="h-8 shrink-0 rounded-md border border-border bg-card px-1.5 text-[13px] font-bold outline-none focus:border-primary/50"
          >
            {OPERADORES.map((op) => (
              <option key={op} value={op}>{SIMBOLO_DO_OPERADOR[op]}</option>
            ))}
          </select>

          <div className="min-w-0 flex-1">
            <NoEditor
              node={node.right}
              nivel={nivel + 1}
              onChange={(n) => onChange({ ...node, right: n })}
              onRemover={null}
            />
          </div>

          {/* Desagrupar mantém o lado esquerdo. Descartar os dois seria perder
              trabalho sem aviso; manter o esquerdo é reversível em um clique. */}
          <button
            type="button"
            onClick={() => onChange(node.left)}
            aria-label="Desfazer esta operação"
            title="Desfazer esta operação"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-destructive"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const ehLiteral = node.type === "literal";

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={ehLiteral ? VALOR_LITERAL : node.id}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === VALOR_LITERAL
            ? { type: "literal", value: 1 }
            : { type: "measure", id: v });
        }}
        aria-label="Métrica"
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-1.5 text-[12px] outline-none focus:border-primary/50"
      >
        {MEDIDAS_COMPONIVEIS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
        <option value={VALOR_LITERAL}>Número fixo…</option>
      </select>

      {ehLiteral && (
        <input
          type="number"
          value={node.value}
          onChange={(e) => onChange({ type: "literal", value: Number(e.target.value) })}
          aria-label="Número fixo"
          className="h-8 w-20 shrink-0 rounded-md border border-border bg-card px-2 text-[12px] tabular-nums outline-none focus:border-primary/50"
        />
      )}

      {podeAgrupar && (
        <button
          type="button"
          onClick={() => onChange({
            type: "op", op: "div", left: node, right: { type: "literal", value: 1 },
          })}
          aria-label="Combinar com outra métrica"
          title="Combinar com outra métrica"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}

      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label="Remover"
          className="shrink-0 rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
