import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildPhonesPayload,
  CONTACT_PAGE_SIZE,
  parseContactList,
  type ContactFormValues,
  type ContactList,
} from "../lib/contacts";

/**
 * Contatos (Chamado 33c5fd52 · PR6).
 *
 * Leitura: UMA RPC (`contact_list`, SECURITY INVOKER — a RLS decide o que
 * aparece), página de 50. Escrita: só RPC SECURITY DEFINER; as tabelas não têm
 * GRANT de escrita. As RPCs devolvem o id do registro tocado, então um alvo
 * que não existe (ou de outra org) volta como erro PT404 em vez de um 200 vazio.
 *
 * Os hooks lançam o erro ORIGINAL do PostgREST (com `code`): quem mostra ao
 * usuário usa `notifyError(err, { fallback, message: recusaDeContato(err) })`.
 * `supabase.rpc(...)` sempre chamado no objeto — a referência solta perde o
 * receiver.
 */

export const CONTACTS_KEY = "contacts";

export interface UseContactsArgs {
  organizationId: string | null;
  search: string;
  page: number;
}

export function useContacts({ organizationId, search, page }: UseContactsArgs) {
  const termo = search.trim();
  return useQuery<ContactList>({
    queryKey: [CONTACTS_KEY, organizationId, termo, page],
    enabled: !!organizationId,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contact_list", {
        p_org: organizationId as string,
        p_search: termo || undefined,
        p_limit: CONTACT_PAGE_SIZE,
        p_offset: page * CONTACT_PAGE_SIZE,
      });
      if (error) throw error;
      return parseContactList(data);
    },
  });
}

/** Contato muda a lista e o que cada lead mostra dos seus contatos. */
function useInvalidarContatos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [CONTACTS_KEY] });
}

export function useCreateContact(organizationId: string) {
  const invalidar = useInvalidarContatos();
  return useMutation({
    mutationFn: async (values: ContactFormValues): Promise<string> => {
      const { data, error } = await supabase.rpc("contact_create", {
        p_org: organizationId,
        p_name: values.name.trim(),
        p_email: values.email.trim() || undefined,
        p_job_title: values.jobTitle.trim() || undefined,
        p_phones: buildPhonesPayload(values.phones),
        p_lead_ids: values.leadIds,
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: invalidar,
  });
}

export interface UpdateContactInput {
  id: string;
  values: ContactFormValues;
}

export function useUpdateContact() {
  const invalidar = useInvalidarContatos();
  return useMutation({
    mutationFn: async ({ id, values }: UpdateContactInput): Promise<string> => {
      const { data, error } = await supabase.rpc("contact_update", {
        p_contact_id: id,
        p_name: values.name.trim(),
        p_email: values.email.trim() || undefined,
        p_job_title: values.jobTitle.trim() || undefined,
        p_phones: buildPhonesPayload(values.phones),
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: invalidar,
  });
}

export function useDeleteContact() {
  const invalidar = useInvalidarContatos();
  return useMutation({
    mutationFn: async (contactId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("contact_delete", { p_contact_id: contactId });
      if (error) throw error;
      return data as string;
    },
    onSettled: invalidar,
  });
}

export interface LinkLeadContactInput {
  contactId: string;
  leadId: string;
  papel?: string;
}

export function useLinkLeadContact() {
  const invalidar = useInvalidarContatos();
  return useMutation({
    mutationFn: async ({ contactId, leadId, papel }: LinkLeadContactInput): Promise<string> => {
      const { data, error } = await supabase.rpc("lead_contact_link", {
        p_lead_id: leadId,
        p_contact_id: contactId,
        p_papel: papel?.trim() || undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: invalidar,
  });
}

export interface UnlinkLeadContactInput {
  contactId: string;
  leadId: string;
}

export function useUnlinkLeadContact() {
  const invalidar = useInvalidarContatos();
  return useMutation({
    mutationFn: async ({ contactId, leadId }: UnlinkLeadContactInput): Promise<string> => {
      const { data, error } = await supabase.rpc("lead_contact_unlink", {
        p_lead_id: leadId,
        p_contact_id: contactId,
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: invalidar,
  });
}

export interface LeadOption {
  id: string;
  name: string;
}

const MIN_BUSCA_LEAD = 2;
const TETO_LEADS = 20;

/** Escapa `\`, `%` e `_` para o termo ser literal num ILIKE. */
function escaparLike(termo: string): string {
  return termo.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Leads da org para o seletor de vínculo. A RLS de `leads` já recorta o que o
 * usuário pode ver; `limit(20)` é teto de UI (bem abaixo do corte de 1000 do
 * PostgREST). Busca curta demais não consulta.
 */
export function useLeadPicker(organizationId: string | null, search: string) {
  const termo = search.trim();
  return useQuery<LeadOption[]>({
    queryKey: ["contact-lead-picker", organizationId, termo],
    enabled: !!organizationId && termo.length >= MIN_BUSCA_LEAD,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, name")
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .ilike("name", `%${escaparLike(termo)}%`)
        .order("name", { ascending: true })
        .limit(TETO_LEADS);
      if (error) throw error;
      return (data ?? []) as LeadOption[];
    },
  });
}
