/**
 * Hook para integração com Google Calendar
 *
 * Gerencia conexão OAuth, status e operações de calendário
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// URL do microserviço de calendário
// Em desenvolvimento, usa proxy do Vite para evitar CORS
// Em produção, usa URL direta configurada no .env
const CALENDAR_SERVICE_URL = import.meta.env.DEV 
  ? "/api/calendar-service"  // Proxy do Vite
  : (import.meta.env.VITE_CALENDAR_SERVICE_URL || "http://localhost:8000");

interface ConnectionStatus {
  connected: boolean;
  google_email: string | null;
  connected_at: string | null;
  scopes: string[];
  last_sync: string | null;
  is_active: boolean;
}

interface AuthorizationUrlResponse {
  authorization_url: string;
  state: string;
}

interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string;
  end: string;
  status: string;
  html_link: string;
}

// Helper para criar headers com token
function createAuthHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

// Função para verificar status da conexão
async function fetchConnectionStatus(
  accessToken: string
): Promise<ConnectionStatus> {
  const headers = createAuthHeaders(accessToken);
  
  console.log("[GoogleCalendar] Fetching status from:", CALENDAR_SERVICE_URL);
  console.log("[GoogleCalendar] Token preview:", accessToken.substring(0, 30) + "...");

  try {
    const response = await fetch(`${CALENDAR_SERVICE_URL}/api/auth/status`, {
      method: "GET",
      headers,
      // Adicionar timeout
      signal: AbortSignal.timeout(10000),
    });

    console.log("[GoogleCalendar] Response status:", response.status);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }
      const text = await response.text();
      console.error("[GoogleCalendar] Error response:", text);
      throw new Error(`Erro ao verificar status: ${text}`);
    }

    const data = await response.json();
    console.log("[GoogleCalendar] Response data:", data);
    return data;
  } catch (error) {
    console.error("[GoogleCalendar] Fetch error:", error);
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error("Não foi possível conectar ao servidor. Verifique se o microserviço está rodando.");
    }
    throw error;
  }
}

// Função para iniciar conexão OAuth
async function initiateOAuth(accessToken: string): Promise<string> {
  const headers = createAuthHeaders(accessToken);

  const response = await fetch(`${CALENDAR_SERVICE_URL}/api/auth/google`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error("Erro ao iniciar conexão com Google");
  }

  const data: AuthorizationUrlResponse = await response.json();
  return data.authorization_url;
}

// Função para revogar conexão
async function revokeConnection(accessToken: string): Promise<void> {
  const headers = createAuthHeaders(accessToken);

  const response = await fetch(`${CALENDAR_SERVICE_URL}/api/auth/revoke`, {
    method: "POST",
    headers,
  });

  if (!response.ok) {
    throw new Error("Erro ao desconectar Google Calendar");
  }
}

// Função para listar eventos
async function fetchEvents(
  accessToken: string,
  startDate?: Date,
  endDate?: Date
): Promise<CalendarEvent[]> {
  const headers = createAuthHeaders(accessToken);

  const params = new URLSearchParams();
  if (startDate) params.append("start", startDate.toISOString());
  if (endDate) params.append("end", endDate.toISOString());

  const response = await fetch(
    `${CALENDAR_SERVICE_URL}/api/calendar/events?${params}`,
    {
      method: "GET",
      headers,
    }
  );

  if (!response.ok) {
    throw new Error("Erro ao buscar eventos do calendário");
  }

  const data = await response.json();
  return data.events;
}

/**
 * Hook para verificar status da conexão com Google Calendar
 * Usa o contexto de auth para garantir que o token está disponível
 */
export function useGoogleCalendarStatus() {
  const { session, loading: authLoading } = useAuth();
  const accessToken = session?.access_token;

  // Debug: verificar se o token existe
  console.log("[GoogleCalendar] Auth state:", {
    hasSession: !!session,
    hasToken: !!accessToken,
    authLoading,
    tokenPreview: accessToken ? accessToken.substring(0, 20) + "..." : null,
  });

  return useQuery({
    queryKey: ["google-calendar-status", accessToken?.substring(0, 10)],
    queryFn: () => fetchConnectionStatus(accessToken!),
    enabled: !!accessToken && !authLoading,
    staleTime: 0, // Sempre buscar do servidor durante debug
    gcTime: 0, // Não cachear durante debug
    retry: 2,
    retryDelay: 1000,
  });
}

/**
 * Hook para conectar Google Calendar
 */
export function useConnectGoogleCalendar() {
  const { session } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!session?.access_token) {
        throw new Error("Usuário não autenticado");
      }
      const authUrl = await initiateOAuth(session.access_token);
      window.location.href = authUrl;
    },
    onError: (error: Error) => {
      toast.error("Erro ao conectar", {
        description: error.message,
      });
    },
  });
}

/**
 * Hook para desconectar Google Calendar
 */
export function useDisconnectGoogleCalendar() {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!session?.access_token) {
        throw new Error("Usuário não autenticado");
      }
      return revokeConnection(session.access_token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      toast.success("Google Calendar desconectado");
    },
    onError: (error: Error) => {
      toast.error("Erro ao desconectar", {
        description: error.message,
      });
    },
  });
}

/**
 * Hook para listar eventos do calendário
 */
export function useCalendarEvents(startDate?: Date, endDate?: Date) {
  const { session } = useAuth();
  const accessToken = session?.access_token;

  return useQuery({
    queryKey: ["google-calendar-events", startDate, endDate],
    queryFn: () => fetchEvents(accessToken!, startDate, endDate),
    enabled: false,
  });
}

/**
 * Hook para processar callback do OAuth
 */
export function useGoogleCalendarCallback() {
  const queryClient = useQueryClient();

  const processCallback = (searchParams: URLSearchParams) => {
    const googleStatus = searchParams.get("google");
    const email = searchParams.get("email");
    const reason = searchParams.get("reason");

    if (googleStatus === "connected") {
      toast.success("Google Calendar conectado!", {
        description: email ? `Conectado como ${email}` : undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-status"] });
      return { success: true, email };
    }

    if (googleStatus === "error") {
      toast.error("Erro ao conectar Google Calendar", {
        description: reason || "Tente novamente",
      });
      return { success: false, reason };
    }

    return null;
  };

  return { processCallback };
}
