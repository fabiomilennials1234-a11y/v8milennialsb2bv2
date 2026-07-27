/**
 * ContextPanelFunnels — card "Funis do lead" no painel de contexto do chat.
 *
 * Variação B aprovada (mockup): lista cada funil em que o lead está, com a etapa
 * como chip clicável pra mover — sem sair da conversa. Move via
 * `useMovePipelineEntry` (escreve `pipeline_entries`, canônico; zero legacy).
 *
 * Etapa terminal (won/lost) registra/estorna receita+comissão via trigger
 * (fn_capture_pipeline_stage_event → sale_events) — por isso exige confirmação.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GitBranch, ChevronDown, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLeadAllPipelines } from "@/modules/leads";
import {
  useMovePipelineEntry,
  useCreatePipelineEntry,
  usePipelineDisplayConfig,
} from "@/modules/pipelines";
import {
  toFunnelRows,
  availableFunnelsToAdd,
  isTerminalRole,
  terminalKind,
  type FunnelCardRow,
  type FunnelStageView,
  type AddableFunnel,
} from "./contextPanelFunnelHelpers";

interface ContextPanelFunnelsProps {
  leadId: string;
}

interface PendingTerminal {
  entryId: string;
  stage: FunnelStageView;
  funnelLabel: string;
}

export function ContextPanelFunnels({ leadId }: ContextPanelFunnelsProps) {
  const queryClient = useQueryClient();
  const { data: pipelines = [], isLoading } = useLeadAllPipelines(leadId);
  const { data: displayConfig = [] } = usePipelineDisplayConfig();
  const moveEntry = useMovePipelineEntry();
  const createEntry = useCreatePipelineEntry();

  const rows = useMemo(() => toFunnelRows(pipelines, displayConfig), [pipelines, displayConfig]);
  const available = useMemo(
    () => availableFunnelsToAdd(pipelines, displayConfig),
    [pipelines, displayConfig],
  );
  const [addOpen, setAddOpen] = useState(false);

  // Overlay otimista: entryId → stageKey pendente até o refetch refletir.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<PendingTerminal | null>(null);

  // Limpa o pending quando o dado fresco já bate com o valor movido.
  useEffect(() => {
    setPending((prev) => {
      if (!Object.keys(prev).length) return prev;
      let changed = false;
      const next = { ...prev };
      for (const row of rows) {
        if (next[row.entryId] != null && row.currentStageKey === next[row.entryId]) {
          delete next[row.entryId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const doMove = (entryId: string, stageKey: string) => {
    setPending((p) => ({ ...p, [entryId]: stageKey }));
    moveEntry.mutate(
      { id: entryId, stageKey },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
        },
        onError: () => {
          setPending((p) => {
            const next = { ...p };
            delete next[entryId];
            return next;
          });
          toast.error("Falha ao mover etapa");
        },
      },
    );
  };

  const onPickStage = (row: FunnelCardRow, stage: FunnelStageView) => {
    const currentKey = pending[row.entryId] ?? row.currentStageKey;
    if (stage.key === currentKey) return; // já está nela
    if (isTerminalRole(stage.role)) {
      setConfirm({ entryId: row.entryId, stage, funnelLabel: row.label });
      return;
    }
    doMove(row.entryId, stage.key);
  };

  const doAdd = (funnel: AddableFunnel) => {
    setAddOpen(false);
    // Responsável fica no LEAD (não assinala a entry) — sem round-robin; os
    // workflows de stage_changed/entrada disparam normalmente (paridade kanban).
    createEntry.mutate(
      {
        pipeline_id: funnel.pipelineId,
        lead_id: leadId,
        stage_key: funnel.firstStageKey,
        deal_id: null,
        assigned_to: null,
        notes: null,
        metadata: {},
        closed_at: null,
      } as Parameters<typeof createEntry.mutate>[0],
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
          toast.success(`Adicionado a ${funnel.label}`);
        },
        onError: () => toast.error("Falha ao adicionar ao funil"),
      },
    );
  };

  const addButton =
    available.length > 0 ? (
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 px-3 py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
          >
            {createEntry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Adicionar a um funil
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Adicionar a
          </p>
          <div className="flex flex-col gap-0.5">
            {available.map((f) => (
              <button
                key={f.pipelineId}
                type="button"
                onClick={() => doAdd(f)}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.color }} />
                <span className="min-w-0 flex-1 truncate">{f.label}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    ) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <GitBranch className="h-7 w-7 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">Lead não está em nenhum funil</p>
        {addButton && <div className="w-full pt-1">{addButton}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const currentKey = pending[row.entryId] ?? row.currentStageKey;
        const current = row.stages.find((s) => s.key === currentKey) ?? null;
        const isMoving = pending[row.entryId] != null;
        return (
          <div
            key={row.key}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 p-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: row.color }} />
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-foreground">{row.label}</div>
                <div className="text-[10.5px] text-muted-foreground/70">Clique na etapa p/ mover</div>
              </div>
            </div>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold transition-opacity",
                    isMoving && "opacity-60",
                  )}
                  style={{ background: `${row.color}22`, color: row.color }}
                  aria-label={`Etapa em ${row.label}: ${current?.label ?? "—"}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.color }} />
                  {current?.label ?? "—"}
                  {isMoving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {row.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {row.stages.map((s) => {
                    const active = s.key === currentKey;
                    const terminal = isTerminalRole(s.role);
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => onPickStage(row, s)}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-muted",
                          active && "bg-muted",
                        )}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: terminal ? (s.role === "won" ? "#34d399" : "#fb7185") : row.color }}
                        />
                        <span className="min-w-0 flex-1 truncate">{s.label}</span>
                        {terminal && (
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                            {s.role === "won" ? "ganho" : "perda"}
                          </span>
                        )}
                        {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        );
      })}

      {addButton}

      {/* Confirmação de etapa terminal (registra/estorna receita + comissão) */}
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {terminalKind(confirm?.stage.role) === "won"
                ? "Marcar como Ganho?"
                : "Marcar como Perdido?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Mover para <b>{confirm?.stage.label}</b> em <b>{confirm?.funnelLabel}</b>{" "}
              {terminalKind(confirm?.stage.role) === "won"
                ? "registra uma venda no funil — entra no cálculo de receita e comissão."
                : "registra uma perda no funil e afeta as métricas de conversão."}{" "}
              Confirmar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) doMove(confirm.entryId, confirm.stage.key);
                setConfirm(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
