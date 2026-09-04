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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import {
  MEDIDAS_COM_ETAPA,
  exigeEtapas,
  faltamEtapas,
} from "@/modules/analytics/lib/metricas-com-etapa";
import { useFunisDaOrg, useEtapasDoFunil } from "@/modules/pipelines";

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

// As de coorte entram AQUI e não em `ENGINE_METRICS` (SCRUM-388): elas exigem
// `from_stage_key`/`to_stage_key`, e a lista lateral só sabe declarar filtro
// fixo. É o compositor que pergunta as etapas.
const MEDIDAS_ESCOLHIVEIS = [
  ...MEDIDAS_COMPONIVEIS,
  ...MEDIDAS_COM_ETAPA.map((m) => ({ id: m.id, label: m.label })),
];

const ROTULO_DA_MEDIDA = new Map(MEDIDAS_ESCOLHIVEIS.map((m) => [m.id, m.label]));

const ROTULO_DO_FORMATO: Record<MetricFormatId, string> = {
  currency_brl: "Moeda (R$)",
  integer: "Número inteiro",
  percent_1: "Percentual (%)",
  duration_human: "Duração",
  ratio_2: "Razão (2 casas)",
};

/**
 * Radix `Select` NÃO aceita `value=""` — string vazia é reservada para "limpar".
 * Os três campos de etapa precisam de um estado "ainda não escolhi", então ele
 * viaja como sentinela na UI e vira `undefined` no dado. O `<select>` nativo que
 * havia aqui usava `""` direto; a troca exige esta ponte.
 */
const SEM_ESCOLHA = "__sem_escolha__";

