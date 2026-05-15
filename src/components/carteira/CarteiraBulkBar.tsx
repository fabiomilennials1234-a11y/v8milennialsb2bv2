import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus,
  Tag,
  Bot,
  X,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useTags } from "@/hooks/useTags";
import { useBulkTag } from "@/hooks/useBulkActions";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import type { PortfolioClientRow } from "@/hooks/usePortfolioClients";

interface CarteiraBulkBarProps {
  selectedClients: PortfolioClientRow[];
  onClear: () => void;
}

export function CarteiraBulkBar({ selectedClients, onClear }: CarteiraBulkBarProps) {
  const count = selectedClients.length;
  const [assignOpen, setAssignOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-[#3f3f46] bg-[#18181b] px-4 py-2.5 shadow-2xl"
        >
          <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-md bg-[#eab308] text-black text-xs font-bold tabular-nums">
            {count}
          </span>
          <span className="text-sm text-[#a1a1aa] mr-1">selecionados</span>

          <Button
            size="sm"
            variant="outline"
            className="border-[#3f3f46] bg-transparent text-[#fafafa] hover:bg-[#27272a]"
            onClick={() => setAssignOpen(true)}
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            Reatribuir
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-[#3f3f46] bg-transparent text-[#fafafa] hover:bg-[#27272a]"
            onClick={() => setTagOpen(true)}
          >
            <Tag className="mr-1.5 h-3.5 w-3.5" />
            Tags
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-[#3f3f46] bg-transparent text-[#fafafa] hover:bg-[#27272a]"
            onClick={() => setCopilotOpen(true)}
          >
            <Bot className="mr-1.5 h-3.5 w-3.5" />
            Acionar Copilot
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 ml-1 text-[#71717a] hover:text-[#fafafa]"
            onClick={onClear}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </motion.div>
      </AnimatePresence>

      <ReassignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        clientIds={selectedClients.map((c) => c.id)}
        count={count}
        onSuccess={onClear}
      />
      <TagDialog
        open={tagOpen}
        onOpenChange={setTagOpen}
        leadIds={selectedClients.filter((c) => c.lead_id).map((c) => c.lead_id!)}
        count={count}
        onSuccess={onClear}
      />
      <CopilotDialog
        open={copilotOpen}
        onOpenChange={setCopilotOpen}
        clients={selectedClients.filter((c) => c.lead_id)}
        onSuccess={onClear}
      />
    </>
  );
}

function ReassignDialog({
  open,
  onOpenChange,
  clientIds,
  count,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientIds: string[];
  count: number;
  onSuccess: () => void;
}) {
  const [closerId, setCloserId] = useState("none");
  const { data: members = [] } = useTeamMembers();
  const qc = useQueryClient();
  const active = members.filter((m: any) => m.is_active);

  const mutation = useMutation({
    mutationFn: async (params: { client_ids: string[]; closer_id: string | null }) => {
      const { error } = await supabase
        .from("upsell_clients")
        .update({ closer_id: params.closer_id } as any)
        .in("id", params.client_ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-clients"] });
    },
  });

  const handleSubmit = async () => {
    try {
      await mutation.mutateAsync({
        client_ids: clientIds,
        closer_id: closerId === "none" ? null : closerId,
      });
      toast.success(`${count} clientes reatribuídos`);
      onOpenChange(false);
      setCloserId("none");
      onSuccess();
    } catch {
      toast.error("Erro ao reatribuir clientes");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#18181b] border-[#27272a]">
        <DialogHeader>
          <DialogTitle>Reatribuir {count} clientes</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <label className="text-sm font-medium text-[#a1a1aa]">Vendedor responsável</label>
          <Select value={closerId} onValueChange={setCloserId}>
            <SelectTrigger className="bg-[#111113] border-[#27272a]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Remover responsável</SelectItem>
              {active.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="bg-[hsl(47_100%_50%)] hover:bg-[hsl(47_100%_45%)] text-black font-semibold"
          >
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Reatribuir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TagDialog({
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
  const [addTags, setAddTags] = useState<string[]>([]);
  const { data: tags = [] } = useTags();
  const mutation = useBulkTag();

  const toggleTag = (id: string) => {
    setAddTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const handleSubmit = async () => {
    if (!leadIds.length) {
      toast.error("Nenhum cliente selecionado tem lead vinculado");
      return;
    }
    try {
      await mutation.mutateAsync({
        lead_ids: leadIds,
        add_tag_ids: addTags,
        remove_tag_ids: [],
      });
      toast.success(`Tags adicionadas a ${leadIds.length} clientes`);
      onOpenChange(false);
      setAddTags([]);
      onSuccess();
    } catch {
      toast.error("Erro ao aplicar tags");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#18181b] border-[#27272a]">
        <DialogHeader>
          <DialogTitle>Tags para {count} clientes</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {leadIds.length < count && (
            <p className="text-xs text-[#f59e0b] mb-3">
              {count - leadIds.length} cliente(s) sem lead vinculado serão ignorados.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {tags.map((tag: any) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  addTags.includes(tag.id)
                    ? "border-[#eab308] bg-[#eab308]/10 text-[#eab308]"
                    : "border-[#3f3f46] text-[#a1a1aa] hover:border-[#eab308]/50"
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
          <Button
            onClick={handleSubmit}
            disabled={!addTags.length || mutation.isPending}
            className="bg-[hsl(47_100%_50%)] hover:bg-[hsl(47_100%_45%)] text-black font-semibold"
          >
            {mutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Aplicar {addTags.length} tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopilotDialog({
  open,
  onOpenChange,
  clients,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clients: PortfolioClientRow[];
  onSuccess: () => void;
}) {
  const { organizationId } = useOrganization();
  const [firing, setFiring] = useState(false);

  const handleFire = async () => {
    if (!organizationId || !clients.length) return;
    setFiring(true);
    try {
      const results = await Promise.allSettled(
        clients.map((c) =>
          supabase.functions.invoke("process-workflow-executions", {
            body: {
              mode: "fire_trigger",
              organization_id: organizationId,
              trigger_type: "recompra_atrasada",
              lead_id: c.lead_id,
              context: {
                trigger: "recompra_atrasada",
                client_id: c.id,
                client_name: c.name,
                days_overdue: c.days_since_last_order,
                health_score: c.health_score,
                segment: c.segment,
              },
            },
          }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      toast.success(`Copilot acionado para ${ok} de ${clients.length} clientes`);
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error("Erro ao acionar Copilot");
    } finally {
      setFiring(false);
    }
  };

  const withLead = clients.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#18181b] border-[#27272a]">
        <DialogHeader>
          <DialogTitle>Acionar Copilot</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <p className="text-sm text-[#a1a1aa]">
            Dispara o workflow <span className="font-mono text-[#eab308]">recompra_atrasada</span> para{" "}
            <span className="font-bold text-[#fafafa]">{withLead}</span> clientes com lead vinculado.
          </p>
          <p className="text-xs text-[#71717a]">
            Configure um workflow com trigger "recompra_atrasada" para definir a ação automática
            (ex: mensagem WhatsApp via Copilot, follow-up, etc).
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[#3f3f46]">
            Cancelar
          </Button>
          <Button
            onClick={handleFire}
            disabled={firing || !withLead}
            className="bg-[hsl(47_100%_50%)] hover:bg-[hsl(47_100%_45%)] text-black font-semibold"
          >
            {firing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Acionar {withLead} clientes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
