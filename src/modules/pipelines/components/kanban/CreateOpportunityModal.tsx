import { useState, useMemo, useEffect } from "react";
import { Search, User, Building2, Zap, Globe, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeads } from "@/modules/leads";
import { useTeamMembers } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { useCreatePipeWhatsapp, usePipeWhatsapp } from "@/modules/pipelines/hooks/legacy/usePipeWhatsapp";
import { usePipelineStages } from "@/modules/pipelines/hooks/model/usePipelineStages";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Origin labels and colors mapping (enum lead_origin)
const originLabels: Record<string, { label: string; color: string }> = {
  whatsapp: { label: "WhatsApp", color: "bg-green-500" },
  meta_ads: { label: "Meta Ads", color: "bg-purple-500" },
  instagram: { label: "Instagram", color: "bg-pink-500" },
  tiktok: { label: "Tiktok", color: "bg-foreground/15" },
  google_ads: { label: "Google Ads", color: "bg-red-500" },
  site: { label: "Site", color: "bg-teal-500" },
  landing_page: { label: "Landing Page", color: "bg-sky-500" },
  remarketing: { label: "Remarketing", color: "bg-orange-500" },
  indicacao: { label: "Indicação", color: "bg-emerald-500" },
  evento: { label: "Evento", color: "bg-violet-500" },
  prospeccao_ativa: { label: "Prospecção Ativa", color: "bg-orange-600" },
  cal: { label: "Cal.com", color: "bg-blue-500" },
  outro: { label: "Outros", color: "bg-muted-foreground/15" },
};

