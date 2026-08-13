import { useCallback, useMemo, useState } from "react";
import { AlertCircle, Loader2, Minus, Plus, Sparkles } from "lucide-react";
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
  ROTULO_DO_OPERADOR,
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
import { periodoAtual, type StudioPeriod } from "@/modules/analytics/lib/metrics-studio-period";
import { formatMetricValue } from "@/modules/analytics/lib/tv-metric-format";

/**
 * Compositor de métrica personalizada — Emenda 1 do ADR-0023 (SCRUM-316..320).
 *
 * A tela É a árvore. Cada bloco é um nó; combinar cria um operador com dois
 * filhos; desfazer devolve o filho da esquerda. Não existe caixa de fórmula em
 * texto, e a ausência é a decisão: fórmula em texto seria expressão para
 * PARSEAR, que é o que a emenda manteve vetado. Aqui a composição nasce
 * estruturada e nunca deixa de ser.
 *
 * O DESENHO, E POR QUE ELE É ASSIM
 *
 * O RESULTADO é o herói e fica no topo. A primeira versão o escondia embaixo do
 * formulário, e a pessoa montava às cegas: o número que ela está construindo é
 * a única coisa que diz se a composição faz sentido. Ele aparece grande, com a
 * expressão por extenso embaixo — "R$ 394,94 · Faturamento ÷ Leads que
 * entraram" se lê como frase.
 *
 * O OPERADOR virou grupo segmentado, não `<select>`. São quatro opções fixas e
 * simbólicas; esconder `+ − × ÷` atrás de um dropdown custa dois cliques para
 * trocar entre coisas que cabem lado a lado.
 *
 * As SUGESTÕES existem porque a página em branco é o problema real desta tela:
 * quem abre não sabe o que dá para montar. Cada atalho é uma composição válida
 * de um clique — inclusive "Negócios por lead", que é exatamente o caso em que
 * o motor v1 erraria por 100×.
 *
 * ⚠ ESTE COMPOSITOR NÃO MULTIPLICA POR 100. `count ÷ count` é razão (1,65), não
 * percentual (165%). Quem quer percentual acrescenta `× 100` — a profundidade 2
 * comporta, e o aviso abaixo do formato diz isso quando ele é percentual.
 *
 * A prévia usa `kind='tree'`: mesma função, mesmo validador e mesmo avaliador
 * da métrica salva. Prévia por caminho privilegiado mostraria número que o
 * salvo não reproduz.
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

const medida = (id: string): MetricTreeNode => ({ type: "measure", id });
const literal = (value: number): MetricTreeNode => ({ type: "literal", value });
const op = (o: MetricTreeOp, left: MetricTreeNode, right: MetricTreeNode): MetricTreeNode => ({
  type: "op", op: o, left, right,
});

const NO_INICIAL = op("div", medida("receita"), medida("leads_criados"));

/**
 * Atalhos de composição. Todos usam medidas que o catálogo v1 tem, então
 * funcionam em qualquer organização — nenhum depende de fatia do SCRUM-311.
 */
const SUGESTOES: { nome: string; arvore: MetricTreeNode; explica: string }[] = [
  {
    nome: "Receita por lead",
    arvore: op("div", medida("receita"), medida("leads_criados")),
    explica: "quanto cada lead que entrou trouxe de dinheiro",
  },
  {
    nome: "Negócios por lead",
    arvore: op("div", medida("negocios_abertos"), medida("leads_criados")),
    explica: "quantas oportunidades cada pessoa gera",
  },
  {
    nome: "Receita por dia útil",
    arvore: op("div", medida("receita"), literal(22)),
    explica: "faturamento diluído nos dias trabalhados",
  },
];

interface MetricComposerProps {
  aberto: boolean;
  period: StudioPeriod;
  /** Definição em edição. `null` = criando uma nova. */
  editando: MetricCustomDefinition | null;
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (draft: MetricCustomDraft) => Promise<void>;
}

