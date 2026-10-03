/**
 * useLeadForm — estado de formulário + save para lead existente.
 *
 * Onda 3.1, C11. Extrai handleUpdateLead do shell LeadDetailContent.
 * Gerencia: hydrate do form ao carregar lead, dirty state, mutation de save.
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useUpdateLead } from "../useLeads";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import type { LeadContactFormData } from "../../components/lead/info/LeadContactInfo";

interface Lead {
  id: string;
  name?: string | null;
  company?: string | null;
  email?: string | null;
  notes?: string | null;
  phone?: string | null;
  segment?: string | null;
  interest?: string | null;
}

interface UseLeadFormResult {
  formData: LeadContactFormData;
  setFormData: (data: LeadContactFormData) => void;
  onChange: (data: LeadContactFormData) => void;
  save: () => Promise<boolean>;
  isSaving: boolean;
}

export function useLeadForm(
  lead: Lead | null | undefined,
  pushName?: string | null,
): UseLeadFormResult {
  const [formData, setFormData] = useState<LeadContactFormData>({
    name: "",
    company: "",
    email: "",
    notes: "",
  });

  const updateLead = useUpdateLead();
  const logAction = useLogLeadAction();

  // Hydrate form when lead loads or changes
  useEffect(() => {
    if (lead) {
      setFormData({
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        notes: lead.notes || "",
        phone: lead.phone || "",
        segment: lead.segment || "",
        interest: lead.interest || "",
      });
    } else {
      setFormData({ name: pushName || "", company: "", email: "", notes: "" });
    }
  }, [lead, pushName]);

  const save = async () => {
    if (!lead) return false;
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return false;
    }
    try {
      await updateLead.mutateAsync({
        id: lead.id,
        name: formData.name.trim(),
        company: formData.company || null,
        email: formData.email || null,
        notes: formData.notes || null,
        phone: formData.phone || null,
        segment: formData.segment || null,
        interest: formData.interest || null,
      });
      logAction({ leadId: lead.id, action: "field_updated", description: "Dados do lead atualizados via chat" });
      toast.success("Lead atualizado!");
      return true;
    } catch {
      toast.error("Não foi possível salvar o lead. Tente novamente.");
      return false;
    }
  };

  return {
    formData,
    setFormData,
    onChange: setFormData,
    save,
    isSaving: updateLead.isPending,
  };
}
