import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────────────────────────
// Inline types matching the migration schema.
// meetings table is brand new and supabase types haven't been regenerated yet.

export type MeetingEventType = "meeting" | "call" | "follow_up" | "task" | "other";
export type MeetingStatus = "scheduled" | "completed" | "cancelled" | "no_show";
export type ParticipantStatus = "accepted" | "declined" | "tentative" | "pending";

export interface Meeting {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  event_type: MeetingEventType;
  status: MeetingStatus;
  lead_id: string | null;
  /**
   * Funil de onde o lead foi escolhido. FK -> `pipelines(id)` — a UNIÃO
   * system+custom —, `ON DELETE SET NULL`.
   *
   * Persistido em vez de derivado do lead porque um lead está em VÁRIOS funis
   * ao mesmo tempo (invariante do produto) e sair de um funil é DELETE físico:
   * derivar devolveria um funil qualquer hoje e outro amanhã, mudando dado
   * histórico em silêncio.
   */
  pipeline_id: string | null;
  /**
   * O NEGÓCIO da reunião. FK -> `deals(id)`, `ON DELETE SET NULL`.
   *
   * A coluna existe desde `20270907000010` e nasceu MORTA: só o backfill do S3
   * a preencheu (642 linhas no mesmo instante) e nada no app a escrevia. O S6 a
   * liga, porque é ela que o espelho `meetings → pipeline_entries.metadata`
   * usa para achar a entrada de destino — `uq_pipeline_entries_deal_id` torna
   * negócio ↔ entrada 1:1.
   *
   * 🚨 Precisa estar NESTE tipo, e não só no banco: `select("*")` já traz a
   * coluna em runtime, e o tipo escondê-la é o que faria o diálogo de edição
   * "esquecer" de semeá-la e apagar o vínculo no primeiro Salvar.
   */
  deal_id: string | null;
  created_by: string;
  google_event_id: string | null;
  meet_link: string | null;
  color: string | null;
  recurrence_rule: string | null;
  external_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  lead?: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
  };
}

