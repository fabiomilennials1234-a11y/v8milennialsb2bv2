import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export interface SmsMessage {
  id: string;
  lead_id: string | null;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  status: "queued" | "sent" | "delivered" | "failed" | "received";
  error_message: string | null;
  sent_at: string;
  delivered_at: string | null;
}

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  variables: string[];
  category: string | null;
  is_active: boolean;
}

export function useSmsMessages(leadId?: string, limit = 30) {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<SmsMessage[]>({
    queryKey: ["sms-messages", orgId, leadId, limit],
    queryFn: async () => {
      let q = (supabase.from as any)("sms_messages")
        .select("id, lead_id, direction, from_number, to_number, body, status, error_message, sent_at, delivered_at")
        .eq("organization_id", orgId!)
        .order("sent_at", { ascending: false })
        .limit(limit);

      if (leadId) q = q.eq("lead_id", leadId);

      const { data, error } = await q;
      if (error) throw error;
      return data as SmsMessage[];
    },
    enabled: !!orgId,
  });
}

export function useSmsTemplates() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<SmsTemplate[]>({
    queryKey: ["sms-templates", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("sms_templates")
        .select("id, name, body, variables, category, is_active")
        .eq("organization_id", orgId!)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as SmsTemplate[];
    },
    enabled: !!orgId,
  });
}

export function useSendSms() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      leadId?: string;
      toNumber: string;
      body: string;
      templateId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: {
          lead_id: payload.leadId,
          to_number: payload.toNumber,
          body: payload.body,
          template_id: payload.templateId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("SMS enviado");
      queryClient.invalidateQueries({ queryKey: ["sms-messages"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao enviar SMS: ${error.message}`);
    },
  });
}

export function useCreateSmsTemplate() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (input: { name: string; body: string; variables?: string[]; category?: string }) => {
      const { data, error } = await (supabase.from as any)("sms_templates")
        .insert({
          organization_id: organization!.id,
          name: input.name,
          body: input.body,
          variables: input.variables ?? [],
          category: input.category ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Template SMS criado");
      queryClient.invalidateQueries({ queryKey: ["sms-templates"] });
    },
  });
}
