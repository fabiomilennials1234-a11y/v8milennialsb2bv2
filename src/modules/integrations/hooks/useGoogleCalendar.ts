/**
 * Hook para integração com Google Calendar
 *
 * Utiliza Supabase Edge Functions em vez do microserviço Python (descontinuado).
 *
 * - Status:      query direta ao banco via Supabase client (google_calendar_tokens)
 * - Connect:     Edge Function google-calendar-connect
 * - Disconnect:  Edge Function google-calendar-disconnect
 * - Events:      Edge Function google-calendar-events (Etapa 3)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SUPABASE_FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL as string ?? "").replace(/\/$/, "")}/functions/v1`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectionStatus {
  connected: boolean;
  google_email: string | null;
  connected_at: string | null;
  scopes: string[];
  last_sync: string | null;
  is_active: boolean;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  status: string;
  meet_link: string | null;
  lead_id: string | null;
  origin: "google" | "calcom" | "system";
  html_link: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function edgeFunctionUrl(name: string): string {
  return `${SUPABASE_FUNCTIONS_URL}/${name}`;
}

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

// ─── Status: query direta ao banco ───────────────────────────────────────────

async function fetchConnectionStatus(userId: string): Promise<ConnectionStatus> {
  const { data, error } = await supabase
    .from("google_calendar_tokens")
    .select("google_email, connected_at, scopes_granted, last_sync_at, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!data || !data.is_active) {
    return {
      connected: false,
      google_email: null,
      connected_at: null,
      scopes: [],
      last_sync: null,
      is_active: false,
    };
  }

  return {
    connected: true,
    google_email: data.google_email ?? null,
    connected_at: data.connected_at ?? null,
    scopes: (data.scopes_granted as string[]) ?? [],
    last_sync: data.last_sync_at ?? null,
    is_active: true,
  };
}

// ─── Connect: chama Edge Function e redireciona ao Google ─────────────────────

async function initiateOAuth(accessToken: string): Promise<string> {
  const response = await fetch(edgeFunctionUrl("google-calendar-connect"), {
    method: "GET",
    headers: authHeaders(accessToken),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message ?? "Erro ao iniciar conexão com Google");
  }

  const data = await response.json();
  return data.authorization_url as string;
}

// ─── Disconnect: chama Edge Function ─────────────────────────────────────────

async function revokeConnection(accessToken: string): Promise<void> {
  const response = await fetch(edgeFunctionUrl("google-calendar-disconnect"), {
    method: "POST",
    headers: authHeaders(accessToken),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message ?? "Erro ao desconectar Google Calendar");
  }
}

// ─── Events: chama Edge Function (implementada na Etapa 3) ───────────────────

async function fetchEvents(
  accessToken: string,
  startDate?: Date,
  endDate?: Date
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams();
  if (startDate) params.set("start", startDate.toISOString());
  if (endDate)   params.set("end", endDate.toISOString());

  const response = await fetch(
    `${edgeFunctionUrl("google-calendar-events")}?${params}`,
    { headers: authHeaders(accessToken) }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.message ?? "Erro ao buscar eventos do calendário");
  }

  const data = await response.json();
  return (data.events as CalendarEvent[]) ?? [];
}

// ─── Hooks públicos ───────────────────────────────────────────────────────────

/**
 * Verifica o status da conexão com Google Calendar.
 * Lê diretamente do banco — sem Edge Function, sem microserviço.
 */
export function useGoogleCalendarStatus() {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id;

  return useQuery({
    queryKey: ["google-calendar-status", userId],
    queryFn: () => fetchConnectionStatus(userId!),
    enabled: !!userId && !authLoading,
    staleTime: 30_000,
  });
}

/**
 * Inicia o fluxo OAuth do Google Calendar.
 * Redireciona o usuário para a página de autorização do Google.
 */
export function useConnectGoogleCalendar() {
  const { session } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!session?.access_token) throw new Error("Usuário não autenticado");
      const authUrl = await initiateOAuth(session.access_token);
      window.location.href = authUrl;
    },
    onError: (error: Error) => {
      toast.error("Erro ao conectar", { description: error.message });
    },
  });
}

/**
 * Desconecta o Google Calendar, revogando tokens e limpando dados locais.
 */
export function useDisconnectGoogleCalendar() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!session?.access_token) throw new Error("Usuário não autenticado");
      return revokeConnection(session.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      toast.success("Google Calendar desconectado");
    },
    onError: (error: Error) => {
      toast.error("Erro ao desconectar", { description: error.message });
    },
  });
}

/**
 * Lista eventos do calendário (próprio + calendários compartilhados).
 * Requer que a Edge Function google-calendar-events esteja implantada (Etapa 3).
 */
export function useCalendarEvents(startDate?: Date, endDate?: Date) {
  const { session } = useAuth();
  const accessToken = session?.access_token;

  return useQuery({
    queryKey: ["google-calendar-events", startDate?.toISOString(), endDate?.toISOString()],
    queryFn: () => fetchEvents(accessToken!, startDate, endDate),
    enabled: !!accessToken,
    staleTime: 60_000,
  });
}

/**
 * Processa o retorno do OAuth (query params ?google=connected&email=...).
 * Deve ser chamado na página /configuracoes após o redirect do Google.
 */
export function useGoogleCalendarCallback() {
  const queryClient = useQueryClient();

  const processCallback = (searchParams: URLSearchParams) => {
    const googleStatus = searchParams.get("google");
    const email        = searchParams.get("email");
    const reason       = searchParams.get("reason");

    if (googleStatus === "connected") {
      toast.success("Google Calendar conectado!", {
        description: email ? `Conectado como ${email}` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      return { success: true, email };
    }

    if (googleStatus === "error") {
      const friendlyReason: Record<string, string> = {
        refresh_token_ausente_revogue_e_tente_novamente:
          "Revogue o acesso nas configurações do Google e tente novamente.",
        state_invalido_ou_expirado: "O link expirou. Tente conectar novamente.",
        falha_na_troca_de_tokens:   "Erro ao autenticar com o Google. Tente novamente.",
      };
      toast.error("Erro ao conectar Google Calendar", {
        description: (reason && friendlyReason[reason]) ?? reason ?? "Tente novamente",
      });
      return { success: false, reason };
    }

    return null;
  };

  return { processCallback };
}
