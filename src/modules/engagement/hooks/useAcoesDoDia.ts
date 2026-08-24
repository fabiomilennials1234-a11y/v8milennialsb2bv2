import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useOrganization } from "@/modules/identity";
import { toast } from "sonner";

export interface AcaoDoDia {
  id: string;
  user_id: string;
  /**
   * Adicionada em `20270825000030`. `null` nas linhas anteriores ao backfill
   * (`scripts/backfill-acoes-do-dia-org.sql`) — essas continuam visíveis só
   * para o dono, porque a policy de admin exige `organization_id IS NOT NULL`.
   */
  organization_id?: string | null;
  title: string;
  description: string | null;
  proposta_id: string | null;
  lead_id: string | null;
  confirmacao_id: string | null;
  follow_up_id: string | null;
  is_completed: boolean;
  position: number;
  created_at: string;
  completed_at: string | null;
  // Joined data
  proposta?: {
    id: string;
    lead?: { name: string; company: string | null; phone: string | null; email: string | null };
    sale_value: number | null;
  } | null;
  lead?: { id: string; name: string; company: string | null; phone: string | null; email: string | null } | null;
  confirmacao?: { id: string; lead?: { name: string; phone: string | null; email: string | null; company: string | null } } | null;
  follow_up?: { id: string; title: string; lead?: { name: string; phone: string | null; email: string | null; company: string | null } } | null;
}

export interface CreateAcaoDoDiaInput {
  title: string;
  description?: string;
  proposta_id?: string;
  lead_id?: string;
  confirmacao_id?: string;
  follow_up_id?: string;
}

/**
 * `"meu"` (default) = só as tarefas de quem está logado — o que este hook
 * sempre fez, e o que o RLS já garantia sozinho.
 *
 * `"tudo"` = as tarefas do time. Só serve para ADMIN: o RLS (policy
 * "Org admins can view team daily actions", migration `20270825000030`) recusa
 * as linhas alheias para qualquer outro. Pedir `"tudo"` sem ser admin não
 * vaza nada — devolve exatamente as suas.
 */
export type AcoesDoDiaEscopo = "meu" | "tudo";

export function useAcoesDoDia(escopo: AcoesDoDiaEscopo = "meu") {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const doTime = escopo === "tudo";

  return useQuery({
    queryKey: ["acoes_do_dia", user?.id, escopo, doTime ? organizationId : null],
    queryFn: async () => {
      if (!user?.id) return [];
      if (doTime && !organizationId) return [];

      // 🔴 O NOME DO FK É OBRIGATÓRIO NOS DOIS PIPES, e a falta dele deixou
      // este hook quebrado para TODOS os consumidores desde sempre.
      //
      // `proposta_id` e `confirmacao_id` apontam ambos para `pipeline_entries`,
      // e `pipe_propostas`/`pipe_confirmacao` são views sobre essa MESMA tabela.
      // Então, para cada embed, o PostgREST enxerga dois caminhos possíveis e
      // se recusa a escolher: devolve HTTP 300 com `PGRST201`
      // ("Could not embed because more than one relationship was found").
      // Não é erro de permissão nem de RLS — a query inteira falha, e a lista
      // nunca chega. Medido contra a branch efêmera em 21/08/2026.
      //
      // Desambiguar com `!<constraint>` resolve. Os nomes vêm do próprio corpo
      // do erro do PostgREST, que lista os candidatos.
      // 🔒 O recorte por ORG é obrigatório no modo "tudo", e não é redundância
      // com o RLS: `is_org_admin()` devolve `true` para o MASTER em QUALQUER
      // org, então sem este `.eq` a tela do master listaria as tarefas de
      // todas as ~30 organizações misturadas. O RLS impede que um vendedor
      // leia o alheio; quem mantém o master dentro de uma org só é este filtro.
      const filtroBase = supabase
        .from("acoes_do_dia")
        .select(`
          *,
          proposta:pipe_propostas!acoes_do_dia_proposta_id_pipeline_entries_fkey(
            id,
            sale_value,
            lead:leads(name, company, phone, email)
          ),
          lead:leads(id, name, company, phone, email),
          confirmacao:pipe_confirmacao!acoes_do_dia_confirmacao_id_pipeline_entries_fkey(
            id,
            lead:leads(name, phone, email, company)
          ),
          follow_up:follow_ups(id, title, lead:leads(name, phone, email, company))
        `);

      const { data, error } = await (
        doTime
          ? filtroBase.eq("organization_id", organizationId as string)
          : filtroBase.eq("user_id", user.id)
      )
        .order("is_completed", { ascending: true })
        .order("position", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as AcaoDoDia[];
    },
    enabled: !!user?.id && (!doTime || !!organizationId),
  });
}

export function useCreateAcaoDoDia() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateAcaoDoDiaInput) => {
      if (!user?.id) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("acoes_do_dia")
        .insert({
          user_id: user.id,
          title: input.title,
          description: input.description || null,
          proposta_id: input.proposta_id || null,
          lead_id: input.lead_id || null,
          confirmacao_id: input.confirmacao_id || null,
          follow_up_id: input.follow_up_id || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      toast.success("Ação adicionada às tarefas do dia!");
    },
    onError: () => {
      toast.error("Erro ao criar ação do dia");
    },
  });
}

export function useCompleteAcaoDoDia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Fetch acao to get follow_up_id and lead_id before completing
      const { data: acao } = await supabase
        .from("acoes_do_dia")
        .select("follow_up_id, lead_id")
        .eq("id", id)
        .single();

      const { error } = await supabase
        .from("acoes_do_dia")
        .update({
          is_completed: true,
          completed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      // Log follow-up completion to lead_history (fire-and-forget)
      if (acao?.follow_up_id && acao?.lead_id) {
        supabase.from("lead_history").insert({
          lead_id: acao.lead_id,
          action: "followup_completed",
          description: "Follow-up concluído via Ações do Dia",
        }).then(() => {}, () => {});
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      toast.success("Tarefa concluída!");
    },
    onError: () => {
      toast.error("Erro ao completar tarefa");
    },
  });
}

export function useUncompleteAcaoDoDia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("acoes_do_dia")
        .update({
          is_completed: false,
          completed_at: null,
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
    },
    onError: () => {
      toast.error("Erro ao desfazer conclusão");
    },
  });
}

export function useDeleteAcaoDoDia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("acoes_do_dia")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      toast.success("Tarefa removida");
    },
    onError: () => {
      toast.error("Erro ao remover tarefa");
    },
  });
}

export function useUpdateAcaoDoDiaPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, position }: { id: string; position: number }) => {
      const { error } = await supabase
        .from("acoes_do_dia")
        .update({ position })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
    },
  });
}
