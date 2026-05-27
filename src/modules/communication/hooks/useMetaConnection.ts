/**
 * Hook para gerenciar conexoes Meta (Facebook/Instagram)
 * OAuth, listagem de paginas, desconexao
 * Suporta conexões separadas para Facebook e Instagram
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionType = "facebook" | "instagram";

export interface MetaConnection {
  id: string;
  organization_id: string;
  user_id: string;
  facebook_user_id: string;
  facebook_user_name: string | null;
  access_token: string;
  token_expires_at: string;
  status: "connected" | "expired" | "disconnected";
  connection_type: ConnectionType;
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

      const { data, error } = await (supabase as any)
        .from("meta_connections")
        .select("*, meta_pages(*)")
        .eq("organization_id", organizationId)
        .neq("status", "disconnected")
        .order("connected_at", { ascending: false });

      if (error) throw error;
      return (data || []) as MetaConnectionWithPages[];
    },
    enabled: !!organizationId,
  });
}

/**
 * Status filtrado por tipo de conexão (facebook ou instagram)
 */
export function useMetaConnectionStatusByType(type: ConnectionType) {
  const { data: connections = [], isLoading, error } = useMetaConnections();

  const typeConnections = connections.filter((c) => c.connection_type === type);
  const activeConnection = typeConnections.find((c) => c.status === "connected");
  const expiredConnection = typeConnections.find((c) => c.status === "expired");
  const allPages = typeConnections.flatMap((c) => c.meta_pages || []);
  const activePages = allPages.filter((p) => p.is_active);

  // Para Facebook: mostrar todas as páginas
  // Para Instagram: mostrar apenas páginas que têm conta Instagram
  const filteredPages =
    type === "instagram"
      ? activePages.filter((p) => p.instagram_account_id)
      : activePages;

  return {
    isLoading,
    error,
    isConnected: !!activeConnection,
    isExpired: !activeConnection && !!expiredConnection,
    connection: activeConnection || expiredConnection || null,
    pages: filteredPages,
    totalPages: filteredPages.length,
  };
}

/**
 * Status combinado (compatibilidade com MetaLeadgenConfig e outros)
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
interface ConnectMetaParams {
  connectionType?: ConnectionType;
  authType?: "rerequest";
}

export function useConnectMeta() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: ConnectionType | ConnectMetaParams = "facebook") => {
      const resolvedType: ConnectionType =
        typeof input === "string" ? input : input.connectionType || "facebook";
      const resolvedAuthType =
        typeof input === "object" ? input.authType : undefined;

      if (!user?.id || !organizationId) {
        throw new Error("Usuario ou organizacao nao encontrados");
      }

      const state = btoa(
        JSON.stringify({
          userId: user.id,
          orgId: organizationId,
          connectionType: resolvedType,
        })
      );

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const redirectUri = `${supabaseUrl}/functions/v1/meta-oauth-callback`;

      const appId = import.meta.env.VITE_META_APP_ID;
      if (!appId) {
        throw new Error("VITE_META_APP_ID nao configurado");
      }

      // Escopos baseados no tipo de conexão
      const baseScopes = [
        "pages_manage_metadata",
        "pages_read_engagement",
        "public_profile",
      ];

      const facebookScopes = [
        ...baseScopes,
        "pages_messaging",
        "pages_manage_ads",
        "leads_retrieval",
      ];

      const instagramScopes = [
        ...baseScopes,
        "instagram_manage_messages",
        "instagram_basic",
      ];

      const scopes =
        resolvedType === "instagram"
          ? instagramScopes.join(",")
          : facebookScopes.join(",");

      const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        scope: scopes,
        response_type: "code",
        state,
      });

      if (resolvedAuthType) {
        params.set("auth_type", resolvedAuthType);
      }

      const loginUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
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
      const { error } = await (supabase as any)
        .from("meta_connections")
        .update({ status: "disconnected" })
        .eq("id", connectionId);

      if (error) throw error;

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
      const connectionType = searchParams.get("connectionType") || "facebook";
      queryClient.invalidateQueries({ queryKey: ["meta_connections"] });

      const label = connectionType === "instagram" ? "Instagram" : "Facebook";
      return {
        success: true,
        message:
          connectionType === "instagram"
            ? `${label} conectado! ${instagram} conta(s) Instagram.`
            : `${label} conectado! ${pages} pagina(s).`,
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
