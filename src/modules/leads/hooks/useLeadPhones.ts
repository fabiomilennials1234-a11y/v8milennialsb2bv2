import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  PrincipalOcupadoError,
  ehPrincipalOcupado,
  erroDeTelefone,
  leadPhoneFromRow,
  ordenarTelefones,
  type DonoDoNumero,
  type LeadPhone,
  type LeadPhoneRow,
} from "../lib/lead-phones";
import { useOrganization } from "@/modules/identity";
import { normalizePhone } from "@/lib/normalizePhone";
import { extractSearchDigits } from "../lib/lead-list-filters";

/**
 * Telefones (contatos nomeados) do lead — Chamado 82c50502.
 *
 * Leitura direta em `lead_phones` (RLS herda a visibilidade do lead). Escrita
 * SEMPRE pelas RPCs: `salvar_telefones_do_lead` (lista completa, soft delete do
 * que saiu, troca de principal via `leads.phone`), `nomear_contato_do_telefone`
 * e `definir_telefone_do_negocio`.
 */
export const leadPhonesKey = (leadId: string | null) => ["lead-phones", leadId] as const;
/** Marca `leads.phone_compartilhado` do lead (Chamado 99067f13, PR4). */
export const leadPhoneCompartilhadoKey = (leadId: string | null) =>
  ["lead-phone-compartilhado", leadId] as const;

const SELECT = "id, phone, normalized_phone, label, label_locked, is_primary, is_whatsapp, source";

export function useLeadPhones(leadId: string | null, enabled = true) {
  return useQuery({
    queryKey: leadPhonesKey(leadId),
    enabled: enabled && !!leadId,
    staleTime: 30_000,
    queryFn: async (): Promise<LeadPhone[]> => {
      const { data, error } = await supabase
        .from("lead_phones")
        .select(SELECT)
        .eq("lead_id", leadId!)
        .is("deleted_at", null);
      if (error) throw error;
      return ordenarTelefones(((data ?? []) as LeadPhoneRow[]).map(leadPhoneFromRow));
    },
  });
}

/** Teto de leads trazidos pelo telefone secundário — a busca é por um número. */
const TETO_BUSCA_SECUNDARIA = 200;

/**
 * Por quanto tempo a resposta de um par (org, dígitos) vale. A tela de Leads
 * monta a lista + quatro contagens + o modal de pipe, todos com o mesmo termo:
 * dentro desta janela é UMA ida ao banco, não seis.
 */
const BUSCA_SECUNDARIA_STALE_MS = 60_000;

/** Raiz das entradas de cache da pré-consulta — invalidada quando telefone muda. */
const BUSCA_SECUNDARIA_ROOT = ["lead-phones-busca-secundaria"] as const;

const buscaSecundariaKey = (organizationId: string, digits: string) =>
  [...BUSCA_SECUNDARIA_ROOT, organizationId, digits] as const;

async function consultarLeadIdsPorTelefoneSecundario(
  organizationId: string,
  digits: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("lead_phones")
    .select("lead_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .ilike("normalized_phone", `%${digits}%`)
    .limit(TETO_BUSCA_SECUNDARIA);
  if (error) throw error;
  return [...new Set(((data ?? []) as { lead_id: string }[]).map((r) => r.lead_id))];
}

/**
 * Pré-consulta da busca da lista de Leads: ids dos leads cujo telefone
 * SECUNDÁRIO casa com os dígitos digitados (Chamado 82c50502). Sem termo de
 * telefone, não consulta nada. Falha de leitura degrada para "sem secundário"
 * — a busca por nome/principal continua funcionando.
 *
 * Passa pelo cache do TanStack Query, chaveado pelos DÍGITOS (não pelo texto:
 * "(21) 9999" e "219999" são a mesma consulta). `fetchQuery` compartilha a
 * promessa em voo entre chamadores simultâneos e devolve o cache dentro da
 * janela. Erro não fica em cache: o próximo chamador tenta de novo.
 */
export async function buscarLeadIdsPorTelefoneSecundario(
  queryClient: QueryClient,
  organizationId: string,
  search: string | null | undefined,
): Promise<string[]> {
  const digits = search?.trim() ? extractSearchDigits(search.trim()) : null;
  if (!digits) return [];
  try {
    return await queryClient.fetchQuery({
      queryKey: buscaSecundariaKey(organizationId, digits),
      queryFn: () => consultarLeadIdsPorTelefoneSecundario(organizationId, digits),
      staleTime: BUSCA_SECUNDARIA_STALE_MS,
      retry: false,
    });
  } catch {
    return [];
  }
}

export interface TelefoneEditado {
  id?: string;
  phone: string;
  label: string | null;
  isPrimary: boolean;
}

/** Invalida tudo que mostra telefone ou nome de contato. */
function invalidarTelefones(qc: ReturnType<typeof useQueryClient>, leadId: string | null) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: leadPhonesKey(leadId) }),
    qc.invalidateQueries({ queryKey: leadPhoneCompartilhadoKey(leadId) }),
    // Número que entrou/saiu muda quem a busca por telefone secundário acha.
    qc.invalidateQueries({ queryKey: BUSCA_SECUNDARIA_ROOT }),
    // A ficha (telefone principal) e o chat (nome "Cód - Contato - Lead").
    qc.invalidateQueries({ queryKey: ["lead-detail", leadId] }),
    qc.invalidateQueries({ queryKey: ["contatos-das-conversas"] }),
    qc.invalidateQueries({ queryKey: ["whatsapp-contacts"] }),
  ]);
}