export interface MeetingParticipant {
  id: string;
  meeting_id: string;
  team_member_id: string;
  status: ParticipantStatus;
  created_at: string;
  team_member?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface MeetingFilters {
  startDate?: string;
  endDate?: string;
  leadId?: string;
  createdBy?: string;
  status?: MeetingStatus;
}

export interface CreateMeetingInput {
  title: string;
  description?: string | null;
  location?: string | null;
  start_at: string;
  end_at: string;
  all_day?: boolean;
  event_type?: MeetingEventType;
  status?: MeetingStatus;
  lead_id?: string | null;
  /** Funil de onde o lead veio. Ver o campo homônimo em `Meeting`. */
  pipeline_id?: string | null;
  /**
   * Negócio da reunião — ver o campo homônimo em `Meeting`. Só é gravado
   * quando há lead E funil: o negócio é a ENTRADA do lead naquele funil, então
   * sem os dois ele não tem do que ser derivado nem o que significar.
   */
  deal_id?: string | null;
  google_event_id?: string | null;
  meet_link?: string | null;
  color?: string | null;
  recurrence_rule?: string | null;
  external_ref?: string | null;
  notes?: string | null;
  participant_ids?: string[];
}

export interface UpdateMeetingInput {
  id: string;
  title?: string;
  description?: string | null;
  location?: string | null;
  start_at?: string;
  end_at?: string;
  all_day?: boolean;
  event_type?: MeetingEventType;
  status?: MeetingStatus;
  lead_id?: string | null;
  /** Funil de onde o lead veio. Ver o campo homônimo em `Meeting`. */
  pipeline_id?: string | null;
  /**
   * 🚨 `useUpdateMeeting` faz `.update(updates)` CRU, sem merge. Mandar este
   * campo `undefined` preserva o vínculo; mandar `null` o APAGA. Quem edita
   * precisa SEMEAR o valor atual antes de salvar — ver `EditMeetingDialog`.
   */
  deal_id?: string | null;
  google_event_id?: string | null;
  meet_link?: string | null;
  color?: string | null;
  recurrence_rule?: string | null;
  external_ref?: string | null;
  notes?: string | null;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** List meetings for the current org, with optional filters and realtime subscription */
export function useMeetings(filters?: MeetingFilters) {
  const { organizationId, isReady } = useOrganization();

  useRealtimeSubscription("meetings", ["meetings"]);

  return useQuery({
    queryKey: ["meetings", organizationId, filters],
    queryFn: async () => {
      if (!organizationId) return [];

      // `meetings` is spoofed as "leads" to satisfy the table-name union; the
      // embedded `lead:leads(...)` select plus the chained conditional filter
      // reassignments make PostgREST's result-type parser explode (TS2589).
      // The `from` result is typed loosely *before* `.select(...)` so the deep
      // result-type parser never runs; the row shape is recovered via the
      // explicit `as unknown as Meeting[]` cast below.
      type LooseFilterBuilder = {
        eq: (column: string, value: unknown) => LooseFilterBuilder;
        gte: (column: string, value: unknown) => LooseFilterBuilder;
        lte: (column: string, value: unknown) => LooseFilterBuilder;
        order: (column: string, options: { ascending: boolean }) => LooseFilterBuilder;
        then: PromiseLike<{ data: unknown; error: unknown }>["then"];
      };
      type LooseFrom = { select: (columns: string) => LooseFilterBuilder };

      let query = (supabase.from("meetings" as "leads") as unknown as LooseFrom)
        .select(`
          *,
          lead:leads(id, name, company, phone, email)
        `)
        .eq("organization_id", organizationId)
        .order("start_at", { ascending: true });

      if (filters?.startDate) {
        query = query.gte("start_at", filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte("start_at", filters.endDate);
      }
      if (filters?.leadId) {
        query = query.eq("lead_id", filters.leadId);
      }
      if (filters?.createdBy) {
        query = query.eq("created_by", filters.createdBy);
      }
      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as Meeting[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 30_000,
  });
}

/** Single meeting by ID with participants join */
export function useMeeting(id: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["meetings", "detail", id, organizationId],
    queryFn: async () => {
      if (!organizationId || !id) return null;

      // Loosely-typed builder before `.select(...)` to avoid PostgREST's deep
      // result-type instantiation (TS2589); row shape recovered via cast below.
      type LooseFilterBuilder = {
        eq: (column: string, value: unknown) => LooseFilterBuilder;
        single: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
      type LooseFrom = { select: (columns: string) => LooseFilterBuilder };

      const { data, error } = await (supabase.from("meetings" as "leads") as unknown as LooseFrom)
        .select(`
          *,
          lead:leads(id, name, company, phone, email)
        `)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .single();

      if (error) throw error;
      return data as unknown as Meeting;
    },
    enabled: isReady && !!organizationId && !!id,
    staleTime: 30_000,
  });
}

/** Participants for a specific meeting */
export function useMeetingParticipants(meetingId: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["meeting-participants", meetingId, organizationId],
    queryFn: async () => {
      if (!organizationId || !meetingId) return [];

      const { data, error } = await supabase
        .from("meeting_participants" as "leads")
        .select(`
          *,
          team_member:team_members(id, name, role)
        `)
        .eq("meeting_id", meetingId);

      if (error) throw error;
      return data as unknown as MeetingParticipant[];
    },
    enabled: isReady && !!organizationId && !!meetingId,
    staleTime: 30_000,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────

/**
 * As telas do FUNIL que a reunião passa a mexer sem tocar nelas — S6.
 *
 * A partir do espelho `trg_meeting_espelha_no_funil`, gravar uma reunião com
 * `deal_id` reescreve `pipeline_entries.metadata.meeting_date` da entrada
 * daquele negócio. Ou seja: um INSERT em `meetings` muda o card do Kanban e o
 * card do Negócio, que leem a projeção — e nenhum deles é notificado.
 *
 * `pipeline_entries` tem realtime, mas o debounce é de 2s e a Agenda pode estar
 * numa aba onde o board nem está montado; quando a pessoa volta, o dado velho
 * ainda está no cache. Invalidando aqui a mudança chega junto com o toast, que
 * é quando a pessoa está olhando.
 *
 * As chaves são as MESMAS que `useSetMeetingDate` (o escritor do lado funil) já
 * invalida, mais as duas do card do Negócio — o espelho e ele escrevem o mesmo
 * campo, então divergir aqui faria a data aparecer numa tela e não na outra.
 */
const CHAVES_DO_FUNIL = [
  ["pipeline-page"],
  ["pipeline-stage-counts"],
  ["deal-card-extras"],
  ["leads-deals"],
] as const;

function invalidarFunil(queryClient: ReturnType<typeof useQueryClient>) {
  for (const queryKey of CHAVES_DO_FUNIL) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/** Create a meeting with optional participant IDs */
export function useCreateMeeting() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateMeetingInput) => {
      if (!organizationId) throw new Error("Organização não disponível");
      if (!user?.id) throw new Error("Usuário não autenticado");

      const { participant_ids, ...meetingData } = input;

      const { data: meeting, error: meetingError } = await supabase
        .from("meetings" as "leads")
        .insert({
          ...meetingData,
          organization_id: organizationId,
          created_by: user.id,
          all_day: meetingData.all_day ?? false,
          event_type: meetingData.event_type ?? "meeting",
          status: meetingData.status ?? "scheduled",
        } as any)
        .select()
        .single();

      if (meetingError) throw meetingError;

      const created = meeting as unknown as Meeting;

      // Insert participants if provided
      if (participant_ids && participant_ids.length > 0) {
        const participants = participant_ids.map((teamMemberId) => ({
          meeting_id: created.id,
          team_member_id: teamMemberId,
          status: "pending" as ParticipantStatus,
        }));

        const { error: participantsError } = await supabase
          .from("meeting_participants" as "leads")
          .insert(participants as any);

        if (participantsError) throw participantsError;
      }

      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
      // Criar reunião na Agenda passa a contar como REUNIÃO MARCADA — o
      // trigger grava o `meeting_booked`. Mesma razão do update acima.
      queryClient.invalidateQueries({ queryKey: ["meeting_events"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      // Com `deal_id`, o espelho já reescreveu a projeção do funil. Ver
      // `CHAVES_DO_FUNIL`.
      invalidarFunil(queryClient);
      toast.success("Reunião criada com sucesso");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao criar reunião");
    },
  });
}

/** Update a meeting by ID */
export function useUpdateMeeting() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: UpdateMeetingInput) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data, error } = await supabase
        .from("meetings" as "leads")
        .update(updates as any)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as Meeting;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
      // A partir de `20270907000030` esta linha ESCREVE em `meeting_events`
      // por trigger, e é de lá que a métrica lê. Sem estas duas invalidações o
      // número existiria no banco e não na tela: `useSDRPerformance` só
      // recarrega a cada 60s (`refetchInterval`) e o Comando espera o realtime
      // de `pipeline_entries`, que este caminho não toca. O vendedor marcaria
      // "compareceu" e veria o painel parado.
      queryClient.invalidateQueries({ queryKey: ["meeting_events"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      // Remarcar, trocar de negócio ou cancelar reescreve (ou limpa) a projeção
      // do funil pelo espelho. Ver `CHAVES_DO_FUNIL`.
      invalidarFunil(queryClient);
      toast.success("Reunião atualizada");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao atualizar reunião");
    },
  });
}

/** Delete a meeting by ID */
export function useDeleteMeeting() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error("Organização não disponível");

