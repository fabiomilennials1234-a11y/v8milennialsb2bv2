import { useState, useEffect } from "react";
import {
  User,
  Phone,
  Tag,
  Plus,
  Loader2,
  Target,
  ArrowRight,
  Check,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useLeadByPhone,
  usePipeWhatsappByLeadId,
  useCreateLeadFromWhatsApp,
  useLinkLeadToWhatsApp,
  useUpdateLeadPipelineStatus,
  type LeadDestination,
} from "@/hooks/useWhatsAppLeadIntegration";
import { useUpdateLead } from "@/hooks/useLeads";
import { useLogLeadAction } from "@/hooks/useLogLeadAction";
import { useCampanhas, useCampanhaStages } from "@/hooks/useCampanhas";
import { useTeamMembers, useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const originOptions = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "google_ads", label: "Google Ads" },
  { value: "site", label: "Site" },
  { value: "remarketing", label: "Remarketing" },
  { value: "cal", label: "Calendário" },
  { value: "outro", label: "Outro" },
];

const destinationOptions = [
  { value: "qualificacao", label: "Pipe de Qualificação" },
  { value: "confirmacao", label: "Pipe de Confirmação" },
  { value: "propostas", label: "Pipe de Propostas" },
  { value: "campanha", label: "Campanha" },
  { value: "none", label: "Nenhum" },
];

const pipelineStages = [
  { id: "novo", title: "Novo", color: "#6366f1", icon: "🆕" },
  { id: "abordado", title: "Abordado", color: "#f59e0b", icon: "👋" },
  { id: "respondeu", title: "Respondeu", color: "#3b82f6", icon: "💬" },
  { id: "esfriou", title: "Esfriou", color: "#ef4444", icon: "❄️" },
  { id: "agendado", title: "Agendado", color: "#22c55e", icon: "✅" },
];

export interface LeadDetailContentProps {
  phoneNumber: string;
  pushName?: string | null;
  onClose?: () => void;
  /** Quando true, exibe cabeçalho com nome e telefone (ex.: no Sheet) */
  showHeader?: boolean;
}

