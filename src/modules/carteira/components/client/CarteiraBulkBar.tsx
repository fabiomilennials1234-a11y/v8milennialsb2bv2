import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus,
  Tag,
  Bot,
  MessageCircle,
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
import { useTeamMembers } from "@/modules/identity";
import { useTags } from "@/modules/leads/hooks/useTags";
import { useBulkTag } from "@/modules/leads/hooks/useBulkActions";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { DisparoWizard } from "@/modules/pipelines";
import type { PortfolioClientRow } from "@/modules/carteira/hooks/usePortfolioClients";

const BAR_BTN =
  "h-8 shrink-0 gap-1.5 rounded-full px-3 text-[13px] text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground [&_svg]:size-3.5";

interface CarteiraBulkBarProps {
  selectedClients: PortfolioClientRow[];
  onClear: () => void;
}

export function CarteiraBulkBar({ selectedClients, onClear }: CarteiraBulkBarProps) {
  const count = selectedClients.length;
  const [assignOpen, setAssignOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [disparoOpen, setDisparoOpen] = useState(false);

  // Selected clients → their lead_ids. Only clients with a linked lead can be
  // blasted (the engine keys on lead_id); clients without one are silently
  // dropped, matching the legacy dialog's "sem lead vinculado" handling.
  const manualLeadIds = selectedClients
    .map((c) => c.lead_id)
    .filter((id): id is string => !!id);

  if (count === 0) return null;

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          // V5: a barra de massa é tinta flutuante, como a lateral e a barra
          // inferior — é ferramenta, não conteúdo.
          className="fixed bottom-6 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-full border border-tinta-line/60 bg-tinta py-1.5 pl-2 pr-1.5 text-tinta-foreground shadow-relevo-tinta scrollbar-hide"
        >
          <span className="inline-flex h-7 min-w-[28px] shrink-0 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold tabular-nums text-primary-foreground">
            {count}
          </span>
          <span className="mr-1 shrink-0 text-sm text-tinta-muted">selecionados</span>

          <Button
            size="sm"
            variant="ghost"
            className={BAR_BTN}
            onClick={() => setAssignOpen(true)}
          >
            <UserPlus />
            Reatribuir
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={BAR_BTN}
            onClick={() => setTagOpen(true)}
          >
            <Tag />
            Tags
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={BAR_BTN}
            onClick={() => setDisparoOpen(true)}
          >
            <MessageCircle />
            Mensagem
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={BAR_BTN}
            onClick={() => setCopilotOpen(true)}
          >
            <Bot />
            Acionar Copilot
          </Button>

          <Button
            size="icon"
            variant="ghost"
            aria-label="Limpar seleção"
            className="ml-0.5 h-8 w-8 shrink-0 rounded-full text-tinta-muted hover:bg-white/10 hover:text-tinta-foreground"
            onClick={onClear}
          >
            <X />
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

      {/* Unified Quick Blast wizard, carteira context, seeded with the selected
          clients' lead_ids (Manual source). Replaces the legacy BulkMessageDialog
          / carteira-bulk-message path — that component is kept below as a fallback
          but is no longer routed to. Carteira template vars ({segmento},
          {ticket_medio}, …) keep working: the engine injects carteira fields
          server-side per recipient. Mounted only while open. */}
      {disparoOpen && (
        <DisparoWizard
          open={disparoOpen}
          onOpenChange={(next) => {
            setDisparoOpen(next);
            if (!next) onClear();
          }}
          context={{ kind: "carteira" }}
          initialSource="manual"
          initialManualLeadIds={manualLeadIds}
        />
      )}
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reatribuir {count} clientes</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Vendedor responsável</label>
          <Select value={closerId} onValueChange={setCloserId}>
            <SelectTrigger>
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tags para {count} clientes</DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {leadIds.length < count && (
            <p className="mb-3 text-xs font-medium text-warning-strong">
              {count - leadIds.length} cliente(s) sem lead vinculado serão ignorados.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {tags.map((tag: any) => (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                aria-pressed={addTags.includes(tag.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  addTags.includes(tag.id)
                    ? "border-transparent bg-primary-soft text-primary-soft-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground"
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Acionar Copilot</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Dispara o workflow <span className="cmd-mono rounded-md bg-muted px-1.5 py-0.5 text-[12px] text-foreground">recompra_atrasada</span> para{" "}
            <span className="font-bold text-foreground">{withLead}</span> clientes com lead vinculado.
          </p>
          <p className="text-xs text-muted-foreground">
            Configure um workflow com trigger "recompra_atrasada" para definir a ação automática
            (ex: mensagem WhatsApp via Copilot, follow-up, etc).
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleFire}
            disabled={firing || !withLead}
          >
            {firing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Acionar {withLead} clientes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
