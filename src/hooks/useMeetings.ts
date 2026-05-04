import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
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

      let query = supabase
        .from("meetings" as "leads")
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

      const { data, error } = await supabase
        .from("meetings" as "leads")
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

      const { error } = await supabase
        .from("meetings" as "leads")
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["meeting-participants"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
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
