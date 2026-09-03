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
}

interface UseLeadFormResult {
  formData: LeadContactFormData;
  setFormData: (data: LeadContactFormData) => void;
  onChange: (data: LeadContactFormData) => void;
  save: () => Promise<void>;
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
      });
    } else {
      setFormData({ name: pushName || "", company: "", email: "", notes: "" });
    }
  }, [lead, pushName]);

  const save = async () => {
    if (!lead) return;
    await updateLead.mutateAsync({
      id: lead.id,
      name: formData.name,
      company: formData.company || null,
      email: formData.email || null,
      notes: formData.notes || null,
    });
    logAction({ leadId: lead.id, action: "field_updated", description: "Dados do lead atualizados via chat" });
    toast.success("Lead atualizado!");
  };

  return {
    formData,
    setFormData,
    onChange: setFormData,
    save,
    isSaving: updateLead.isPending,
  };
}
