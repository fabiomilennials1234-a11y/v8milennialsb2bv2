/**
 * Hook para gerenciar conexoes Meta (Facebook/Instagram)
 * OAuth, listagem de paginas, desconexao
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetaConnection {
  id: string;
  organization_id: string;
  user_id: string;
  facebook_user_id: string;
  facebook_user_name: string | null;
  access_token: string;
  token_expires_at: string;
  status: "connected" | "expired" | "disconnected";
  connected_at: string;
  updated_at: string;
}

export interface MetaPage {
  id: string;
  meta_connection_id: string;
  organization_id: string;
  page_id: string;
  page_name: string;
  page_access_token: string;
  instagram_account_id: string | null;
  instagram_username: string | null;
  is_active: boolean;
  webhook_subscribed: boolean;
  created_at: string;
  updated_at: string;
}

export interface MetaConnectionWithPages extends MetaConnection {
  meta_pages: MetaPage[];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista conexoes Meta da organizacao com suas paginas
 */
export function useMetaConnections() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["meta_connections", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];

      console.log("[useMetaConnections] Fetching for org:", organizationId);

      const { data, error } = await (supabase as any)
        .from("meta_connections")
        .select("*, meta_pages(*)")
        .eq("organization_id", organizationId)
        .neq("status", "disconnected")
        .order("connected_at", { ascending: false });

      if (error) {
        console.error("[useMetaConnections] Query error:", error);
        throw error;
      }

      console.log("[useMetaConnections] Result:", data);
      return (data || []) as MetaConnectionWithPages[];
    },
    enabled: !!organizationId,
  });
}

/**
 * Status simplificado: se tem alguma conexao ativa
 */
export function useMetaConnectionStatus() {
  const { data: connections = [], isLoading, error } = useMetaConnections();

  const activeConnection = connections.find((c) => c.status === "connected");
  const expiredConnection = connections.find((c) => c.status === "expired");
  const allPages = connections.flatMap((c) => c.meta_pages || []);
  const activePages = allPages.filter((p) => p.is_active);
  const instagramPages = activePages.filter((p) => p.instagram_account_id);

  return {
    isLoading,
    error,
    isConnected: !!activeConnection,
    isExpired: !activeConnection && !!expiredConnection,
    connection: activeConnection || expiredConnection || null,
    pages: activePages,
    instagramPages,
    totalPages: activePages.length,
    totalInstagram: instagramPages.length,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Inicia o fluxo OAuth do Meta (redireciona para Facebook Login)
 */
export function useConnectMeta() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      if (!user?.id || !organizationId) {
        throw new Error("Usuario ou organizacao nao encontrados");
      }

      const state = btoa(
        JSON.stringify({ userId: user.id, orgId: organizationId })
      );

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const redirectUri = `${supabaseUrl}/functions/v1/meta-oauth-callback`;

      const appId = import.meta.env.VITE_META_APP_ID;
      if (!appId) {
        throw new Error("VITE_META_APP_ID nao configurado");
      }

      const scopes = [
        "pages_manage_metadata",
        "pages_messaging",
        "pages_read_engagement",
        "pages_manage_ads",
        "instagram_manage_messages",
        "instagram_basic",
        "leads_retrieval",
      ].join(",");

      const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        scope: scopes,
        response_type: "code",
        state,
      });

      const loginUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params}`;

      // Redireciona para o Facebook Login
      window.location.href = loginUrl;
    },
  });
}

/**
 * Desconecta uma conexao Meta (soft delete)
 */
export function useDisconnectMeta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      // Marca como desconectado
      const { error } = await (supabase as any)
        .from("meta_connections")
        .update({ status: "disconnected" })
        .eq("id", connectionId);

      if (error) throw error;

      // Desativa todas as paginas
      const { error: pagesError } = await (supabase as any)
        .from("meta_pages")
        .update({ is_active: false, webhook_subscribed: false })
        .eq("meta_connection_id", connectionId);

      if (pagesError) throw pagesError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta_connections"] });
    },
  });
}

/**
 * Ativa/desativa uma pagina individual
 */
export function useToggleMetaPage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pageId,
      isActive,
    }: {
      pageId: string;
      isActive: boolean;
    }) => {
      const { error } = await (supabase as any)
        .from("meta_pages")
        .update({ is_active: isActive })
        .eq("id", pageId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta_connections"] });
    },
  });
}

/**
 * Callback handler: detecta parametros ?meta=... na URL apos OAuth redirect
 */
export function useMetaOAuthCallback() {
  const queryClient = useQueryClient();

  const handleCallback = (searchParams: URLSearchParams) => {
    const metaStatus = searchParams.get("meta");

    if (!metaStatus) return null;

    if (metaStatus === "connected") {
      const pages = searchParams.get("pages") || "0";
      const instagram = searchParams.get("instagram") || "0";
      queryClient.invalidateQueries({ queryKey: ["meta_connections"] });
      return {
        success: true,
        message: `Conectado! ${pages} pagina(s) e ${instagram} conta(s) Instagram.`,
      };
    }

    if (metaStatus === "error") {
      const reason = searchParams.get("reason") || "erro_desconhecido";
      return {
        success: false,
        message: `Erro ao conectar: ${reason.replace(/_/g, " ")}`,
      };
    }

    return null;
  };

  return { handleCallback };
}