/** Altura única de todo controle do compositor. Havia três (h-8, h-9, h-10). */
const ALTURA = "h-9";

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
  // Etapa faltando NÃO é erro de árvore — a árvore está bem formada. É escolha
  // incompleta, e o efeito é o mesmo: não dá para medir. Sem esta trava a
  // definição SALVA levantaria 22023 toda vez que alguém abrisse, com um erro
  // que o cliente vê e não sabe consertar (SCRUM-388).
  const semEtapas = useMemo(() => faltamEtapas(arvore), [arvore]);
  const unidade = ehErro(validacao) || semEtapas ? null : validacao.unit;
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
      {/* 620 → 680: o operador virou segmented control de quatro botões e a
          linha da composição passou a ter ~100px fixos a mais. Em 620 a
          profundidade 3 espremia os dois selects a menos de 130px, onde
          "Leads que entraram" já não cabe. */}
      <DialogContent className="max-w-[680px]">
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
              className={cn(
                ALTURA,
                "w-full rounded-lg border border-border bg-card px-3 text-[13px] outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-primary/50",
              )}
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

          {/* Resultado — o número real do período, não uma simulação.
              Casca DIFERENTE da dos campos de propósito: sem borda, fundo
              afundado. Antes ele usava `border + bg-card`, a mesma roupa do
              input de nome e da caixa de composição, e o olho lia a saída como
              mais um campo para preencher. */}
          <div className="rounded-xl bg-muted/30 px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-[12px] leading-snug text-muted-foreground">
                {ehErro(validacao)
                  ? "Composição incompleta"
                  : descreverArvore(arvore, (id) => ROTULO_DA_MEDIDA.get(id) ?? id)}
              </span>
              <span className="shrink-0 text-[22px] font-extrabold leading-none tracking-[-0.035em] tabular-nums">
                {ehErro(validacao) || semEtapas ? EM_DASH
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

            {!ehErro(validacao) && semEtapas && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                Escolha o funil e as duas etapas para ver o número.
              </p>
            )}
          </div>

          {unidade && (
            <div className="space-y-1.5">
              {/* O rótulo diz o que ESCOLHER; a unidade derivada é FATO, e vira
                  sufixo discreto em vez de dividir o label com um "·". */}
              <label htmlFor="metrica-formato" className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Como mostrar</span>
                <span className="text-[11px] text-muted-foreground/50">
                  resultado em {rotuloDaUnidade(unidade)}
                </span>
              </label>
              <Select
                value={formatoEfetivo ?? undefined}
                onValueChange={(v) => setFormato(v as MetricFormatId)}
              >
                <SelectTrigger id="metrica-formato" className={cn(ALTURA, "text-[13px]")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formatosOk.map((f) => (
                    <SelectItem key={f} value={f} className="text-[13px]">
                      {ROTULO_DO_FORMATO[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

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
        {/* `flex-wrap`: rede de segurança da recursão. Na profundidade 3 os
            fixos (segmented + três botões) somam ~210px, e se a viewport for
            estreita a linha quebra em vez de espremer o select até o rótulo
            virar reticências. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="min-w-[130px] flex-1">
            <NoEditor
              node={node.left}
              nivel={nivel + 1}
              onChange={(n) => onChange({ ...node, left: n })}
              onRemover={null}
            />
          </div>

          {/* O operador é o CORAÇÃO da composição e era o menor controle da
              tela — um `<select>` de 20px de largura. São quatro valores, todos
              cabem: segmented control mostra os quatro e resolve em UM clique,
              em vez de abrir lista e escolher.
              `value` nunca fica vazio: ToggleGroup devolve "" ao clicar no item
              já ativo, e ignorar esse caso é o que impede a árvore de ficar sem
              operador. */}
          <ToggleGroup
            type="single"
            value={node.op}
            onValueChange={(v) => v && onChange({ ...node, op: v as MetricTreeOp })}
            aria-label="Operação"
            className={cn(ALTURA, "shrink-0 gap-0 rounded-lg border border-border bg-card p-0.5")}
          >
            {OPERADORES.map((op) => (
              <ToggleGroupItem
                key={op}
                value={op}
                aria-label={SIMBOLO_DO_OPERADOR[op]}
                className="h-full w-6 rounded-md px-0 text-[13px] font-bold text-muted-foreground/70 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {SIMBOLO_DO_OPERADOR[op]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="min-w-[130px] flex-1">
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
            className={cn(
              ALTURA,
              "grid w-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive",
            )}
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const ehLiteral = node.type === "literal";
  const pedeEtapas = node.type === "measure" && exigeEtapas(node.id);

  return (
    <div className="flex flex-col gap-1.5">
    {pedeEtapas && node.type === "measure" && (
      <EscolhaDeEtapas
        node={node}
        onChange={onChange}
      />
    )}
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={ehLiteral ? VALOR_LITERAL : node.id}
        onValueChange={(v) => {
          onChange(v === VALOR_LITERAL
            ? { type: "literal", value: 1 }
            : { type: "measure", id: v });
        }}
      >
        <SelectTrigger aria-label="Métrica" className={cn(ALTURA, "min-w-0 flex-1 text-[13px]")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MEDIDAS_ESCOLHIVEIS.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-[13px]">{m.label}</SelectItem>
          ))}
          <SelectItem value={VALOR_LITERAL} className="text-[13px]">Número fixo…</SelectItem>
        </SelectContent>
      </Select>

      {ehLiteral && (
        <input
          type="number"
          value={node.value}
          onChange={(e) => onChange({ type: "literal", value: Number(e.target.value) })}
          aria-label="Número fixo"
          className={cn(
            ALTURA,
            "w-20 shrink-0 rounded-lg border border-border bg-card px-2 text-[13px] tabular-nums outline-none focus:border-primary/50",
          )}
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
          className={cn(
            ALTURA,
            "grid w-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground",
          )}
        >
          <Plus className="h-4 w-4" />
        </button>
      )}

      {onRemover && (
        <button
          type="button"
          onClick={onRemover}
          aria-label="Remover"
          className={cn(
            ALTURA,
            "grid w-9 shrink-0 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive",
          )}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
    </div>
  );
}

interface EscolhaDeEtapasProps {
  node: Extract<MetricTreeNode, { type: "measure" }>;
  onChange: (n: MetricTreeNode) => void;
}

/**
 * Funil + etapa de origem + etapa de destino (SCRUM-388).
 *
 * Três escolhas, e a ordem importa: sem funil não há lista de etapas, porque
 * `stage_key` é slug POR ORGANIZAÇÃO e por funil. É por isso que estas medidas
 * não podem morar na lista lateral com filtro fixo — não existe valor que sirva
 * para todas as orgs.
 *
 * Trocar de funil LIMPA as duas etapas. Manter chaves do funil anterior
 * produziria um filtro que casa com nada: a métrica salvaria, abriria, e
 * devolveria vazio para sempre — sem erro nenhum para explicar.
 */
function EscolhaDeEtapas({ node, onChange }: EscolhaDeEtapasProps) {
  // Nome que a ORG usa — ver `useFunisDaOrg`.
  const { data: funis = [] } = useFunisDaOrg();
  const pipelineId = node.filters?.pipeline_id ?? "";
  const { etapas, isLoading } = useEtapasDoFunil(pipelineId || null);

  const trocarFunil = (id: string) => {
    onChange({
      ...node,
      filters: id ? { pipeline_id: id } : undefined,
    });
  };

  const trocarEtapa = (qual: "from_stage_key" | "to_stage_key", valor: string) => {
    const filters = { ...(node.filters ?? {}) };
    if (valor) filters[qual] = valor;
    else delete filters[qual];
    onChange({ ...node, filters });
  };

  const gatilho = cn(ALTURA, "min-w-0 flex-1 text-[13px]");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] p-2">
      <Select
        value={pipelineId || SEM_ESCOLHA}
        onValueChange={(v) => trocarFunil(v === SEM_ESCOLHA ? "" : v)}
      >
        <SelectTrigger aria-label="Funil" className={gatilho}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_ESCOLHA} className="text-[13px]">Escolha o funil…</SelectItem>
          {/* `.filter(f => f.id)`: Radix LEVANTA se um item tiver value "".
              O id vem do banco, então a garantia não é do tipo — é desta linha.
              Um funil sem id derrubaria o compositor inteiro, não só a opção.

              `is_active`: `usePipelines()` traz a tabela-espelho inteira, sem
              filtrar. Peneiramos AQUI e não na fonte porque o painel de
              automações precisa listar o funil desativado para o usuário
              conseguir desmarcá-lo. Aqui não: compor métrica sobre funil
              excluído devolve vazio para sempre, sem erro que explique. */}
          {funis.filter((f) => f.id && f.is_active !== false).map((f) => (
            <SelectItem key={f.id} value={f.id} className="text-[13px]">{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Select
          value={node.filters?.from_stage_key ?? SEM_ESCOLHA}
          onValueChange={(v) => trocarEtapa("from_stage_key", v === SEM_ESCOLHA ? "" : v)}
          disabled={!pipelineId || isLoading}
        >
          <SelectTrigger aria-label="Etapa de origem" className={gatilho}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_ESCOLHA} className="text-[13px]">De…</SelectItem>
            {etapas.filter((e) => e.stageKey).map((e) => (
              <SelectItem key={e.stageKey} value={e.stageKey} className="text-[13px]">{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="shrink-0 text-[13px] text-muted-foreground">→</span>

        <Select
          value={node.filters?.to_stage_key ?? SEM_ESCOLHA}
          onValueChange={(v) => trocarEtapa("to_stage_key", v === SEM_ESCOLHA ? "" : v)}
          disabled={!pipelineId || isLoading}
        >
          <SelectTrigger aria-label="Etapa de destino" className={gatilho}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_ESCOLHA} className="text-[13px]">Para…</SelectItem>
            {etapas.filter((e) => e.stageKey).map((e) => (
              <SelectItem key={e.stageKey} value={e.stageKey} className="text-[13px]">{e.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pipelineId && !isLoading && etapas.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Este funil não tem etapas ativas.
        </p>
      )}
    </div>
  );
}
