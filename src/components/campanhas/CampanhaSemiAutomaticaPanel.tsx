import { useState } from "react";
import {
  useCampanhaTemplates,
  useDispatchBatches,
  useDispatchStats,
  useCreateDispatchBatch,
  useCancelDispatchBatch,
  replaceVariablesWithExamples,
} from "@/hooks/useCampaignTemplates";
import { useCampanhaLeads, useCampanhaStages } from "@/hooks/useCampanhas";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FileText, Send, Clock, Check, X, AlertCircle,
  Calendar, Users, Filter, Play, Ban, Eye, Zap
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { Campanha } from "@/hooks/useCampanhas";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface CampanhaSemiAutomaticaPanelProps {
  campanha: Campanha;
}

export function CampanhaSemiAutomaticaPanel({ campanha }: CampanhaSemiAutomaticaPanelProps) {
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [isImmediate, setIsImmediate] = useState(true);

  // Lead filters
  const [filterByStage, setFilterByStage] = useState(false);
  const [selectedStageIds, setSelectedStageIds] = useState<string[]>([]);
  const [excludeContacted, setExcludeContacted] = useState(true);
  const [hasPhoneOnly, setHasPhoneOnly] = useState(true);

  const { data: templates = [] } = useCampanhaTemplates(campanha.id);
  const { data: batches = [], refetch: refetchBatches } = useDispatchBatches(campanha.id);
  const { data: stats } = useDispatchStats(campanha.id);
  const { data: leads = [] } = useCampanhaLeads(campanha.id);
  const { data: stages = [] } = useCampanhaStages(campanha.id);

  const createBatch = useCreateDispatchBatch();
  const cancelBatch = useCancelDispatchBatch();

  // Calculate filtered leads count
  const filteredLeadsCount = leads.filter((lead: any) => {
    if (hasPhoneOnly && !lead.lead?.phone) return false;
    if (filterByStage && selectedStageIds.length > 0 && !selectedStageIds.includes(lead.stage_id)) return false;
    // TODO: Add excludeContacted filter when we have dispatch history per lead
    return true;
  }).length;

  const handleOpenSendDialog = () => {
    if (templates.length === 0) {
      toast.error("Nenhum template vinculado a esta campanha");
      return;
    }
    setSelectedTemplateId(templates[0]?.template_id || null);
    setIsImmediate(true);
    setScheduleDate(format(new Date(), "yyyy-MM-dd"));
    setScheduleTime("09:00");
    setSendDialogOpen(true);
  };

  const handleSend = async () => {
    if (!selectedTemplateId) {
      toast.error("Selecione um template");
      return;
    }

    const scheduledAt = isImmediate
      ? new Date().toISOString()
      : new Date(`${scheduleDate}T${scheduleTime}`).toISOString();

    try {
      await createBatch.mutateAsync({
        campanha_id: campanha.id,
        template_id: selectedTemplateId,
        scheduled_at: scheduledAt,
        lead_filter: {
          stage_ids: filterByStage ? selectedStageIds : undefined,
          has_phone: hasPhoneOnly,
          exclude_contacted: excludeContacted,
        },
        total_leads: filteredLeadsCount,
      });

      toast.success(
        isImmediate
          ? "Disparo iniciado! As mensagens serão enviadas em breve."
          : `Disparo agendado para ${format(new Date(scheduledAt), "dd/MM 'às' HH:mm", { locale: ptBR })}`
      );
      setSendDialogOpen(false);
      refetchBatches();
    } catch (error) {
      console.error("Error creating batch:", error);
      toast.error("Erro ao criar disparo");
    }
  };

  const handleCancelBatch = async (batchId: string) => {
    try {
      await cancelBatch.mutateAsync({ id: batchId, campanha_id: campanha.id });
      toast.success("Disparo cancelado");
      refetchBatches();
    } catch (error) {
      console.error("Error cancelling batch:", error);
      toast.error("Erro ao cancelar disparo");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "scheduled":
        return <Badge variant="outline" className="text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-600">Agendado</Badge>;
      case "processing":
        return <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-600">Processando</Badge>;
      case "completed":
        return <Badge variant="outline" className="text-green-600 dark:text-green-400 border-green-300 dark:border-green-600">Concluído</Badge>;
      case "failed":
        return <Badge variant="destructive">Falhou</Badge>;
      case "cancelled":
        return <Badge variant="secondary">Cancelado</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const selectedTemplateData = templates.find((t: any) => t.template_id === selectedTemplateId)?.template;

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Disparos de Template</h3>
          <p className="text-sm text-muted-foreground">
            Envie mensagens em lote usando templates personalizados
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleOpenSendDialog}>
            <Calendar className="w-4 h-4 mr-2" />
            Agendar
          </Button>
          <Button onClick={handleOpenSendDialog}>
            <Send className="w-4 h-4 mr-2" />
            Enviar Agora
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{templates.length}</p>
                <p className="text-xs text-muted-foreground">Templates</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.pending || 0}</p>
                <p className="text-xs text-muted-foreground">Pendentes</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.sent || 0}</p>
                <p className="text-xs text-muted-foreground">Enviados</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                <X className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.failed || 0}</p>
                <p className="text-xs text-muted-foreground">Falharam</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Templates List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Templates da Campanha</CardTitle>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Nenhum template vinculado</p>
              <p className="text-sm">Adicione templates na criação da campanha</p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((t: any) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-primary" />
                    <div>
                      <p className="font-medium text-sm">{t.template?.name}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[300px]">
                        {t.template?.content?.substring(0, 60)}...
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewTemplate(previewTemplate === t.id ? null : t.id)}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scheduled Batches */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Disparos Agendados</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Nenhum disparo agendado</p>
              <p className="text-sm">Agende um novo disparo usando os botões acima</p>
            </div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {batches.map((batch: any) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between p-4 rounded-lg border"
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center",
                        batch.status === "scheduled" ? "bg-blue-100 dark:bg-blue-900/40" :
                        batch.status === "processing" ? "bg-amber-100 dark:bg-amber-900/40" :
                        batch.status === "completed" ? "bg-green-100 dark:bg-green-900/40" : "bg-gray-100 dark:bg-muted"
                      )}>
                        <Zap className={cn(
                          "w-5 h-5",
                          batch.status === "scheduled" ? "text-blue-600 dark:text-blue-400" :
                          batch.status === "processing" ? "text-amber-600 dark:text-amber-400" :
                          batch.status === "completed" ? "text-green-600 dark:text-green-400" : "text-gray-400 dark:text-muted-foreground"
                        )} />
                      </div>
                      <div>
                        <p className="font-medium text-sm flex items-center gap-2">
                          {batch.template?.name || "Template"}
                          {getStatusBadge(batch.status)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {batch.status === "scheduled"
                            ? `Agendado para ${format(new Date(batch.scheduled_at), "dd/MM 'às' HH:mm", { locale: ptBR })}`
                            : batch.status === "completed"
                              ? `Concluído ${formatDistanceToNow(new Date(batch.completed_at), { addSuffix: true, locale: ptBR })}`
                              : `Criado ${formatDistanceToNow(new Date(batch.created_at), { addSuffix: true, locale: ptBR })}`
                          }
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {batch.sent_count}/{batch.total_leads}
                        </p>
                        <p className="text-xs text-muted-foreground">enviados</p>
                      </div>

                      {batch.status === "scheduled" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelBatch(batch.id)}
                        >
                          <Ban className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Send Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" />
              Disparar Mensagens
            </DialogTitle>
            <DialogDescription>
              Configure o disparo de mensagens para os leads desta campanha
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Template Selection */}
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={selectedTemplateId || ""} onValueChange={setSelectedTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t: any) => (
                    <SelectItem key={t.template_id} value={t.template_id}>
                      {t.template?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedTemplateData && (
                <div className="mt-2 p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap">
                  {replaceVariablesWithExamples(selectedTemplateData.content)}
                </div>
              )}
            </div>

            {/* Scheduling */}
            <div className="space-y-3">
              <Label>Quando enviar?</Label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={isImmediate}
                    onChange={() => setIsImmediate(true)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Enviar agora</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!isImmediate}
                    onChange={() => setIsImmediate(false)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Agendar</span>
                </label>
              </div>

              {!isImmediate && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Label className="text-xs">Data</Label>
                    <Input
                      type="date"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Hora</Label>
                    <Input
                      type="time"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Filters */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filtros de Leads
              </Label>

              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={hasPhoneOnly}
                    onCheckedChange={(c) => setHasPhoneOnly(!!c)}
                  />
                  <span className="text-sm">Apenas leads com telefone</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={excludeContacted}
                    onCheckedChange={(c) => setExcludeContacted(!!c)}
                  />
                  <span className="text-sm">Excluir já contatados nesta campanha</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={filterByStage}
                    onCheckedChange={(c) => setFilterByStage(!!c)}
                  />
                  <span className="text-sm">Filtrar por etapa</span>
                </label>

                {filterByStage && (
                  <div className="ml-6 space-y-2">
                    {stages.map((stage: any) => (
                      <label key={stage.id} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={selectedStageIds.includes(stage.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedStageIds([...selectedStageIds, stage.id]);
                            } else {
                              setSelectedStageIds(selectedStageIds.filter((id) => id !== stage.id));
                            }
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: stage.color }}
                          />
                          <span className="text-sm">{stage.name}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Leads count */}
              <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg text-blue-700 dark:text-blue-300">
                <Users className="w-4 h-4" />
                <span className="text-sm">
                  <strong>{filteredLeadsCount}</strong> lead(s) serão impactados
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSend} disabled={createBatch.isPending || !selectedTemplateId}>
              {createBatch.isPending ? "Criando..." : isImmediate ? "Enviar Agora" : "Agendar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