      // 🚨 `count: "exact"` é load-bearing, não telemetria.
      //
      // Um DELETE que não casa NENHUMA linha — id de outra org, linha já
      // apagada em outra aba, RLS negando — responde 204 com `error: null`,
      // exatamente igual a um que apagou. Sem contar as linhas, o `onSuccess`
      // canta "Reunião excluída" e o refetch traz o compromisso de volta: a
      // tela mente sobre o que está gravado.
      //
      // O vizinho `useUpdateMeeting` já não tinha esse buraco porque usa
      // `.select().single()`, e 0 linhas ali estoura `PGRST116`. Aqui a mesma
      // garantia custa um `count`.
      const { error, count } = await supabase
        .from("meetings" as "leads")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("organization_id", organizationId);

      if (error) throw error;
      if (!count) {
        throw new Error(
          "Nada foi excluído — a reunião já não existe ou você não tem permissão para removê-la.",
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["meeting-participants"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
      // Apagar desfaz os `meeting_events` que a agenda escreveu
      // (`trg_meeting_delete_cleans_events`), então a métrica muda aqui também.
      queryClient.invalidateQueries({ queryKey: ["meeting_events"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      // Apagar limpa a projeção da entrada carimbada por esta reunião. Ver
      // `CHAVES_DO_FUNIL`.
      invalidarFunil(queryClient);
      toast.success("Reunião excluída");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao excluir reunião");
    },
  });
}

/** Update a participant's RSVP status */
export function useUpdateParticipantStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      participantId,
      status,
    }: {
      participantId: string;
      status: ParticipantStatus;
    }) => {
      const { data, error } = await supabase
        .from("meeting_participants" as "leads")
        .update({ status } as any)
        .eq("id", participantId)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as MeetingParticipant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meeting-participants"] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Status de participação atualizado");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao atualizar participação");
    },
  });
}
