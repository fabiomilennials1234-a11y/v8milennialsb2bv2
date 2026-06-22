/**
 * useConnectWhatsAppCloud — launches Meta Embedded Signup to CONNECT a WhatsApp
 * Cloud number (Slice 3, ADR-0009). This is the official-API counterpart to the
 * Uazapi QR flow; the provider chooser routes the "Meta Oficial" card here.
 *
 * SEPARATE from `useMetaConnection` (Messenger/IG redirect OAuth): Embedded
 * Signup is a popup launched by the Facebook JS SDK (`FB.login` with a
 * `config_id`), which returns a short-lived `code` and posts the selected
 * WABA/phone via the window `message` event (sessionInfo). We hand the code + ids
 * to the `meta-embedded-signup-exchange` edge function, which resolves them and
 * provisions the instance server-side (org from the authed context, token stored
 * in the deny-all secrets table).
 *
 * GRACEFUL FALLBACK (current prod state): if VITE_META_WA_CONFIG_ID or
 * VITE_META_APP_ID is missing, we toast "configuração Meta pendente (App Review)"
 * and abort — no crash. This is INERT until Meta approves the app (Tech Provider)
 * and an Embedded Signup config_id exists.
 */

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

const FB_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
const FB_GRAPH_VERSION = "v21.0";

// ── Minimal Facebook JS SDK typings (no @types dependency) ───────────────────
interface FbLoginResponse {
  authResponse?: { code?: string; accessToken?: string } | null;
  status?: string;
}
interface FbSdk {
  init(params: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }): void;
  login(
    cb: (response: FbLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: boolean;
      extras: { feature: string; sessionInfoVersion: string };
    },
  ): void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

/** sessionInfo payload Embedded Signup posts via the window `message` event. */
interface EmbeddedSignupSessionInfo {
  type?: string;
  event?: string;
  data?: { phone_number_id?: string; waba_id?: string };
}

let sdkLoadPromise: Promise<void> | null = null;

/** Loads the Facebook JS SDK once (idempotent across hook instances). */
function loadFacebookSdk(appId: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, version: FB_GRAPH_VERSION, cookie: true, xfbml: false });
      resolve();
    };
    const existing = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
    if (existing) {
      // Script tag present but FB not yet ready — fbAsyncInit will fire.
      return;
    }
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = FB_SDK_SRC;
    script.async = true;
    script.defer = true;
    // NOTE: do NOT set crossOrigin. Facebook's official SDK loader omits it. The
    // connect.facebook.net response does not reliably satisfy a CORS-mode script
    // load in every browser, so crossOrigin="anonymous" made the load fire `error`
    // (→ "Falha ao carregar o SDK do Facebook") even though the script is
    // reachable, CSP-allowed and returns Access-Control-Allow-Origin: *. A plain
    // (no-cors) script tag loads and executes it fine.
    script.onerror = () => reject(new Error("Falha ao carregar o SDK do Facebook"));
    document.body.appendChild(script);
  });
  return sdkLoadPromise;
}

export interface UseConnectWhatsAppCloudResult {
  /** Launches Embedded Signup. No-op (with a toast) when Meta config is absent. */
  connectWhatsAppCloud: () => Promise<void>;
  isConnecting: boolean;
  /** False when VITE_META_APP_ID / VITE_META_WA_CONFIG_ID are missing (INERT). */
  isConfigured: boolean;
}

export function useConnectWhatsAppCloud(): UseConnectWhatsAppCloudResult {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const [isConnecting, setIsConnecting] = useState(false);

  const appId = import.meta.env.VITE_META_APP_ID as string | undefined;
  const configId = import.meta.env.VITE_META_WA_CONFIG_ID as string | undefined;
  const isConfigured = Boolean(appId && configId);

  // Captures the latest sessionInfo (WABA/phone) posted during the popup.
  const sessionInfoRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  const connectWhatsAppCloud = useCallback(async () => {
    // GRACEFUL FALLBACK — current prod state (pre-App-Review).
    if (!isConfigured) {
      toast.info("WhatsApp Oficial: configuração Meta pendente (App Review)");
      return;
    }
    if (!organizationId) {
      toast.error("Organização não encontrada");
      return;
    }

    setIsConnecting(true);
    sessionInfoRef.current = {};

    // Listen for the sessionInfo the Embedded Signup popup posts (WABA + phone).
    const onMessage = (event: MessageEvent) => {
      if (typeof event.origin !== "string" || !event.origin.endsWith("facebook.com")) return;
      let info: EmbeddedSignupSessionInfo | null = null;
      try {
        info = typeof event.data === "string" ? (JSON.parse(event.data) as EmbeddedSignupSessionInfo) : (event.data as EmbeddedSignupSessionInfo);
      } catch {
        return;
      }
      if (info?.type === "WA_EMBEDDED_SIGNUP" && info.data) {
        if (info.data.waba_id) sessionInfoRef.current.wabaId = info.data.waba_id;
        if (info.data.phone_number_id) sessionInfoRef.current.phoneNumberId = info.data.phone_number_id;
      }
    };
    window.addEventListener("message", onMessage);

    try {
      await loadFacebookSdk(appId!);
      if (!window.FB) throw new Error("SDK do Facebook indisponível");

      const response = await new Promise<FbLoginResponse>((resolve) => {
        window.FB!.login(resolve, {
          config_id: configId!,
          response_type: "code",
          override_default_response_type: true,
          extras: { feature: "whatsapp_embedded_signup", sessionInfoVersion: "3" },
        });
      });

      const code = response.authResponse?.code;
      if (!code) {
        // User closed the popup or denied — not an error worth a red toast.
        toast.info("Conexão Meta cancelada");
        return;
      }

      const { data, error } = await supabase.functions.invoke("meta-embedded-signup-exchange", {
        body: {
          code,
          waba_id: sessionInfoRef.current.wabaId ?? null,
          phone_number_id: sessionInfoRef.current.phoneNumberId ?? null,
        },
      });

      if (error) {
        // Surface the edge fn's machine message; functions.invoke wraps non-2xx.
        const msg = (error as { message?: string }).message || "Falha ao conectar WhatsApp Oficial";
        // not_configured is the inert backend state — keep it gentle.
        toast.error(msg);
        return;
      }

      const result = data as { instance_id?: string; status?: string } | null;
      if (!result?.instance_id) {
        toast.error("Resposta inesperada do servidor");
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["whatsapp_instances", organizationId] });
      toast.success("WhatsApp Oficial conectado!");
    } catch (e) {
      toast.error((e as Error).message || "Erro ao conectar WhatsApp Oficial");
    } finally {
      window.removeEventListener("message", onMessage);
      setIsConnecting(false);
    }
  }, [appId, configId, isConfigured, organizationId, queryClient]);

  return { connectWhatsAppCloud, isConnecting, isConfigured };
}
