import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Plus,
  CheckCircle2,
  Trash2,
  Target,
  Building2,
  DollarSign,
  GripVertical,
  Undo2,
  Package,
  Calendar,
  MessageSquare,
  Phone,
  Copy,
  Mail,
  ExternalLink,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  Clock,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { toast } from "sonner";
import {
  useAcoesDoDia,
  useCreateAcaoDoDia,
  useCompleteAcaoDoDia,
  useUncompleteAcaoDoDia,
  useDeleteAcaoDoDia,
  type AcaoDoDia,
} from "@/modules/engagement/hooks/useAcoesDoDia";
import { usePipePropostas } from "@/modules/pipelines";
import { useFollowUps } from "@/modules/engagement/hooks/useFollowUps";
import {
  useDailyPriorities,
  type PriorityLead,
  type PriorityFollowUp,
} from "@/modules/engagement/hooks/useDailyPriorities";

export function AcoesDoDia() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [linkType, setLinkType] = useState<string>("none");
  const [selectedPropostaId, setSelectedPropostaId] = useState<string>("");
  const [selectedFollowUpId, setSelectedFollowUpId] = useState<string>("");

  const { data: acoes, isLoading } = useAcoesDoDia();
  const { data: propostas } = usePipePropostas();
  const { data: followUps } = useFollowUps({ dateFilter: "all" });
  const createAcao = useCreateAcaoDoDia();
  const completeAcao = useCompleteAcaoDoDia();
  const uncompleteAcao = useUncompleteAcaoDoDia();
  const deleteAcao = useDeleteAcaoDoDia();

  // Sugestões automáticas
  const { data: priorities, isLoading: isPrioritiesLoading } = useDailyPriorities();
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [addingLeadId, setAddingLeadId] = useState<string | null>(null);

  const pendingAcoes = acoes?.filter((a) => !a.is_completed) || [];
  const completedAcoes = acoes?.filter((a) => a.is_completed) || [];

  // Lead IDs que já estão nas ações do dia (para filtrar sugestões)
  const existingLeadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const acao of acoes || []) {
      if (acao.lead_id) ids.add(acao.lead_id);
      if (acao.proposta?.lead) {
        // proposta.lead doesn't have id in the type, but lead_id on acao covers it
      }
      if (acao.follow_up?.lead) {
        // follow_up.lead doesn't have id in the type
      }
    }
    return ids;
  }, [acoes]);

  // Follow-up IDs que já estão nas ações do dia
  const existingFollowUpIds = useMemo(() => {
    const ids = new Set<string>();
    for (const acao of acoes || []) {
      if (acao.follow_up_id) ids.add(acao.follow_up_id);
    }
    return ids;
  }, [acoes]);

  // Filtrar sugestões que ainda não foram adicionadas
  const filteredLeadsSemAcao = useMemo(
    () => (priorities?.leads_sem_acao || []).filter((l) => !existingLeadIds.has(l.id)),
    [priorities?.leads_sem_acao, existingLeadIds],
  );
  const filteredFollowUpsVencidos = useMemo(
    () => (priorities?.followups_vencidos || []).filter((f) => !existingFollowUpIds.has(f.id)),
    [priorities?.followups_vencidos, existingFollowUpIds],
  );
  // "Lead quente" (score >= 70) saiu das sugestões — o score do lead não é mais
  // usado (CTO, 02/10). A edge ainda devolve `leads_quentes`; aqui não se lê.
  const totalSuggestions = filteredLeadsSemAcao.length + filteredFollowUpsVencidos.length;

  const handleAddSuggestion = async (leadId: string, title: string, followUpId?: string) => {
    setAddingLeadId(leadId);
    try {
      await createAcao.mutateAsync({
        title,
        lead_id: leadId,
        follow_up_id: followUpId,
      });
    } finally {
      setAddingLeadId(null);
    }
  };

  const handleClearCompleted = async () => {
    if (completedAcoes.length === 0) return;
    
    for (const acao of completedAcoes) {
      await deleteAcao.mutateAsync(acao.id);
    }
    toast.success(`${completedAcoes.length} tarefa(s) removida(s)`);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const handleCreate = async () => {
    if (!title.trim()) return;

    await createAcao.mutateAsync({
      title: title.trim(),
      description: description.trim() || undefined,
      proposta_id: linkType === "proposta" ? selectedPropostaId || undefined : undefined,
      follow_up_id: linkType === "followup" ? selectedFollowUpId || undefined : undefined,
    });

    setTitle("");
    setDescription("");
    setLinkType("none");
    setSelectedPropostaId("");
    setSelectedFollowUpId("");
    setIsCreateOpen(false);
  };

  // Get lead info from any linked item
  const getLeadInfo = (acao: AcaoDoDia) => {
    if (acao.lead) return acao.lead;
    if (acao.proposta?.lead) return acao.proposta.lead;
    if (acao.confirmacao?.lead) return acao.confirmacao.lead;
    if (acao.follow_up?.lead) return acao.follow_up.lead;
    return null;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado para a área de transferência!");
  };

  const renderAcaoCard = (acao: AcaoDoDia) => {
    const isCompleted = acao.is_completed;
    const leadInfo = getLeadInfo(acao);

    return (
      <motion.div
        key={acao.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -100 }}
        className={cn(
          "group flex flex-col gap-2 rounded-2xl border p-3 transition-colors",
          isCompleted
            ? "border-transparent bg-muted/40 opacity-60"
            : "border-border/60 bg-card hover:border-foreground/15"
        )}
      >
        {/* WhatsApp and contact info at the top */}
        {leadInfo?.phone && !isCompleted && (
          <div className="flex items-center gap-2 pb-2 border-b border-border/50">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Phone className="h-4 w-4 shrink-0 text-success" />
              <span className="text-sm font-medium truncate">{leadInfo.phone}</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={() => copyToClipboard(leadInfo.phone!)}
              aria-label="Copiar telefone"
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
            {/* `acao.lead_id` e não `leadInfo.id`: o lead vem de quatro origens
                (acao, proposta, confirmacao, follow_up) e o tipo de algumas não
                carrega `id` — só `acao.lead_id` está sempre lá. */}
            {acao.lead_id && (
              <AbrirConversaButton
                leadId={acao.lead_id}
                phone={leadInfo.phone}
                size="icon"
                variant="ghost"
                className="h-7 w-7 rounded-lg text-success hover:bg-success/10 hover:text-success"
                title="Abrir conversa"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </AbrirConversaButton>
            )}
          </div>
        )}

        <div className="flex items-start gap-3">
          <div className="cursor-grab text-muted-foreground/50 hover:text-muted-foreground">
            <GripVertical className="w-4 h-4" />
          </div>

          <button
            onClick={() =>
              isCompleted
                ? uncompleteAcao.mutate(acao.id)
                : completeAcao.mutate(acao.id)
            }
            className={cn(
              "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
              isCompleted
                ? "border-success bg-success text-success-foreground"
                : "border-muted-foreground/30 hover:border-success"
            )}
          >
            {isCompleted && <CheckCircle2 className="w-3 h-3" />}
          </button>

          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm font-medium",
                isCompleted && "line-through text-muted-foreground"
              )}
            >
              {acao.title}
            </p>

            {acao.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {acao.description}
              </p>
            )}

            {/* Lead info */}
            {leadInfo && (
              <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                {leadInfo.name && (
                  <span className="font-medium text-foreground">{leadInfo.name}</span>
                )}
                {leadInfo.company && (
                  <span className="flex items-center gap-1">
                    <Building2 className="w-3 h-3" />
                    {leadInfo.company}
                  </span>
                )}
                {leadInfo.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    <span className="truncate max-w-[120px]">{leadInfo.email}</span>
                  </span>
                )}
              </div>
            )}

            {/* Linked item badges */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {acao.proposta && (
                <Badge variant="soft" className="gap-1 text-xs">
                  <Package className="h-3 w-3" />
                  Proposta
                  {acao.proposta.sale_value && (
                    <span className="font-semibold tabular-nums text-success">
                      {formatCurrency(acao.proposta.sale_value)}
                    </span>
                  )}
                </Badge>
              )}

              {acao.confirmacao && (
                <Badge variant="soft" className="gap-1 text-xs">
                  <Calendar className="h-3 w-3" />
                  Reunião
                </Badge>
              )}

              {acao.follow_up && (
                <Badge variant="soft" className="gap-1 text-xs">
                  <MessageSquare className="h-3 w-3" />
                  {acao.follow_up.title}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isCompleted && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => uncompleteAcao.mutate(acao.id)}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => deleteAcao.mutate(acao.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="rounded-card border border-card-border bg-card p-5 text-card-foreground shadow-relevo">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-soft-foreground">
            <Target className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <h2 className="text-[15px] font-bold tracking-[-0.02em]">Ações do Dia</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
            {pendingAcoes.length}
          </span>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus />
              Nova Ação
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Ação do Dia</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input
                  placeholder="O que você precisa fazer?"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  placeholder="Detalhes adicionais..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Vincular a</Label>
                <Select value={linkType} onValueChange={setLinkType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    <SelectItem value="proposta">Proposta</SelectItem>
                    <SelectItem value="followup">Follow-up</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {linkType === "proposta" && (
                <div className="space-y-2">
                  <Label>Proposta</Label>
                  <Select
                    value={selectedPropostaId}
                    onValueChange={setSelectedPropostaId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma proposta..." />
                    </SelectTrigger>
                    <SelectContent>
                      {propostas
                        ?.filter(
                          (p) =>
                            p.status !== "vendido" && p.status !== "perdido"
                        )
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <div className="flex items-center gap-2">
                              <span>{p.lead?.name}</span>
                              {p.sale_value && (
                                <span className="text-xs tabular-nums text-success">
                                  {formatCurrency(p.sale_value)}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {linkType === "followup" && (
                <div className="space-y-2">
                  <Label>Follow-up</Label>
                  <Select
                    value={selectedFollowUpId}
                    onValueChange={setSelectedFollowUpId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um follow-up..." />
                    </SelectTrigger>
                    <SelectContent>
                      {followUps
                        ?.filter((f) => !f.completed_at)
                        .map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.title} - {f.lead?.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleCreate}
                disabled={!title.trim() || createAcao.isPending}
              >
                {createAcao.isPending ? "Criando..." : "Criar Ação"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {pendingAcoes.length === 0 && completedAcoes.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-1 py-8 text-center"
              >
                <span className="mb-1.5 grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <Target className="h-5 w-5" />
                </span>
                <p className="text-sm font-semibold">
                  Nenhuma ação para hoje
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Adicione tarefas ou arraste follow-ups
                </p>
              </motion.div>
            ) : (
              <>
                {pendingAcoes.map(renderAcaoCard)}

                {completedAcoes.length > 0 && (
                  <>
                    <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
                      <button
                        type="button"
                        onClick={() => setShowCompleted(!showCompleted)}
                        aria-expanded={showCompleted}
                        className="flex items-center gap-2 transition-colors hover:text-foreground"
                      >
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                          Concluídas <span className="tabular-nums">({completedAcoes.length})</span>
                        </span>
                        <span className="text-muted-foreground">
                          {showCompleted ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                      {showCompleted && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs text-muted-foreground hover:text-destructive"
                          onClick={handleClearCompleted}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Limpar
                        </Button>
                      )}
                    </div>
                    <AnimatePresence>
                      {showCompleted && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="space-y-2 overflow-hidden"
                        >
                          {completedAcoes.map(renderAcaoCard)}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </>
            )}
          </AnimatePresence>

          {/* Sugestões para hoje */}
          {(totalSuggestions > 0 || isPrioritiesLoading) && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <button
                type="button"
                onClick={() => setSuggestionsOpen(!suggestionsOpen)}
                aria-expanded={suggestionsOpen}
                className="flex w-full items-center gap-2 transition-colors hover:text-foreground"
              >
                <Lightbulb className="h-4 w-4 text-warning-strong" />
                <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                  Sugestões para hoje
                </span>
                {totalSuggestions > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                    {totalSuggestions}
                  </span>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {suggestionsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </span>
              </button>

              <AnimatePresence>
                {suggestionsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-1.5 overflow-hidden mt-2"
                  >
                    {isPrioritiesLoading && totalSuggestions === 0 && (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      </div>
                    )}

                    {/* Leads sem ação */}
                    {filteredLeadsSemAcao.map((lead) => (
                      <SuggestionRow
                        key={`sem-acao-${lead.id}`}
                        icon={<Clock className="h-3.5 w-3.5 text-warning-strong" />}
                        leadName={lead.name}
                        reason={
                          lead.last_action_at
                            ? `${formatDistanceToNow(new Date(lead.last_action_at), { locale: ptBR })} sem contato`
                            : "Sem contato registrado"
                        }
                        company={lead.company}
                        isAdding={addingLeadId === lead.id}
                        onAdd={() => handleAddSuggestion(lead.id, `Contatar ${lead.name}`)}
                      />
                    ))}

                    {/* Follow-ups vencidos */}
                    {filteredFollowUpsVencidos.map((fu) => (
                      <SuggestionRow
                        key={`fu-${fu.id}`}
                        icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
                        leadName={fu.lead?.name || "Lead"}
                        reason={
                          fu.days_overdue > 0
                            ? `Follow-up vencido há ${fu.days_overdue} dia${fu.days_overdue !== 1 ? "s" : ""}`
                            : "Follow-up vence hoje"
                        }
                        subtitle={fu.title}
                        isAdding={fu.lead?.id ? addingLeadId === fu.lead.id : false}
                        onAdd={() => {
                          if (!fu.lead?.id) return;
                          handleAddSuggestion(
                            fu.lead.id,
                            `Follow-up: ${fu.title} — ${fu.lead.name || "Lead"}`,
                            fu.id,
                          );
                        }}
                      />
                    ))}

                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Suggestion Row ────────────────────────────────────

function SuggestionRow({
  icon,
  leadName,
  reason,
  company,
  subtitle,
  isAdding,
  onAdd,
}: {
  icon: React.ReactNode;
  leadName: string;
  reason: string;
  company?: string | null;
  subtitle?: string;
  isAdding: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-sunken p-2 transition-colors hover:bg-muted/60">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{leadName}</span>
          {company && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              · {company}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        )}
        <span className="text-xs text-muted-foreground">{reason}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 text-xs"
        onClick={onAdd}
        disabled={isAdding}
      >
        {isAdding ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Plus className="w-3 h-3" />
        )}
        Adicionar
      </Button>
    </div>
  );
}
