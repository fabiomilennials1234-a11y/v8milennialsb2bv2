import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
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
import { toast } from "sonner";
import {
  useAcoesDoDia,
  useCreateAcaoDoDia,
  useCompleteAcaoDoDia,
  useUncompleteAcaoDoDia,
  useDeleteAcaoDoDia,
  type AcaoDoDia,
} from "@/hooks/useAcoesDoDia";
import { usePipePropostas } from "@/hooks/usePipePropostas";
import { useFollowUps } from "@/hooks/useFollowUps";

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

  const pendingAcoes = acoes?.filter((a) => !a.is_completed) || [];
  const completedAcoes = acoes?.filter((a) => a.is_completed) || [];

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

  const formatPhone = (phone: string) => {
    // Clean the phone number
    const cleaned = phone.replace(/\D/g, "");
    // Format as WhatsApp link
    return `https://wa.me/55${cleaned}`;
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
          "group flex flex-col gap-2 p-3 rounded-lg border transition-all",
          isCompleted
            ? "bg-muted/30 border-muted opacity-60"
            : "bg-card hover:border-primary/30"
        )}
      >
        {/* WhatsApp and contact info at the top */}
        {leadInfo?.phone && !isCompleted && (
          <div className="flex items-center gap-2 pb-2 border-b border-border/50">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Phone className="w-4 h-4 text-green-500 shrink-0" />
              <span className="text-sm font-medium truncate">{leadInfo.phone}</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => copyToClipboard(leadInfo.phone!)}
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-green-500 hover:text-green-600 hover:bg-green-500/10"
              onClick={() => window.open(formatPhone(leadInfo.phone!), "_blank")}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
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
                ? "bg-success border-success text-white"
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
                <Badge variant="secondary" className="text-xs gap-1">
                  <Package className="w-3 h-3" />
                  Proposta
                  {acao.proposta.sale_value && (
                    <span className="text-success font-medium">
                      {formatCurrency(acao.proposta.sale_value)}
                    </span>
                  )}
                </Badge>
              )}

              {acao.confirmacao && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Calendar className="w-3 h-3" />
                  Reunião
                </Badge>
              )}

              {acao.follow_up && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <MessageSquare className="w-3 h-3" />
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
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Ações do Dia</h2>
          <Badge variant="secondary" className="text-xs">
            {pendingAcoes.length}
          </Badge>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="w-4 h-4" />
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
                                <span className="text-success text-xs">
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
                className="text-center py-8"
              >
                <Target className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma ação para hoje
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Adicione tarefas ou arraste follow-ups
                </p>
              </motion.div>
            ) : (
              <>
                {pendingAcoes.map(renderAcaoCard)}

                {completedAcoes.length > 0 && (
                  <>
                    <div className="flex items-center justify-between pt-3 mt-3 border-t">
                      <button
                        onClick={() => setShowCompleted(!showCompleted)}
                        className="flex items-center gap-2 hover:text-foreground transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4 text-success" />
                        <span className="text-xs text-muted-foreground font-medium">
                          Concluídas ({completedAcoes.length})
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {showCompleted ? "▼" : "▶"}
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
        </div>
      )}
    </div>
  );
}
