import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRightLeft,
  UserPlus,
  Tag,
  Trash2,
  X,
  Loader2,
  CheckCircle2,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectSeparator, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useTeamMembers } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { usePipeOps } from "../../pipe-ops";
import type { PipelineType } from "@/contracts/pipe";
import {
  useBulkMoveStage,
  useBulkMoveToCustomPipe,
  useBulkAssign,
  useBulkTag,
  useBulkDelete,
} from "@/modules/leads/hooks/useBulkActions";
import { QuickBlastDialog } from "./QuickBlastDialog";

interface BulkActionBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  leadIds: string[];
  /**
   * When provided, "Disparar" hands the selected ids to the host instead of
   * opening the in-bar QuickBlastDialog. The pipelines funnel page wires this to
   * open the full Disparo wizard pre-seeded with the manual selection — keeping
   * the leads→pipelines dependency OUT of this module (forbidden direction). The
   * host owns clearing the selection after a successful blast. When omitted, the
   * bar keeps its standalone QuickBlastDialog (back-compat for other mounts).
   */
  onDisparar?: (leadIds: string[]) => void;
}

export function BulkActionBar({ selectedIds, onClear, leadIds, onDisparar }: BulkActionBarProps) {
  const count = selectedIds.size;
  const [moveOpen, setMoveOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [blastOpen, setBlastOpen] = useState(false);

  if (count === 0) return null;

  const ids = leadIds.filter((id) => selectedIds.has(id));

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg"
        >
          <Badge className="mr-1 tabular-nums">{count}</Badge>
          <span className="text-sm text-muted-foreground mr-2">selecionados</span>

          <Button size="sm" variant="outline" onClick={() => setMoveOpen(true)}>
            <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
            Mover
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            Atribuir
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTagOpen(true)}>
            <Tag className="mr-1.5 h-3.5 w-3.5" />
            Tags
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (onDisparar ? onDisparar(ids) : setBlastOpen(true))}
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Disparar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Excluir
          </Button>

          <Button size="icon" variant="ghost" className="h-7 w-7 ml-1" onClick={onClear}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </motion.div>
      </AnimatePresence>

      <BulkMoveDialog open={moveOpen} onOpenChange={setMoveOpen} leadIds={ids} onSuccess={onClear} />
      <BulkAssignDialog open={assignOpen} onOpenChange={setAssignOpen} leadIds={ids} onSuccess={onClear} />
      <BulkTagDialog open={tagOpen} onOpenChange={setTagOpen} leadIds={ids} onSuccess={onClear} />
      <BulkDeleteDialog open={deleteOpen} onOpenChange={setDeleteOpen} leadIds={ids} count={count} onSuccess={onClear} />
      {/* In-bar QuickBlast only when the host did NOT take over "Disparar". */}
      {!onDisparar && (
        <QuickBlastDialog open={blastOpen} onOpenChange={setBlastOpen} leadIds={ids} onDone={onClear} />
      )}
    </>
  );
}

function BulkMoveDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
  onSuccess: () => void;
}) {
  const CUSTOM_PREFIX = "custom:";
  const { usePipelineStages, useCustomPipelines, useCustomPipelineStages } = usePipeOps();

  // `pipe` carrega tanto os 3 pipes system (values whatsapp/confirmacao/propostas)
  // quanto os funis custom, sinalizados pelo sentinela `custom:<pipeline.id>`.
  const [pipe, setPipe] = useState<string>("whatsapp");
  const [stage, setStage] = useState("");

  const isCustom = pipe.startsWith(CUSTOM_PREFIX);
  const customPipelineId = isCustom ? pipe.slice(CUSTOM_PREFIX.length) : undefined;

  const { data: customPipelines = [] } = useCustomPipelines();
  // Ambos os hooks de stages são chamados incondicionalmente (regras de hooks);
  // só o relevante ao tipo selecionado alimenta o dropdown de etapas.
  const { data: systemStages = [] } = usePipelineStages(
    (isCustom ? "whatsapp" : pipe) as PipelineType,
  );
  const { data: customStages = [] } = useCustomPipelineStages(customPipelineId);

  const moveStage = useBulkMoveStage();
  const moveCustom = useBulkMoveToCustomPipe();
  const isPending = moveStage.isPending || moveCustom.isPending;

  const handleSubmit = async () => {
    if (!stage) return;
    try {
      if (isCustom && customPipelineId) {
        await moveCustom.mutateAsync({
          lead_ids: leadIds,
          pipeline_id: customPipelineId,
          stage_id: stage,
        });
      } else {
        await moveStage.mutateAsync({
          lead_ids: leadIds,
          target_pipe: pipe,
          target_stage: stage,
        });
      }
      toast.success(`${leadIds.length} leads movidos`);
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error("Erro ao mover leads");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover {leadIds.length} leads</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Pipeline</label>
            <Select value={pipe} onValueChange={(v) => { setPipe(v); setStage(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Padrao</SelectLabel>
                  <SelectItem value="whatsapp">Qualificacao</SelectItem>
                  <SelectItem value="confirmacao">Confirmacao</SelectItem>
                  <SelectItem value="propostas">Propostas</SelectItem>
                </SelectGroup>
                {customPipelines.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Personalizados</SelectLabel>
                      {customPipelines.map((p) => (
                        <SelectItem key={p.id} value={`${CUSTOM_PREFIX}${p.id}`}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Etapa</label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger><SelectValue placeholder="Selecionar etapa" /></SelectTrigger>
              <SelectContent>
                {isCustom
                  ? customStages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))
                  : systemStages.map((s: any) => (
                      <SelectItem key={s.id || s.stage_key} value={s.stage_key}>
                        {s.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!stage || isPending}>
            {isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkAssignDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
  onSuccess: () => void;
}) {
  const [responsibleId, setResponsibleId] = useState<string>("none");
  const { data: members = [] } = useTeamMembers();
  const mutation = useBulkAssign();
  const active = members.filter((m: any) => m.is_active);

  const handleSubmit = async () => {
    const id = responsibleId === "none" ? null : responsibleId;
    try {
      await mutation.mutateAsync({
        lead_ids: leadIds,
        responsible_id: id,
        sdr_id: id,
        sale_responsible_id: id,
      });
      toast.success(`${leadIds.length} leads atribuidos`);
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error("Erro ao atribuir leads");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuir {leadIds.length} leads</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <label className="text-sm font-medium">Responsavel</label>
          <Select value={responsibleId} onValueChange={setResponsibleId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Remover responsavel</SelectItem>
              {active.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Atribuir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkTagDialog({
  open,
  onOpenChange,
  leadIds,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
  onSuccess: () => void;
}) {
  const [addTags, setAddTags] = useState<string[]>([]);
  const { data: tags = [] } = useTags();
  const mutation = useBulkTag();

  const toggleTag = (id: string) => {
    setAddTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const handleSubmit = async () => {
    try {
      await mutation.mutateAsync({
        lead_ids: leadIds,
        add_tag_ids: addTags,
        remove_tag_ids: [],
      });
      toast.success(`Tags adicionadas a ${leadIds.length} leads`);
      onOpenChange(false);
      setAddTags([]);
      onSuccess();
    } catch {
      toast.error("Erro ao aplicar tags");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tags para {leadIds.length} leads</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag: any) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  addTags.includes(tag.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
              >
                {addTags.includes(tag.id) && <CheckCircle2 className="h-3 w-3" />}
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={!addTags.length || mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Aplicar {addTags.length} tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkDeleteDialog({
  open,
  onOpenChange,
  leadIds,
  count,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadIds: string[];
  count: number;
  onSuccess: () => void;
}) {
  const mutation = useBulkDelete();

  const handleDelete = async () => {
    try {
      await mutation.mutateAsync({ lead_ids: leadIds });
      toast.success(`${count} leads movidos para lixeira`);
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error("Erro ao excluir leads");
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {count} leads</AlertDialogTitle>
          <AlertDialogDescription>
            Os leads serao movidos para a lixeira e podem ser restaurados em ate 30 dias.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Excluir {count} leads
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
