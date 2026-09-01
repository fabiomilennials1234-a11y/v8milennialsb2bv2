/**
 * send-push — leva os Avisos quentes ao bolso de quem está longe do CRM.
 *
 * Quase tudo já existia e estava parado: a tabela de assinaturas com suas
 * políticas, o hook que assina no navegador, e os tratadores de `push` e de
 * `notificationclick` no service worker. Faltava a peça que envia.
 *
 * Quem entra na fila é decidido no banco (fn_avisos_pendentes_de_push), não
 * aqui: a regra de quem recebe é a mesma que decide o que nasce.
 *
 * Duas garantias que esta função precisa dar:
 *   1. não repetir — o Aviso é marcado como enviado na mesma passada;
 *   2. não acumular lixo — assinatura que o provedor recusa (404/410) é
 *      apagada, senão a fila tenta o mesmo aparelho morto para sempre.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireCronAuth } from "../_shared/auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { montarPayload, type AvisoParaPush } from "./payload.ts";

interface Assinatura {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(
  withErrorBoundary("send-push", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (!requireCronAuth(req).authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:suporte@torquecrm.com.br";

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      // Sem chave não há envio possível. Falha alto: silêncio aqui é
      // exatamente o defeito que esta entrega existe para corrigir.
      console.error("[send-push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ausentes");
      return new Response(JSON.stringify({ error: "VAPID keys missing" }), { status: 500, headers });
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: fila, error } = await supabase.rpc("fn_avisos_pendentes_de_push");
    if (error) {
      console.error("[send-push] fila indisponível:", error.message);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    }

    const avisos = (fila ?? []) as AvisoParaPush[];
    if (avisos.length === 0) {
      return new Response(JSON.stringify({ enviados: 0, avisos: 0 }), { status: 200, headers });
    }

    // Uma consulta para todos os aparelhos envolvidos, não uma por Aviso.
    const donos = [...new Set(avisos.map((a) => a.user_id))];
    const { data: assinaturas } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", donos);

    const porDono = new Map<string, Assinatura[]>();
    for (const s of (assinaturas ?? []) as (Assinatura & { user_id: string })[]) {
      const lista = porDono.get(s.user_id) ?? [];
      lista.push({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
      porDono.set(s.user_id, lista);
    }

    const entregues: string[] = [];
    const mortas: string[] = [];

    for (const aviso of avisos) {
      const aparelhos = porDono.get(aviso.user_id) ?? [];
      if (aparelhos.length === 0) continue;

      const corpo = JSON.stringify(montarPayload(aviso));
      let algumEntregue = false;

      for (const aparelho of aparelhos) {
        try {
          await webpush.sendNotification(
            {
              endpoint: aparelho.endpoint,
              keys: { p256dh: aparelho.p256dh, auth: aparelho.auth },
            },
            corpo,
          );
          algumEntregue = true;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // O aparelho não existe mais. Guardá-lo faria a fila bater na
            // mesma porta fechada indefinidamente.
            mortas.push(aparelho.id);
          } else {
            console.error(`[send-push] falha no envio (${status ?? "sem status"})`);
          }
        }
      }

      // Marca-se o Aviso mesmo quando todos os aparelhos falharam por motivo
      // transitório? Não: só quando saiu. Push perdido volta na próxima passada.
      if (algumEntregue) entregues.push(aviso.aviso_id);
    }

    if (mortas.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", mortas);
    }

    if (entregues.length > 0) {
      await supabase.rpc("fn_marcar_push_enviado", { p_aviso_ids: entregues });
    }

    await logRuntime({
      module: "notifications",
      action: "send_push",
      status: "success",
      payloadSnapshot: {
        na_fila: avisos.length,
        entregues: entregues.length,
        assinaturas_removidas: mortas.length,
      },
    });

    return new Response(
      JSON.stringify({ avisos: avisos.length, enviados: entregues.length, removidas: mortas.length }),
      { status: 200, headers },
    );
  }),
);
