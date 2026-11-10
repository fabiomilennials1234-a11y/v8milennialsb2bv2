import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { notifyError } from "@/shared/errors";
import { useEscopoAgenda } from "@/modules/analytics/hooks/useEscopoAgenda";
import { useIdentity } from "@/modules/identity";
import { termoDeBusca, type AgendaContato, type ResumoAgendaLinha } from "@/modules/analytics/lib/agenda-contatos";

/**
 * Agenda de contatos do Comando (migration 20280110000000).
 *
 * Escopo: membro vê só as próprias; admin alterna "Meu"/"Todos"
 * (`useEscopoAgenda`). Quem garante é a RLS da tabela — `p_somente_meus` só
 * estreita a visão do admin.
 *
 * `as never` nas RPCs: mais novas que o types.ts gerado de prod; morre no regen.
 */
const CHAVE = ["comando", "agenda-contatos"] as const;

function useParametros() {
  const { organizationId } = useOrganization();
  const { isReady } = useIdentity();
  const { somenteMeus } = useEscopoAgenda();
  return { organizationId, somenteMeus, pronto: !!organizationId && isReady };
}

export function useAgendaContatos() {
  const { organizationId, somenteMeus, pronto } = useParametros();
  return useQuery({
    queryKey: [...CHAVE, "lista", organizationId, somenteMeus],
    enabled: pronto,
    staleTime: 30_000,
    // A cor depende do dia: na virada, a amarela de ontem vira vermelha.
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<AgendaContato[]> => {
      const { data, error } = await supabase.rpc("get_agenda_contatos" as never, {
        p_org: organizationId,
        p_somente_meus: somenteMeus,
        p_limite: 1000,
      } as never);
      if (error) throw error;
      return (data ?? []) as AgendaContato[];
    },
  });
}

export function useResumoAgendaContatos() {
  const { organizationId, somenteMeus, pronto } = useParametros();
  return useQuery({
    queryKey: [...CHAVE, "resumo", organizationId, somenteMeus],
    enabled: pronto,
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<ResumoAgendaLinha[]> => {
      const { data, error } = await supabase.rpc("get_agenda_contatos_resumo" as never, {
        p_org: organizationId,
        p_somente_meus: somenteMeus,
      } as never);
      if (error) throw error;
      return ((data ?? []) as Array<ResumoAgendaLinha & { total: number | string }>).map((l) => ({
        ...l,
        total: Number(l.total) || 0,
      }));
    },
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CHAVE });
}

/** Marca (ou remarca, se o cliente já tem agenda aberta com o mesmo dono). */
export function useMarcarAgendaContato() {
  const { organizationId } = useOrganization();
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (input: { leadId: string; dia: string; observacao?: string | null; ownerId?: string | null }) => {
      if (!organizationId) throw new Error("Organização não carregada.");
      const { data, error } = await supabase.rpc("agenda_contato_marcar" as never, {
        p_org: organizationId,
        p_lead: input.leadId,
        p_data: input.dia,
        p_observacao: input.observacao ?? null,
        p_owner: input.ownerId ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => void invalidar(),
    onError: (err: Error) => notifyError(err, { fallback: "Não foi possível salvar a agenda." }),
  });
}

/** Desfaz o X. */
export function useReabrirAgendaContato() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("agenda_contato_reabrir" as never, { p_id: id } as never);
      if (error) throw error;
    },
    onSuccess: () => void invalidar(),
    onError: (err: Error) => notifyError(err, { fallback: "Não foi possível desfazer." }),
  });
}

/**
 * O X: a agenda só sai da lista por aqui. Toast com "Desfazer" — um clique
 * errado numa lista de dezenas de clientes não pode custar a agenda.
 */
export function useConcluirAgendaContato() {
  const invalidar = useInvalidar();
  const reabrir = useReabrirAgendaContato();
  return useMutation({
    mutationFn: async (agenda: Pick<AgendaContato, "id" | "lead_name">) => {
      const { error } = await supabase.rpc("agenda_contato_concluir" as never, { p_id: agenda.id } as never);
      if (error) throw error;
      return agenda;
    },
    onSuccess: (agenda) => {
      void invalidar();
      toast(`Agenda de ${agenda.lead_name || "cliente"} fechada`, {
        action: { label: "Desfazer", onClick: () => reabrir.mutate(agenda.id) },
      });
    },
    onError: (err: Error) => {
      void invalidar();
      notifyError(err, { fallback: "Não foi possível fechar a agenda." });
    },
  });
}

export interface ClienteParaAgenda {
  id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  erp_code: string | null;
}

/**
 * Busca de cliente para marcar agenda: nome, empresa, código do ERP ou
 * telefone — a Café acha cliente pelo código. A RLS de `leads` recorta o que a
 * pessoa pode ver; 20 é teto de UI.
 */
export function useBuscaClientesAgenda(termo: string) {
  const { organizationId } = useOrganization();
  const limpo = termoDeBusca(termo);
  const digitos = limpo.replace(/\D/g, "");
  return useQuery({
    queryKey: [...CHAVE, "busca", organizationId, limpo],
    enabled: !!organizationId && limpo.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<ClienteParaAgenda[]> => {
      const filtros = [`name.ilike.%${limpo}%`, `company.ilike.%${limpo}%`, `erp_code.ilike.%${limpo}%`];
      if (digitos.length >= 4) filtros.push(`phone_digits.ilike.%${digitos}%`);
      const { data, error } = await supabase
        .from("leads")
        .select("id, name, company, phone, erp_code")
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .or(filtros.join(","))
        .order("name", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ClienteParaAgenda[];
    },
  });
}