export function LeadDetailContent({
  phoneNumber,
  pushName,
  onClose,
  showHeader = false,
}: LeadDetailContentProps) {
  const [activeTab, setActiveTab] = useState("info");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedCampanhaId, setSelectedCampanhaId] = useState<string | null>(null);
  const [isAddingToCampanha, setIsAddingToCampanha] = useState(false);

  // Campos de criação: destino e metadados
  const [createOrigin, setCreateOrigin] = useState("whatsapp");
  const [createSdrId, setCreateSdrId] = useState<string>("");
  const [createDestination, setCreateDestination] = useState<LeadDestination>("qualificacao");
  const [createCampanhaId, setCreateCampanhaId] = useState<string>("");

  const [formData, setFormData] = useState({
    name: "",
    company: "",
    email: "",
    rating: 0,
    notes: "",
  });

  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const { data: teamMembers = [] } = useTeamMembers();
  const { data: lead, isLoading: leadLoading, refetch: refetchLead } = useLeadByPhone(phoneNumber);
  const { data: pipeStatus, isLoading: pipeLoading } = usePipeWhatsappByLeadId(lead?.id || null);
  const { data: campanhas = [] } = useCampanhas();
  const { data: campanhaStages = [] } = useCampanhaStages(
    (createDestination === "campanha" ? createCampanhaId : selectedCampanhaId) || undefined
  );

  const createLead = useCreateLeadFromWhatsApp();
  const linkLeadToWhatsApp = useLinkLeadToWhatsApp();
  const updateLead = useUpdateLead();
  const updatePipeStatus = useUpdateLeadPipelineStatus();
  const logAction = useLogLeadAction();

  const activeCampanhas = campanhas.filter((c) => c.is_active);

  useEffect(() => {
    if (lead) {
      setFormData({
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        rating: lead.rating || 0,
        notes: lead.notes || "",
      });
      setIsCreating(false);
    } else if (!leadLoading) {
      setFormData({
        name: pushName || "",
        company: "",
        email: "",
        rating: 0,
        notes: "",
      });
      setIsCreating(true);
      // Default SDR to current user
      if (teamMember?.id && !createSdrId) {
        setCreateSdrId(teamMember.id);
      }
    }
  }, [lead, leadLoading, pushName, teamMember?.id]);

  const handleCreateLead = async () => {
    try {
      const result = await createLead.mutateAsync({
        phone: phoneNumber,
        pushName: formData.name || pushName,
        origin: createOrigin,
        sdrId: createSdrId || undefined,
        destination: createDestination,
        campanhaId: createDestination === "campanha" ? createCampanhaId : undefined,
      });

      if (result.isNew && (formData.company || formData.email || formData.notes)) {
        await updateLead.mutateAsync({
          id: result.leadId,
          company: formData.company || null,
          email: formData.email || null,
          notes: formData.notes || null,
          rating: formData.rating || null,
        });
      }

      logAction({ leadId: result.leadId, action: "lead_created", description: `Lead "${formData.name || pushName}" criado via WhatsApp` });
      toast.success("Lead criado com sucesso!");
      refetchLead();
      setIsCreating(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar lead");
    }
  };

  const handleUpdateLead = async () => {
    if (!lead) return;
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        name: formData.name,
        company: formData.company || null,
        email: formData.email || null,
        rating: formData.rating || null,
        notes: formData.notes || null,
      });
      logAction({ leadId: lead.id, action: "field_updated", description: "Dados do lead atualizados via chat" });
      toast.success("Lead atualizado!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar");
    }
  };

  const handleStageChange = async (newStatus: string) => {
    if (!pipeStatus || !lead) return;
    try {
      await updatePipeStatus.mutateAsync({
        pipeId: pipeStatus.id,
        leadId: lead.id,
        status: newStatus as any,
      });
      const stageName = pipelineStages.find((s) => s.id === newStatus)?.title;
      logAction({ leadId: lead.id, action: "stage_changed", description: `Movido para "${stageName}" no WhatsApp SDR` });
      toast.success(`Lead movido para ${stageName}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar status");
    }
  };

  // Pipeline linking is now handled during lead creation with destination choice

  const handleAddToCampanha = async () => {
    if (!lead || !selectedCampanhaId || !campanhaStages.length) return;

    setIsAddingToCampanha(true);
    try {
      const firstStage = campanhaStages.sort((a, b) => a.position - b.position)[0];

      const { data: existing } = await supabase
        .from("campanha_leads")
        .select("id")
        .eq("campanha_id", selectedCampanhaId)
        .eq("lead_id", lead.id)
        .maybeSingle();

      if (existing) {
        toast.info("Lead já está nesta campanha");
        setIsAddingToCampanha(false);
        return;
      }

      const { error } = await supabase.from("campanha_leads").insert({
        campanha_id: selectedCampanhaId,
        lead_id: lead.id,
        stage_id: firstStage.id,
        sdr_id: teamMember?.id || null,
      });

      if (error) throw error;

      toast.success("Lead adicionado à campanha!");
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      setSelectedCampanhaId(null);
    } catch (error: any) {
      toast.error(error.message || "Erro ao adicionar à campanha");
    } finally {
      setIsAddingToCampanha(false);
    }
  };

  const isLoading = leadLoading || pipeLoading;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showHeader && (
        <div className="pb-4 border-b border-border/60 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold truncate">{lead?.name || pushName || phoneNumber}</span>
                {lead && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    Lead
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3 shrink-0" />
                {phoneNumber}
              </p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !lead && isCreating ? (
        <div className="space-y-4 py-4 overflow-y-auto">
          <div className="text-center pb-4">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
              <Plus className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">Criar Novo Lead</h3>
            <p className="text-sm text-muted-foreground">
              Este contato ainda não está no CRM. Preencha os dados para criar um lead.
            </p>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nome do lead"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="company">Empresa</Label>
              <Input
                id="company"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                placeholder="Nome da empresa"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="email@exemplo.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Observações sobre o lead..."
                rows={3}
              />
            </div>

            <Separator />

            <div className="grid gap-2">
              <Label htmlFor="origin">Origem *</Label>
              <Select value={createOrigin} onValueChange={setCreateOrigin}>
                <SelectTrigger id="origin">
                  <SelectValue placeholder="Selecione a origem" />
                </SelectTrigger>
                <SelectContent>
                  {originOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="responsible">Responsável</Label>
              <Select value={createSdrId} onValueChange={setCreateSdrId}>
                <SelectTrigger id="responsible">
                  <SelectValue placeholder="Selecione o responsável" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers.map((member: any) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="destination">Destino</Label>
              <Select value={createDestination} onValueChange={(v) => setCreateDestination(v as LeadDestination)}>
                <SelectTrigger id="destination">
                  <SelectValue placeholder="Selecione o destino" />
                </SelectTrigger>
                <SelectContent>
                  {destinationOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {createDestination === "campanha" && (
              <div className="grid gap-2">
                <Label htmlFor="create-campanha">Campanha</Label>
                <Select value={createCampanhaId} onValueChange={setCreateCampanhaId}>
                  <SelectTrigger id="create-campanha">
                    <SelectValue placeholder="Selecione a campanha..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCampanhas.map((campanha) => (
                      <SelectItem key={campanha.id} value={campanha.id}>
                        <div className="flex items-center gap-2">
                          <Target className="w-4 h-4" />
                          {campanha.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            {onClose && (
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
            )}
            <Button
              className={onClose ? "flex-1" : "w-full"}
              onClick={handleCreateLead}
              disabled={createLead.isPending || !formData.name || (createDestination === "campanha" && !createCampanhaId)}
            >
              {createLead.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Criar Lead
            </Button>
          </div>
        </div>
      ) : lead ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="info">Informações</TabsTrigger>
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="campanha">Campanhas</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            <TabsContent value="info" className="mt-0 space-y-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Nome</Label>
                  <Input
                    id="edit-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-company">Empresa</Label>
                  <Input
                    id="edit-company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-rating">Rating (0-10)</Label>
                  <Input
                    id="edit-rating"
                    type="number"
                    min="0"
                    max="10"
                    value={formData.rating}
                    onChange={(e) => setFormData({ ...formData, rating: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-notes">Notas</Label>
                  <Textarea
                    id="edit-notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                  />
                </div>
              </div>

              {lead.lead_tags && lead.lead_tags.length > 0 && (
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-1">
                    {lead.lead_tags.map((lt: any) => (
                      <Badge
                        key={lt.tag.id}
                        variant="outline"
                        style={{
                          backgroundColor: `${lt.tag.color}20`,
                          borderColor: `${lt.tag.color}40`,
                          color: lt.tag.color,
                        }}
                      >
                        <Tag className="w-3 h-3 mr-1" />
                        {lt.tag.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => window.open(`/leads?id=${lead.id}`, "_blank")}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Ver Completo
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={handleUpdateLead}
                  disabled={updateLead.isPending}
                >
                  {updateLead.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Salvar
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="pipeline" className="mt-0 space-y-4">
              <div className="text-center pb-2">
                <h4 className="font-medium">Pipeline de Qualificação</h4>
                <p className="text-sm text-muted-foreground">Mova o lead entre os estágios</p>
              </div>

              {pipeStatus ? (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-muted/50 text-center">
                    <span className="text-xs text-muted-foreground">Status Atual</span>
                    <div className="flex items-center justify-center gap-2 mt-1">
                      <span className="text-2xl">
                        {pipelineStages.find((s) => s.id === pipeStatus.status)?.icon}
                      </span>
                      <span
                        className="font-semibold text-lg"
                        style={{
                          color: pipelineStages.find((s) => s.id === pipeStatus.status)?.color,
                        }}
                      >
                        {pipelineStages.find((s) => s.id === pipeStatus.status)?.title}
                      </span>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-1 gap-2">
                    {pipelineStages.map((stage) => {
                      const isCurrent = stage.id === pipeStatus.status;
                      return (
                        <Button
                          key={stage.id}
                          variant={isCurrent ? "default" : "outline"}
                          className={cn("justify-start h-12", isCurrent && "ring-2 ring-offset-2")}
                          style={{
                            ...(isCurrent && { backgroundColor: stage.color }),
                            borderColor: stage.color,
                          }}
                          onClick={() => !isCurrent && handleStageChange(stage.id)}
                          disabled={isCurrent || updatePipeStatus.isPending}
                        >
                          <span className="text-lg mr-3">{stage.icon}</span>
                          <span className="flex-1 text-left">{stage.title}</span>
                          {isCurrent ? <Check className="w-4 h-4" /> : <ArrowRight className="w-4 h-4 opacity-50" />}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 space-y-3">
                  <Target className="w-10 h-10 mx-auto text-muted-foreground/50" />
                  <p className="text-muted-foreground text-sm">
                    Lead não está no pipeline de qualificação.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!lead) return;
                      linkLeadToWhatsApp.mutate({ leadId: lead.id, phone: phoneNumber });
                    }}
                    disabled={linkLeadToWhatsApp.isPending}
                  >
                    {linkLeadToWhatsApp.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 mr-2" />
                    )}
                    Adicionar ao pipeline
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="campanha" className="mt-0 space-y-4">
              <div className="text-center pb-2">
                <h4 className="font-medium">Campanhas</h4>
                <p className="text-sm text-muted-foreground">Vincule este lead a uma campanha ativa</p>
              </div>

              {activeCampanhas.length > 0 ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Selecione uma campanha</Label>
                    <Select value={selectedCampanhaId || ""} onValueChange={setSelectedCampanhaId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha uma campanha..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activeCampanhas.map((campanha) => (
                          <SelectItem key={campanha.id} value={campanha.id}>
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4" />
                              {campanha.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedCampanhaId && (
                    <Button
                      className="w-full"
                      onClick={handleAddToCampanha}
                      disabled={isAddingToCampanha || !campanhaStages.length}
                    >
                      {isAddingToCampanha ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      Adicionar à Campanha
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">Nenhuma campanha ativa no momento</p>
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      ) : null}
    </div>
  );
}
