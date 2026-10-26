/**
 * Hook para gerenciar conexoes Meta (Facebook/Instagram)
 * OAuth, listagem de paginas, desconexao
 * Suporta conexões separadas para Facebook e Instagram
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import { metaOAuthErrorMessage } from "@/modules/communication/lib/meta-oauth-errors";
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
  token_expires_at: string | null;
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
        .select("id,organization_id,user_id,facebook_user_id,facebook_user_name,token_expires_at,status,connection_type,connected_at,updated_at,meta_pages(id,meta_connection_id,organization_id,page_id,page_name,instagram_account_id,instagram_username,is_active,webhook_subscribed,created_at,updated_at)")
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

      if (!user?.id || !organizationId) {
        throw new Error("Usuario ou organizacao nao encontrados");
      }

      // SECURITY: o `state` é emitido e HMAC-assinado pelo servidor
      // (edge fn meta-oauth-start), com orgId derivado da membership validada.
      // Nunca construir state no cliente — um state não-assinado permitia forjar
      // orgId (tenant-binding forgery no callback que escreve via service_role).
      const { data: stateData, error: stateError } = await supabase.functions.invoke(
        "meta-oauth-start",
        { body: { connectionType: resolvedType, organization_id: organizationId, ...(typeof input === "object" && input.authType === "rerequest" ? { authType: "rerequest" } : {}) } },
      );
      if (stateError || !stateData?.state) {
        throw new Error("Integração Meta indisponível. Tente novamente mais tarde.");
      }
      let loginUrl: URL;
      try { loginUrl = new URL(stateData.loginUrl); } catch { throw new Error("Não foi possível abrir a conexão Meta. Tente novamente."); }
      if (loginUrl.origin !== "https://www.facebook.com" || loginUrl.pathname !== "/v26.0/dialog/oauth") throw new Error("Não foi possível abrir a conexão Meta. Tente novamente.");
      window.location.href = loginUrl.toString();
    },
  });
}

/**
 * Desconecta uma conexao Meta (soft delete)
 */
export function useDisconnectMeta() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      const { error, data } = await supabase.functions.invoke("meta-disconnect", { body: { connectionId, organization_id: organizationId } });
      if (error || data?.error) throw error || new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta_connections"] });
      queryClient.invalidateQueries({ queryKey: ["meta_ad_accounts"] });
      queryClient.invalidateQueries({ queryKey: ["meta_ad_insights"] });
    },
  });
}

/**
 * Ativa/desativa uma pagina individual
 */
export function useToggleMetaPage() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pageId,
      isActive,
    }: {
      pageId: string;
      isActive: boolean;
    }) => {
      const { error, data } = await supabase.functions.invoke("meta-disconnect", { body: { action: "toggle", pageId, isActive, organization_id: organizationId } });
      if (error || data?.error) throw error || new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta_connections"] });
      queryClient.invalidateQueries({ queryKey: ["meta_ad_accounts"] });
      queryClient.invalidateQueries({ queryKey: ["meta_ad_insights"] });
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
      queryClient.invalidateQueries({ queryKey: ["meta_ad_accounts"] });
      queryClient.invalidateQueries({ queryKey: ["meta_ad_insights"] });

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
      return { success: false, message: metaOAuthErrorMessage(reason) };
    }

    return null;
  };

  return { handleCallback };
}