/**
 * `permitirCompartilhado` só vai a `true` DEPOIS que o usuário confirmou o
 * diálogo "Compartilhar o número entre os dois leads?" (Chamado 99067f13, PR4).
 * Sem ele a RPC é chamada como sempre foi.
 */
export interface SalvarTelefonesInput {
  telefones: TelefoneEditado[];
  permitirCompartilhado?: boolean;
}

/** Busca QUEM segura o número como principal (RLS do usuário recorta; sem acesso → null). */
export async function buscarDonoDoNumero(
  organizationId: string | null | undefined,
  leadId: string,
  telefone: string | null | undefined,
): Promise<DonoDoNumero | null> {
  const principal = normalizePhone(telefone ?? null);
  if (!organizationId || !principal) return null;
  const { data } = await supabase
    .from("leads")
    .select("id, name, erp_code")
    .eq("organization_id", organizationId)
    .eq("normalized_phone", principal)
    // O dono é quem NÃO compartilha: os compartilhados são cópias.
    .eq("phone_compartilhado", false)
    .is("deleted_at", null)
    .neq("id", leadId)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export function useSalvarTelefonesDoLead(leadId: string | null) {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();
  return useMutation({
    // Aceita a lista pura (chamadores antigos) ou { telefones, permitirCompartilhado }.
    mutationFn: async (entrada: TelefoneEditado[] | SalvarTelefonesInput): Promise<void> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      const { telefones, permitirCompartilhado = false } = Array.isArray(entrada)
        ? { telefones: entrada }
        : entrada;
      // Chamado NO objeto: `const rpc = supabase.rpc` perde o receiver.
      const { error } = await supabase.rpc("salvar_telefones_do_lead", {
        p_lead_id: leadId,
        p_phones: telefones.map((t) => ({
          ...(t.id ? { id: t.id } : {}),
          phone: t.phone.trim(),
          label: t.label?.trim() || null,
          is_primary: t.isPrimary,
        })),
        ...(permitirCompartilhado ? { p_permitir_compartilhado: true } : {}),
      });
      if (error) {
        // 23505 = o principal escolhido já é o principal de outro lead: busca
        // QUAL (RLS do usuário recorta; sem acesso, a frase fica genérica) e deixa
        // a tela perguntar se compartilha. Com a confirmação já dada o banco não
        // devolve 23505 — se devolver, é outra coisa e sobe como erro.
        if (!permitirCompartilhado && ehPrincipalOcupado(error)) {
          const dono = await buscarDonoDoNumero(
            organizationId,
            leadId,
            telefones.find((t) => t.isPrimary)?.phone,
          );
          throw new PrincipalOcupadoError(dono);
        }
        throw erroDeTelefone(error);
      }
    },
    onSettled: () => invalidarTelefones(qc, leadId),
  });
}

export function useNomearContatoDoTelefone(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ phone, label }: { phone: string; label: string | null }): Promise<void> => {
      if (!leadId) throw new Error("Lead não encontrado. Atualize a ficha.");
      const { error } = await supabase.rpc("nomear_contato_do_telefone", {
        p_lead_id: leadId,
        p_phone: phone,
        p_label: label?.trim() || null,
      } as never);
      if (error) throw erroDeTelefone(error);
    },
    onSettled: () => invalidarTelefones(qc, leadId),
  });
}

export function useDefinirTelefoneDoNegocio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, leadPhoneId }: { dealId: string; leadPhoneId: string }): Promise<void> => {
      const { error } = await supabase.rpc("definir_telefone_do_negocio", {
        p_deal_id: dealId,
        p_lead_phone_id: leadPhoneId,
      });
      if (error) throw erroDeTelefone(error);
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["deal-card-extras"] }),
        qc.invalidateQueries({ queryKey: ["deal-lead-phone"] }),
      ]),
  });
}