export function MetricComposer({
  aberto, period, editando, salvando, onFechar, onSalvar,
}: MetricComposerProps) {
  const [nome, setNome] = useState(editando?.name ?? "");
  const [arvore, setArvore] = useState<MetricTreeNode>(editando?.tree ?? NO_INICIAL);
  const [formato, setFormato] = useState<MetricFormatId | null>(editando?.format_id ?? null);
  const [tocou, setTocou] = useState(editando !== null);

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

  const atual = periodoAtual(period);
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

  const aplicarSugestao = useCallback((s: (typeof SUGESTOES)[number]) => {
    setArvore(s.arvore);
    setTocou(true);
    setNome((atualNome) => (atualNome.trim() ? atualNome : s.nome));
  }, []);

  const mudarArvore = useCallback((n: MetricTreeNode) => {
    setArvore(n);
    setTocou(true);
  }, []);

  const salvar = useCallback(async () => {
    if (!formatoEfetivo || ehErro(validacao)) return;
    try {
      await onSalvar({ name: nomeLimpo, tree: arvore, format_id: formatoEfetivo });
      onFechar();
    } catch (e) {
      // O banco é a autoridade: mesmo com o cliente validando, um `INSERT` pode
      // cair (nome repetido, regra apertada depois da gravação). A mensagem
      // dele é mais precisa que qualquer coisa que se invente aqui.
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a métrica");
    }
  }, [arvore, formatoEfetivo, nomeLimpo, onFechar, onSalvar, validacao]);

  const nivel = profundidade(arvore);
  const expressao = ehErro(validacao)
    ? null
    : descreverArvore(arvore, (id) => ROTULO_DA_MEDIDA.get(id) ?? id);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-[640px] gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-border/60 px-6 pb-4 pt-5">
          <DialogTitle className="text-[16px] font-extrabold tracking-[-0.02em]">
            {editando ? "Editar métrica" : "Nova métrica"}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed">
            Combine o que você já mede. Até {PROFUNDIDADE_MAXIMA} operações encaixadas.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(70vh,640px)] space-y-6 overflow-y-auto px-6 py-5">
          {/* ── O resultado é o herói ─────────────────────────────────── */}
          <section
            className={cn(
              "relative overflow-hidden rounded-2xl border px-5 py-4",
              ehErro(validacao)
                ? "border-destructive/30 bg-destructive/[0.04]"
                : "border-border/70 bg-gradient-to-b from-primary/[0.07] to-transparent",
            )}
          >
            {ehErro(validacao) ? (
              <div className="flex items-start gap-2 py-1">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-[13px] font-semibold text-destructive">Composição incompleta</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{validacao.erro}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[34px] font-extrabold leading-none tracking-[-0.045em] tabular-nums">
                    {previa.isLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
                    ) : (
                      formatMetricValue(previa.data?.value ?? null, formatoEfetivo ?? "ratio_2")
                    )}
                  </span>
                  {unidade && (
                    <span className="rounded-full border border-border/70 bg-background/60 px-2 py-[3px] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {rotuloDaUnidade(unidade)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{expressao}</p>
              </>
            )}
          </section>

          {/* ── Sugestões: só enquanto ninguém mexeu ──────────────────── */}
          {!tocou && (
            <section className="space-y-2">
              <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground/70">
                <Sparkles className="h-3 w-3" />
                Comece por uma destas
              </p>
              <div className="grid gap-1.5 sm:grid-cols-3">
                {SUGESTOES.map((s) => (
                  <button
                    key={s.nome}
                    type="button"
                    onClick={() => aplicarSugestao(s)}
                    className={cn(
                      "rounded-xl border border-border/70 bg-card px-3 py-2.5 text-left",
                      "transition-colors duration-150 hover:border-primary/40 hover:bg-muted/40",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <span className="block text-[12px] font-semibold">{s.nome}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
                      {s.explica}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ── A árvore ──────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground/70">
                Composição
              </p>
              <span className="flex items-center gap-1" aria-label={`${nivel} de ${PROFUNDIDADE_MAXIMA} operações`}>
                {Array.from({ length: PROFUNDIDADE_MAXIMA }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={cn(
                      "size-1.5 rounded-full transition-colors",
                      i < nivel ? "bg-primary" : "bg-border",
                    )}
                  />
                ))}
                <span className="ml-1 text-[10px] tabular-nums text-muted-foreground/60">
                  {nivel} de {PROFUNDIDADE_MAXIMA}
                </span>
              </span>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/40 p-3">
              <NoEditor node={arvore} nivel={1} onChange={mudarArvore} />
            </div>
          </section>

          {/* ── Nome + formato ───────────────────────────────────────── */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="metrica-nome" className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground/70">
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

            {unidade && (
              <div className="space-y-1.5">
                <label htmlFor="metrica-formato" className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-muted-foreground/70">
                  Como mostrar
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
              </div>
            )}
          </section>

          {/* A armadilha de 100×, dita em português no único lugar onde alguém
              pode cair nela. */}
          {formatoEfetivo === "percent_1" && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-amber-500/90">
              O número <strong className="font-semibold">não</strong> é multiplicado por 100. Para
              ver percentual, acrescente “× 100” à composição — senão 0,42 aparece como “0,4%”.
            </p>
          )}
        </div>

        <DialogFooter className="border-t border-border/60 px-6 py-4">
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

/**
 * Um nó da árvore. Recursivo de propósito — é a mesma forma do dado, e é o que
 * faz "combinar" ser uma operação local em vez de uma reescrita da expressão.
 */
function NoEditor({
  node,
  nivel,
  onChange,
}: {
  node: MetricTreeNode;
  nivel: number;
  onChange: (n: MetricTreeNode) => void;
}) {
  const podeCombinar = nivel < PROFUNDIDADE_MAXIMA;

  if (node.type === "op") {
    return (
      <div
        className={cn(
          "flex flex-col gap-2",
          nivel > 1 && "rounded-lg border border-dashed border-border/60 bg-muted/20 p-2",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <NoEditor node={node.left} nivel={nivel + 1} onChange={(n) => onChange({ ...node, left: n })} />
          </div>

          {/* Grupo segmentado: quatro símbolos lado a lado. Um `<select>` aqui
              custaria dois cliques para trocar entre coisas que cabem juntas. */}
          <div
            role="radiogroup"
            aria-label="Operação"
            className="flex shrink-0 gap-[2px] rounded-lg border border-border bg-card p-[3px]"
          >
            {OPERADORES.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={node.op === o}
                aria-label={ROTULO_DO_OPERADOR[o]}
                onClick={() => onChange({ ...node, op: o })}
                className={cn(
                  "size-6 rounded-md text-[13px] font-bold leading-none transition-all",
                  node.op === o
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {SIMBOLO_DO_OPERADOR[o]}
              </button>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <NoEditor node={node.right} nivel={nivel + 1} onChange={(n) => onChange({ ...node, right: n })} />
          </div>

          {/* Desfazer mantém o lado esquerdo. Descartar os dois seria perder
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
          onChange(v === VALOR_LITERAL ? { type: "literal", value: 1 } : { type: "measure", id: v });
        }}
        aria-label="Métrica"
        className={cn(
          "h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-[12px] font-medium",
          "outline-none transition-colors focus:border-primary/50",
        )}
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
          className="h-9 w-[74px] shrink-0 rounded-lg border border-border bg-card px-2 text-[12px] tabular-nums outline-none focus:border-primary/50"
        />
      )}

      {podeCombinar && (
        <button
          type="button"
          onClick={() => onChange({ type: "op", op: "div", left: node, right: { type: "literal", value: 1 } })}
          aria-label="Combinar com outra métrica"
          title="Combinar com outra métrica"
          className="shrink-0 rounded-lg border border-dashed border-border p-[7px] text-muted-foreground/60 transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
