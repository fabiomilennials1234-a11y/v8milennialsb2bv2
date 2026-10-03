/**
 * AddToFunilDialog — "Adicionar a funil" para 1 lead (single-lead).
 *
 * Espelha o BulkMoveDialog (bulk-actions), mas para um único lead e restrito a
 * funis CUSTOM. Semântica de domínio: um lead pode estar em múltiplos pipes ao
 * mesmo tempo — a ação ADICIONA a outro funil, não move para fora do atual.
 *
 * Consome pipeline-ops via a porta injetada (`PipeOpsPort`), nunca importando
 * `@/modules/pipelines` diretamente (preserva a inversão leads↔pipelines). O
 * `pipeOps` chega por prop: o LeadCard só monta estes componentes quando há um
 * `PipeOpsProvider` acima na árvore (via `usePipeOpsOptional`), garantindo que
 * as chamadas de hook do port são sempre válidas.
 */
import { useState } from "react";
import { FolderPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { PipeOpsPort } from "../../pipe-ops";

/**
 * Item de menu "Adicionar a funil". Só renderiza quando a org tem ≥1 funil
 * custom ativo (`useCustomPipelines` já filtra `is_active`) — evita menu inútil.
 */
export function AddToFunilMenuItem({
  pipeOps,
  onSelect,
}: {
  pipeOps: PipeOpsPort;
  onSelect: () => void;
}) {
  const { data: customPipelines = [] } = pipeOps.useCustomPipelines();
  if (customPipelines.length === 0) return null;
  return (
    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSelect(); }}>
      <FolderPlus className="w-4 h-4 mr-2" /> Adicionar a funil
    </DropdownMenuItem>
  );
}

/** Dialog de seleção funil + etapa e confirmação (insert em custom_pipe_entries). */
export function AddToFunilDialog({
  pipeOps,
  leadId,
  open,
  onOpenChange,
}: {
  pipeOps: PipeOpsPort;
  leadId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: customPipelines = [] } = pipeOps.useCustomPipelines();
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");

  const { data: stages = [] } = pipeOps.useCustomPipelineStages(pipelineId || undefined);
  const addLead = pipeOps.useAddLeadToCustomPipe();

  const selectedPipeline = customPipelines.find((p) => p.id === pipelineId);

  const handleSubmit = async () => {
    if (!pipelineId || !stageId) return;
    try {
      await addLead.mutateAsync({
        pipeline_id: pipelineId,
        lead_id: leadId,
        stage_id: stageId,
      });
      toast.success(`Lead adicionado ao funil "${selectedPipeline?.name ?? ""}"`);
      onOpenChange(false);
      setPipelineId("");
      setStageId("");
    } catch (e) {
      // O hook lança "Este lead já está neste funil" em duplicata.
      toast.error(e instanceof Error ? e.message : "Erro ao adicionar ao funil");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Adicionar a funil</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Funil</label>
            <Select
              value={pipelineId}
              onValueChange={(v) => { setPipelineId(v); setStageId(""); }}
            >
              <SelectTrigger><SelectValue placeholder="Selecionar funil" /></SelectTrigger>
              <SelectContent>
                {customPipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Etapa</label>
            <Select value={stageId} onValueChange={setStageId} disabled={!pipelineId}>
              <SelectTrigger><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      {s.color && (
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: s.color }}
                        />
                      )}
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!pipelineId || !stageId || addLead.isPending}>
            {addLead.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