interface CreateOpportunityModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateOpportunityModal({ 
  open, 
  onOpenChange, 
  onSuccess,
}: CreateOpportunityModalProps) {
  const [step, setStep] = useState<"select-lead" | "opportunity-details">("select-lead");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    pre_sale_responsible_id: "",
    sale_responsible_id: "",
    scheduled_date: "",
    notes: "",
  });

  const { organizationId } = useOrganization();
  const { data: leads = [], isLoading: leadsLoading } = useLeads();
  const { data: pipeData = [] } = usePipeWhatsapp();
  const { data: whatsappStages = [] } = usePipelineStages("whatsapp");
  const { data: teamMembers = [] } = useTeamMembers();
  const createPipeWhatsapp = useCreatePipeWhatsapp();

  const activeMembers = teamMembers.filter(m => m.is_active);

  // Get lead IDs that are already in the pipe
  const leadsInPipe = useMemo(() => {
    return new Set(pipeData.map(item => item.lead_id));
  }, [pipeData]);

  // Filter leads that are NOT already in the pipe
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // Exclude leads already in the pipe
      if (leadsInPipe.has(lead.id)) return false;
      
      const matchesSearch = searchTerm === "" || 
        lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.email?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [leads, searchTerm, leadsInPipe]);

  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep("select-lead");
        setSearchTerm("");
        setSelectedLeadId(null);
        setFormData({
          pre_sale_responsible_id: "",
          sale_responsible_id: "",
          scheduled_date: "",
          notes: "",
        });
      }, 200);
    }
  }, [open]);

  // Auto-fill responsible from lead
  useEffect(() => {
    if (selectedLead) {
      setFormData(prev => ({
        ...prev,
        pre_sale_responsible_id: selectedLead.pre_sale_responsible_id || selectedLead.responsible_id || "",
        sale_responsible_id: selectedLead.sale_responsible_id || "",
      }));
    }
  }, [selectedLead]);

  const handleSelectLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    setStep("opportunity-details");
  };

  const handleSubmit = async () => {
    if (!selectedLeadId) {
      toast.error("Selecione um lead");
      return;
    }

    try {
      if (!organizationId) {
        toast.error("Organização não disponível");
        return;
      }
      // Ghost-stage guard: nunca criar em "novo" hardcoded — resolve a 1ª etapa
      // ATIVA da org (whatsappStages já vem filtrado is_active + ordenado por
      // position). Fallback "novo" só se a org não tiver nenhuma etapa.
      const firstActiveStage = whatsappStages[0]?.stage_key ?? "novo";
      await createPipeWhatsapp.mutateAsync({
        lead_id: selectedLeadId,
        status: firstActiveStage,
        pre_sale_responsible_id: formData.pre_sale_responsible_id || null,
        sale_responsible_id: formData.sale_responsible_id || null,
        responsible_id: formData.pre_sale_responsible_id || null,
        scheduled_date: formData.scheduled_date ? new Date(formData.scheduled_date).toISOString() : null,
        notes: formData.notes || null,
        organization_id: organizationId,
      });

      toast.success("🎉 Oportunidade criada com sucesso!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar oportunidade");
      console.error(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />
            {step === "select-lead" ? "Selecionar Lead" : "Nova Oportunidade"}
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === "select-lead" ? (
            <motion.div
              key="select-lead"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col min-h-0"
            >
              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar lead por nome, empresa ou email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Lead List */}
              <ScrollArea className="flex-1 -mx-6 px-6">
                <div className="space-y-2 pb-4">
                  {leadsLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Carregando leads...
                    </div>
                  ) : filteredLeads.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      {leadsInPipe.size > 0 && searchTerm === "" 
                        ? "Todos os leads já estão no funil"
                        : "Nenhum lead encontrado"
                      }
                    </div>
                  ) : (
                    filteredLeads.map((lead) => {
                      const originInfo = originLabels[lead.origin || "outro"] || originLabels.outro;
                      
                      return (
                        <motion.button
                          key={lead.id}
                          onClick={() => handleSelectLead(lead.id)}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          className={cn(
                            "w-full p-4 rounded-lg border text-left transition-all",
                            "hover:border-primary/50 hover:bg-primary/5",
                            selectedLeadId === lead.id && "border-primary bg-primary/10"
                          )}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-primary" />
                                <span className="font-medium truncate">{lead.name}</span>
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs text-white border-0 ${originInfo.color}`}
                                >
                                  <Globe className="w-3 h-3 mr-1" />
                                  {originInfo.label}
                                </Badge>
                              </div>
                              {lead.company && (
                                <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                                  <Building2 className="w-3.5 h-3.5" />
                                  <span className="text-sm truncate">{lead.company}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-3 mt-2">
                                {lead.faturamento && (
                                  <Badge variant="outline" className="text-xs">
                                    {lead.faturamento}
                                  </Badge>
                                )}
                                {lead.segment && (
                                  <Badge variant="secondary" className="text-xs">
                                    {lead.segment}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </motion.div>
          ) : (
            <motion.div
              key="opportunity-details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 overflow-y-auto"
            >
              {/* Selected Lead Info */}
              {selectedLead && (
                <div className="p-4 bg-muted/50 rounded-lg mb-6 border">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-primary" />
                        <span className="font-medium">{selectedLead.name}</span>
                        <Badge 
                          variant="outline" 
                          className={`text-xs border-0 ${originLabels[selectedLead.origin || "outro"]?.color || "bg-muted-foreground/15"}`}
                        >
                          <Globe className="w-3 h-3 mr-1" />
                          {originLabels[selectedLead.origin || "outro"]?.label || "Outro"}
                        </Badge>
                      </div>
                      {selectedLead.company && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {selectedLead.company}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStep("select-lead")}
                    >
                      Trocar Lead
                    </Button>
                  </div>
                </div>
              )}

              {/* Opportunity Form */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Resp. Pré-Venda</Label>
                    <Select
                      value={formData.pre_sale_responsible_id}
                      onValueChange={(v) => setFormData({ ...formData, pre_sale_responsible_id: v })}
                    >
                      <SelectTrigger>
                        <User className="w-4 h-4 mr-2 text-muted-foreground" />
                        <SelectValue placeholder="Selecionar (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeMembers.map(member => (
                          <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Resp. Venda</Label>
                    <Select
                      value={formData.sale_responsible_id}
                      onValueChange={(v) => setFormData({ ...formData, sale_responsible_id: v })}
                    >
                      <SelectTrigger>
                        <User className="w-4 h-4 mr-2 text-muted-foreground" />
                        <SelectValue placeholder="Selecionar (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeMembers.map(member => (
                          <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="scheduled_date">Data Agendada (opcional)</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="scheduled_date"
                      type="datetime-local"
                      value={formData.scheduled_date}
                      onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notes">Observações</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Detalhes sobre a oportunidade, contexto do lead..."
                    rows={3}
                  />
                </div>

                {/* Info about next steps */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-primary/10 border border-primary/20 rounded-lg"
                >
                  <div className="flex items-center gap-2 text-primary">
                    <Zap className="w-5 h-5" />
                    <span className="font-medium">Próximos passos</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    O lead entrará na etapa "Novo" e poderá ser movido através do funil.
                    Etapas de sucesso com transição configurada movem o negócio ao funil de destino automaticamente.
                  </p>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <div className="flex justify-between gap-2 pt-4 border-t mt-4">
          {step === "opportunity-details" && (
            <Button variant="outline" onClick={() => setStep("select-lead")}>
              Voltar
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {step === "opportunity-details" && (
              <Button 
                onClick={handleSubmit}
                disabled={createPipeWhatsapp.isPending}
              >
                {createPipeWhatsapp.isPending ? "Criando..." : "Criar Oportunidade"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
