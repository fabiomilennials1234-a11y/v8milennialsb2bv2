/**
 * Hook para gerenciar compartilhamento de Google Calendar entre membros da equipe
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/modules/identity";
import { toast } from "sonner";

const SUPABASE_FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string ?? "").replace(/\/$/, "")}/functions/v1`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeamMember {
  user_id: string;
  name: string;
  email: string;
  role: string;
}

export interface OutgoingShare {
  viewer_id: string;
  can_create_events: boolean;
  created_at: string;
  viewer: TeamMember | null;
}

export interface IncomingShare {
  owner_id: string;
  can_create_events: boolean;
  created_at: string;
  owner: TeamMember | null;
}

export interface SharingData {
  outgoing: OutgoingShare[];
  incoming: IncomingShare[];
  available_members: TeamMember[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sharingUrl(): string {
  return `${SUPABASE_FUNCTIONS_URL}/google-calendar-sharing`;
}

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function handleResponse(res: Response): Promise<unknown> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? "Erro na operação");
  }
  return res.json();
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useCalendarSharing() {
  const { session } = useAuth();
  const accessToken = session?.access_token;

  return useQuery({
    queryKey: ["calendar-sharing", session?.user?.id],
    queryFn: async (): Promise<SharingData> => {
      const res = await fetch(sharingUrl(), {
        headers: authHeaders(accessToken!),
      });
      return handleResponse(res) as Promise<SharingData>;
    },
    enabled: !!accessToken,
    staleTime: 30_000,
  });
}

export function useShareCalendar() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      viewerId,
      canCreateEvents,
    }: {
      viewerId: string;
      canCreateEvents: boolean;
    }) => {
      if (!session?.access_token) throw new Error("Não autenticado");
      const res = await fetch(sharingUrl(), {
        method: "POST",
        headers: authHeaders(session.access_token),
        body: JSON.stringify({
          viewer_id:         viewerId,
          can_create_events: canCreateEvents,
        }),
      });
      return handleResponse(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-sharing"] });
      toast.success("Calendário compartilhado com sucesso");
    },
    onError: (err: Error) => {
      toast.error("Erro ao compartilhar", { description: err.message });
    },
  });
}

export function useUpdateCalendarShare() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      viewerId,
      canCreateEvents,
    }: {
      viewerId: string;
      canCreateEvents: boolean;
    }) => {
      if (!session?.access_token) throw new Error("Não autenticado");
      const res = await fetch(sharingUrl(), {
        method: "PATCH",
        headers: authHeaders(session.access_token),
        body: JSON.stringify({
          viewer_id:         viewerId,
          can_create_events: canCreateEvents,
        }),
      });
      return handleResponse(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-sharing"] });
      toast.success("Permissão atualizada");
    },
    onError: (err: Error) => {
      toast.error("Erro ao atualizar permissão", { description: err.message });
    },
  });
}

export function useRevokeCalendarShare() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (viewerId: string) => {
      if (!session?.access_token) throw new Error("Não autenticado");
      const res = await fetch(`${sharingUrl()}?viewer_id=${viewerId}`, {
        method: "DELETE",
        headers: authHeaders(session.access_token),
      });
      return handleResponse(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-sharing"] });
      toast.success("Acesso revogado");
    },
    onError: (err: Error) => {
      toast.error("Erro ao revogar acesso", { description: err.message });
    },
  });
}
