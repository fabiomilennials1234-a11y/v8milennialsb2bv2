import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface Email {
  id: string;
  message_id: string;
  thread_id: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: Array<{ email: string; name?: string }>;
  cc_addresses: Array<{ email: string; name?: string }>;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  snippet: string | null;
  sent_at: string;
  is_outbound: boolean;
  has_attachments: boolean;
  read_at: string | null;
  open_count: number;
  click_count: number;
  contact_id: string | null;
  lead_id: string | null;
}

export function useEmails(opts?: { leadId?: string; contactId?: string; limit?: number }) {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<Email[]>({
    queryKey: ["emails", orgId, opts?.leadId, opts?.contactId, opts?.limit],
    queryFn: async () => {
      let q = (supabase.from as any)("emails")
        .select("*")
        .eq("organization_id", orgId!)
        .order("sent_at", { ascending: false })
        .limit(opts?.limit ?? 50);

      if (opts?.leadId) q = q.eq("lead_id", opts.leadId);
      if (opts?.contactId) q = q.eq("contact_id", opts.contactId);

      const { data, error } = await q;
      if (error) throw error;
      return data as Email[];
    },
    enabled: !!orgId,
  });
}

export function useEmailThread(threadId: string | null) {
  return useQuery<Email[]>({
    queryKey: ["email-thread", threadId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_email_thread", {
        p_thread_id: threadId,
      });
      if (error) throw error;
      return (data ?? []) as Email[];
    },
    enabled: !!threadId,
  });
}

export function useSendEmail() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (payload: {
      accountId: string;
      to: string[];
      cc?: string[];
      subject: string;
      bodyHtml: string;
      inReplyTo?: string;
      threadId?: string;
      leadId?: string;
      contactId?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          email_account_id: payload.accountId,
          to: payload.to,
          cc: payload.cc,
          subject: payload.subject,
          body_html: payload.bodyHtml,
          in_reply_to: payload.inReplyTo,
          thread_id: payload.threadId,
          lead_id: payload.leadId,
          contact_id: payload.contactId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["emails"] });
    },
  });
}
