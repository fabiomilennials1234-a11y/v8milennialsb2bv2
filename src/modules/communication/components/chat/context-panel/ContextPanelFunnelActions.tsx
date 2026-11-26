import { useId, useRef, useState } from "react";
import { ArrowRightLeft, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useExcluirNegocio } from "@/modules/leads";
import type { useMovePipelineEntry } from "@/modules/pipelines";
import { notifyError } from "@/shared/errors";
import { terminalKind, type AddableFunnel, type FunnelCardRow } from "./contextPanelFunnelHelpers";

interface Props {
  row: FunnelCardRow;
  leadId: string;
  available: AddableFunnel[];
  canMove: boolean;
  canRemove: boolean;
  busy: boolean;
  moveEntry: ReturnType<typeof useMovePipelineEntry>["mutateAsync"];
}

const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

export function ContextPanelFunnelActions({ row, leadId, available, canMove, canRemove, busy, moveEntry }: Props) {
  const { excluir, excluindo } = useExcluirNegocio();
  const [action, setAction] = useState<"move" | "remove" | null>(null);
  const [pipelineId, setPipelineId] = useState("");
  const [stageKey, setStageKey] = useState("");
  const [moving, setMoving] = useState(false);
  const selectId = useId();
  const trigger = useRef<HTMLButtonElement>(null);

  const destinations = available.filter((funnel) =>
    funnel.pipelineId !== row.pipelineId && funnel.stages.some((stage) => !terminalKind(stage)),
  );
  const destination = destinations.find((funnel) => funnel.pipelineId === pipelineId);
  const stages = destination?.stages.filter((stage) => !terminalKind(stage)) ?? [];
  const targetStage = stages.find((stage) => stage.key === stageKey);
  const canTransfer = canMove && !row.isClosed;
  const working = moving || excluindo;

  async function transfer() {
    if (!canTransfer || busy || working || !destination || !targetStage) return;
    setMoving(true);
    try {
      await moveEntry({
        id: row.entryId,
        transfer: { fromPipelineId: row.pipelineId, toPipelineId: destination.pipelineId, leadId },
        ...(targetStage.stageId ? { stageId: targetStage.stageId } : { stageKey: targetStage.key }),
      });
      setAction(null);
      toast.success(`Negócio movido para ${destination.label}.`);
    } catch (error) {
      notifyError(error, { fallback: "Não foi possível mover o negócio para outro funil." });
    } finally {
      setMoving(false);
    }
  }

  async function remove() {
    if (!canRemove || busy || working) return;
    const result = await excluir({
      entryId: row.entryId,
      leadId,
      pipelineId: row.pipelineId,
      ehSystem: row.isSystem,
      funil: row.label,
    });
    if (result === "excluido" || result === "ja-nao-existia") setAction(null);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    trigger.current?.focus();
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            disabled={busy || working}
            aria-label={`Ações do negócio em ${row.label}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
          if (action) event.preventDefault();
        }}>
          {canTransfer && (
            <DropdownMenuItem onSelect={() => {
              setPipelineId("");
              setStageKey("");
              setAction("move");
            }}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Mover para outro funil
            </DropdownMenuItem>
          )}
          {canRemove && (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setAction("remove")}>
              <Trash2 className="mr-2 h-4 w-4" />
              Remover do funil
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={action === "move"} onOpenChange={(open) => {
        if (!open && !working) setAction(null);
      }}>
        <DialogContent className="z-[60]" overlayClassName="z-[60]" onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>Mover para outro funil</DialogTitle>
            <DialogDescription>
              Escolha o destino do negócio em <strong>{row.label}</strong>.
            </DialogDescription>
          </DialogHeader>
          {destinations.length ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${selectId}-funnel`}>Funil de destino</Label>
                <select
                  id={`${selectId}-funnel`}
                  className={selectClass}
                  value={pipelineId}
                  disabled={working}
                  onChange={(event) => {
                    setPipelineId(event.target.value);
                    setStageKey("");
                  }}
                >
                  <option value="">Selecione um funil</option>
                  {destinations.map((funnel) => (
                    <option key={funnel.pipelineId} value={funnel.pipelineId}>{funnel.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${selectId}-stage`}>Etapa de destino</Label>
                <select
                  id={`${selectId}-stage`}
                  className={selectClass}
                  value={stageKey}
                  disabled={working || !destination}
                  onChange={(event) => setStageKey(event.target.value)}
                >
                  <option value="">Selecione uma etapa</option>
                  {stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum outro funil está disponível para este negócio.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={working} onClick={() => setAction(null)}>Cancelar</Button>
            <Button type="button" disabled={busy || working || !canTransfer || !targetStage} onClick={() => void transfer()}>
              {moving ? "Movendo…" : "Mover negócio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={action === "remove"} onOpenChange={(open) => {
        if (!open && !working) setAction(null);
      }}>
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover negócio do funil?</AlertDialogTitle>
            <AlertDialogDescription>
              O negócio será removido de <strong>{row.label}</strong>. O lead, a conversa e os demais negócios serão preservados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || working || !canRemove}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {excluindo ? "Removendo…" : "Remover negócio"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
