import { useState, useEffect } from "react";
import { Star, Building, Phone, Mail, User, Tag, Plus, Type, Hash, Calendar, List, ToggleLeft } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTeamMembers, useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useCreateLead, useUpdateLead } from "@/hooks/useLeads";
import {
  useLeadCustomFields,
  useLeadCustomFieldValues,
  useSaveCustomFieldValue,
  type CustomField,
} from "@/hooks/useLeadCustomFields";
import { toast } from "sonner";

const originLabels: Record<string, string> = {
  remarketing: "Remarketing",
  base_clientes: "Base de clientes",
  parceiro: "Parceiro",
  indicacao: "Indicação",
  calendly: "Calendly",
  quiz: "Quiz",
  site: "Site",
  organico: "Orgânico",
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outro",
};

interface LeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: any;
  onSuccess?: () => void;
  defaultSdrId?: string;
  defaultCloserId?: string;
}

interface FormData {
  name: string;
  company: string;
  email: string;
  phone: string;
  origin: string;
  rating: number;
  segment: string;
  faturamento: string;
  urgency: string;
  notes: string;
  sdr_id: string | null;
  closer_id: string | null;
}

function StarRating({ rating, onRate }: { rating: number; onRate: (r: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onRate(star)}
          className="cursor-pointer hover:scale-110 transition-transform"
        >
          <Star
            className={`w-4 h-4 ${
              star <= rating
                ? "fill-chart-5 text-chart-5"
                : "text-muted-foreground/30"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export function LeadModal({ 
  open, 
  onOpenChange, 
  lead, 
  onSuccess,
  defaultSdrId,
  defaultCloserId
}: LeadModalProps) {
  const isEditing = !!lead;
  
  const [formData, setFormData] = useState<FormData>(() => ({
    name: lead?.name || "",
    company: lead?.company || "",
    email: lead?.email || "",
    phone: lead?.phone || "",
    origin: lead?.origin || "outro",
    rating: lead?.rating || 5,
    segment: lead?.segment || "",
    faturamento: lead?.faturamento || "",
    urgency: lead?.urgency || "",
    notes: lead?.notes || "",
    sdr_id: lead?.sdr_id || defaultSdrId || null,
    closer_id: lead?.closer_id || defaultCloserId || null,
  }));
  
  // Estado para campos personalizados
  const [customValues, setCustomValues] = useState<Record<string, string>>({});

  const { data: teamMembers = [] } = useTeamMembers();
  const { data: currentTeamMember, refetch: refetchTeamMember, isLoading: isLoadingTeamMember, isFetching: isFetchingTeamMember } = useCurrentTeamMember();
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  
  // Hooks para campos personalizados
  const { data: customFields = [] } = useLeadCustomFields();
  const { data: fieldValues = [] } = useLeadCustomFieldValues(lead?.id || null);
  const saveFieldValue = useSaveCustomFieldValue();
  
  // Carregar valores dos campos personalizados quando lead mudar.
  // Dependência estável (JSON) evita loop "Maximum update depth exceeded" quando fieldValues
  // tem nova referência a cada render.
  const fieldValuesKey = lead?.id ?? "";
  const fieldValuesSnapshot = fieldValues.length > 0
    ? JSON.stringify(fieldValues.map((fv) => ({ field_id: fv.field_id, value: fv.value ?? "" })))
    : "";

  useEffect(() => {
    if (lead?.id && fieldValues.length > 0) {
      const values: Record<string, string> = {};
      fieldValues.forEach((fv) => {
        values[fv.field_id] = fv.value || "";
      });
      setCustomValues(values);
    } else {
      setCustomValues({});
    }
  }, [fieldValuesKey, fieldValuesSnapshot]);

  const sdrs = teamMembers.filter(m => m.role === "sdr" && m.is_active);
  const closers = teamMembers.filter(m => m.role === "closer" && m.is_active);

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    // Verificar se ainda está carregando
    if (isLoadingTeamMember || isFetchingTeamMember) {
      toast.info("Carregando informações da organização...");
      return;
    }

    // Verificar se tem organization_id
    if (!currentTeamMember?.organization_id) {
      // Tentar refetch antes de mostrar erro
      const { data: refreshedTeamMember } = await refetchTeamMember();
      
      if (!refreshedTeamMember?.organization_id) {
        toast.error(
          "Você precisa estar vinculado a uma organização. Execute o script SQL 'SOLUCAO_DEFINITIVA_RLS.sql' no Supabase Dashboard e recarregue a página.",
          { duration: 10000 }
        );
        console.error("❌ Team member sem organization_id:", {
          currentTeamMember,
          refreshedTeamMember,
          hasTeamMember: !!currentTeamMember,
          organizationId: currentTeamMember?.organization_id,
          isLoading: isLoadingTeamMember,
          isFetching: isFetchingTeamMember,
        });
        return;
      }
      
      // Se o refetch trouxe dados, usar o refreshed
      if (refreshedTeamMember?.organization_id) {
        // Continuar com o submit usando refreshedTeamMember
        currentTeamMember.organization_id = refreshedTeamMember.organization_id;
      }
    }

    try {
      const payload = {
        ...formData,
        origin: formData.origin as any,
        faturamento: formData.faturamento || null,
        sdr_id: formData.sdr_id || null,
        closer_id: formData.closer_id || null,
        organization_id: currentTeamMember.organization_id,
      };

      let leadId = lead?.id;
      
      if (isEditing) {
        await updateLead.mutateAsync({ id: lead.id, ...payload });
      } else {
        const newLead = await createLead.mutateAsync(payload);
        leadId = newLead.id;
      }
      
      // Salvar campos personalizados
      if (leadId && Object.keys(customValues).length > 0) {
        for (const [fieldId, value] of Object.entries(customValues)) {
          if (value !== undefined) {
            await saveFieldValue.mutateAsync({
              leadId,
              fieldId,
              value: value || null,
            });
          }
        }
      }
      
      toast.success(isEditing ? "Lead atualizado!" : "Lead criado!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error("❌ Erro ao salvar lead:", {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code,
        fullError: error,
      });
      
      if (error?.code === '42501' || error?.message?.includes('permission denied')) {
        toast.error("Erro de permissão. Verifique as políticas RLS no Supabase.");
      } else if (error?.code === '23503' || error?.message?.includes('foreign key')) {
        toast.error("Erro: organização não encontrada. Execute o script SQL de vinculação.");
      } else {
        toast.error(`Erro ao salvar lead: ${error?.message || 'Erro desconhecido'}`);
      }
    }
  };

  // Reset form when lead changes or modal opens
  useEffect(() => {
    if (open) {
      setFormData({
        name: lead?.name || "",
        company: lead?.company || "",
        email: lead?.email || "",
        phone: lead?.phone || "",
        origin: lead?.origin || "outro",
        rating: lead?.rating || 5,
        segment: lead?.segment || "",
        faturamento: lead?.faturamento || "",
        urgency: lead?.urgency || "",
        notes: lead?.notes || "",
        sdr_id: lead?.sdr_id || defaultSdrId || null,
        closer_id: lead?.closer_id || defaultCloserId || null,
      });
    }
  }, [open, lead, defaultSdrId, defaultCloserId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5 text-primary" />
            {isEditing ? "Editar Lead" : "Novo Lead"}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="info">Informações</TabsTrigger>
            <TabsTrigger value="details">Detalhes</TabsTrigger>
            <TabsTrigger value="custom" className="gap-1">
              <Plus className="w-3 h-3" />
              Personalizado
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
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
                <div className="relative">
                  <Building className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="Nome da empresa"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="email@empresa.com"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Telefone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="(11) 99999-9999"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="origin">Origem</Label>
                <Select
                  value={formData.origin}
                  onValueChange={(v) => setFormData({ ...formData, origin: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(originLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Rating do SDR (1-10)</Label>
                <div className="py-2">
                  <StarRating
                    rating={formData.rating}
                    onRate={(r) => setFormData({ ...formData, rating: r })}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sdr">SDR Responsável</Label>
                <Select
                  value={formData.sdr_id || "none"}
                  onValueChange={(v) => setFormData({ ...formData, sdr_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar SDR" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {sdrs.map(sdr => (
                      <SelectItem key={sdr.id} value={sdr.id}>{sdr.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="closer">Closer Responsável</Label>
                <Select
                  value={formData.closer_id || "none"}
                  onValueChange={(v) => setFormData({ ...formData, closer_id: v === "none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar Closer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {closers.map(closer => (
                      <SelectItem key={closer.id} value={closer.id}>{closer.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="details" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="segment">Segmento</Label>
                <Input
                  id="segment"
                  value={formData.segment}
                  onChange={(e) => setFormData({ ...formData, segment: e.target.value })}
                  placeholder="Ex: Tecnologia, Varejo..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="faturamento">Faturamento</Label>
                <Input
                  id="faturamento"
                  value={formData.faturamento}
                  onChange={(e) => setFormData({ ...formData, faturamento: e.target.value })}
                  placeholder="Ex: R$ 100.000, Acima de 1M..."
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="urgency">Urgência</Label>
              <Input
                id="urgency"
                value={formData.urgency}
                onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
                placeholder="Ex: Alta, Média, Baixa..."
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Observações</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Anotações sobre o lead..."
                rows={4}
              />
            </div>

            {lead?.lead_tags?.length > 0 && (
              <div className="grid gap-2">
                <Label>Tags</Label>
                <div className="flex flex-wrap gap-2">
                  {lead.lead_tags.map((lt: any) => (
                    <Badge
                      key={lt.tag.id}
                      variant="outline"
                      style={{ 
                        backgroundColor: `${lt.tag.color}20`,
                        borderColor: `${lt.tag.color}40`,
                        color: lt.tag.color
                      }}
                    >
                      <Tag className="w-3 h-3 mr-1" />
                      {lt.tag.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
          
          {/* Aba de Campos Personalizados */}
          <TabsContent value="custom" className="space-y-4 mt-4">
            {customFields.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                <Type className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Nenhum campo personalizado</p>
                <p className="text-xs mt-1">
                  Configure campos em Funil WhatsApp → Campos Personalizados
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[280px] pr-4">
                <div className="grid grid-cols-2 gap-4">
                  {customFields.map((field) => {
                    const value = customValues[field.id] || "";
                    const FieldIcon = {
                      text: Type,
                      number: Hash,
                      date: Calendar,
                      select: List,
                      boolean: ToggleLeft,
                    }[field.field_type] || Type;
                    
                    return (
                      <div key={field.id} className="grid gap-2">
                        <Label className="flex items-center gap-1.5 text-sm">
                          <FieldIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          {field.field_name}
                          {field.is_required && <span className="text-destructive">*</span>}
                        </Label>
                        
                        {field.field_type === "select" ? (
                          <Select
                            value={value}
                            onValueChange={(v) => setCustomValues({ ...customValues, [field.id]: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(field.field_options || []).map((opt: string) => (
                                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : field.field_type === "boolean" ? (
                          <Select
                            value={value}
                            onValueChange={(v) => setCustomValues({ ...customValues, [field.id]: v })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Sim</SelectItem>
                              <SelectItem value="false">Não</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : field.field_type === "date" ? (
                          <Input
                            type="date"
                            value={value}
                            onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                          />
                        ) : field.field_type === "number" ? (
                          <Input
                            type="number"
                            value={value}
                            onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                            placeholder={`Digite ${field.field_name.toLowerCase()}...`}
                          />
                        ) : (
                          <Input
                            value={value}
                            onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                            placeholder={`Digite ${field.field_name.toLowerCase()}...`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={createLead.isPending || updateLead.isPending}
          >
            {isEditing ? "Salvar Alterações" : "Criar Lead"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
