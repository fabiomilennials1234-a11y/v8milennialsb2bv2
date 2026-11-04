import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import {
  resolveStrictInstanceForCaller,
  StrictWriteResolutionError,
} from "../_shared/instance-write-guard.ts";
import {
  sendTextViaInstance,
  sendMediaViaInstance,
  sendAudioViaInstance,
  type SendResultSimple,
} from "../_shared/whatsapp-dispatch.ts";
import { sleepJitter, maxBatchForBudget } from "../_shared/anti-ban-jitter.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// Anti-ban Onda 0 QW3: 3–8s jitter between sends. Batch shrinks to fit the
// budget (worst per item ≈ 8s jitter + ~4s send/notify); overlap with the
// 1-min tick is safe (per-row 'sending' lock), and unfetched rows stay
// 'scheduled' for the next tick (was 20).
const TICK_BUDGET_MS = 120_000;
const WORST_PER_MESSAGE_MS = 12_000;
const BATCH_SIZE = maxBatchForBudget(TICK_BUDGET_MS, WORST_PER_MESSAGE_MS); // = 10

/** Um envio realizado — vira exatamente uma linha em `whatsapp_messages`. */
interface Delivery {
  messageType: string;
  content: string | null;
  mediaUrl: string | null;
  result: SendResultSimple;
}

/**
 * SZ.Chat não é provider WhatsApp: o envio sai por edge function e não devolve
 * id de mensagem. Traduzir a resposta para o mesmo Result dos senders WA deixa
 * o chamador tratar sucesso e falha de um jeito só — antes o retorno era
 * descartado e uma recusa do SZ.Chat virava "enviada".
 */
async function sendTextViaSzChat(
  supabase: any,
  msg: any,
  phoneNumber: string,
): Promise<SendResultSimple> {
  const { data, error } = await supabase.functions.invoke("sz-chat-send", {
    body: {
      action: "send_message",
      organization_id: msg.organization_id,
      phone_number: phoneNumber,
      message: msg.message_content,
    },
  });

  if (error) return { success: false, error: error.message ?? String(error) };
  if (data?.success === false) {
    return { success: false, error: data.error ?? "sz-chat send failed" };
  }
  return { success: true };
}

/**
 * O chat abre pela dupla chip + telefone (mesmo formato do aviso de
 * `lead_message`). Sem chip resolvido ou sem dígitos não há conversa para
 * abrir — nulo, em vez de um link que leva a lugar nenhum.
 */
function linkDaConversa(
  instance: { id?: string | null } | null,
  phoneNumber: string | null | undefined,
): string | null {
  const digitos = (phoneNumber ?? "").replace(/\D/g, "");
  if (!instance?.id || !digitos) return null;
  return `/chat-whatsapp?instance=${encodeURIComponent(instance.id)}&phone=${digitos}`;
}

/** O dia de quem agendou (a Café Jurerê e o resto da base estão em BRT), não o de UTC. */
function diaEmSaoPaulo(agora: Date = new Date()): string {
  return agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Um aviso por cliente e dia (Chamado fb8abe55). A chave só do dia juntava a
 * rajada das 09:00 num cartão ×9 que mostrava o último cliente e o último
 * link — quem agendou perdia de vista quem recebeu. O mesmo cliente duas vezes
 * no dia segue num aviso ×2, e a rajada continua tocando um som só: o front
 * contém o som pela raiz `sched_sent:<dia>` (`chaveDeSom`, em
 * decisao-de-entrega.ts). Sem lead vinculado, o telefone identifica o cliente;
 * sem dígitos, a própria mensagem — a chave nunca fica sem cliente, que é o
 * que juntaria clientes diferentes de novo.
 */
function chaveDoAvisoDeEnvio(
  dia: string,
  msg: { id: string; lead_id?: string | null; phone_number?: string | null },
): string {
  const cliente = msg.lead_id || (msg.phone_number ?? "").replace(/\D/g, "") || msg.id;
  return `sched_sent:${dia}:${cliente}`;
}

/**
 * Emite pelo `fn_emit_aviso` (ADR-0035), o mesmo caminho dos outros avisos:
 * a RPC faz o upsert por (user_id, group_key) enquanto não lido, e é isso que
 * transforma a rajada de uma mesma chave numa linha só. Falha ao avisar não derruba o envio,
 * que já saiu.
 */
async function emitirAviso(supabase: any, params: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc("fn_emit_aviso", params);
  if (error) {
    console.warn("[scheduled-user-messages] aviso falhou:", params.p_type, error.message);
  }
}

/**
 * Tipos de anexo em que o WhatsApp mostra o texto como legenda do próprio anexo.
 * Conferido nos providers: Uazapi manda `text` em /send/media; Meta Cloud só
 * aceita caption em image/video/document (meta-cloud-provider.ts: allowsCaption);
 * Notificame ignora a legenda do áudio (fixa "Áudio"). Áudio não tem legenda —
 * o texto precisa ir como mensagem própria.
 */
const TIPOS_COM_LEGENDA = new Set(["image", "video", "document"]);

/** Folga abaixo do limite de legenda do WhatsApp (1024). */
const LIMITE_LEGENDA = 1000;

/** Mesma regra de filtro do fallback: nunca Meta, nunca número reservado. */
const PROVIDERS_LEGADOS = ["uazapi", "evolution"];
const STATUS_CONECTADO = ["connected", "open"];

/** Quantas mensagens recentes olhar atrás de uma caixa elegível. */
const JANELA_DE_CONVERSA = 30;

/** Quantas agendadas recentes do criador olhar, e até quantos dias atrás. */
const JANELA_DO_CRIADOR = 50;
const DIAS_DO_CRIADOR = 20;

type RegraDaCaixa =
  | "conversa_do_lead"
  | "conversa_do_telefone"
  | "caixa_mais_usada_pelo_criador";

/**
 * Agendada sem caixa escolhida: a resposta certa é a caixa DA CONVERSA do
 * cliente, não a mais antiga da org (a Tatiane agendava e a mensagem saía pelo
 * número da Envase Carolini). Olha a mensagem mais recente do lead e, sem lead
 * ou sem histórico, a do mesmo telefone (últimos 8 dígitos, o padrão do
 * agent-message). Sempre dentro da MESMA org e só entre caixas que o fallback
 * também aceitaria — conectada, uazapi/evolution, não reservada.
 */
async function resolverCaixaDaConversa(
  supabase: any,
  msg: {
    organization_id: string;
    lead_id?: string | null;
    phone_number?: string | null;
    created_by?: string | null;
  },
): Promise<{ instance: any; regra: RegraDaCaixa } | null> {
  /** Das caixas candidatas, as que passam nos filtros do fallback (mesma org). */
  const elegiveisEntre = async (ids: string[]): Promise<any[]> => {
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("organization_id", msg.organization_id)
      .in("id", ids)
      .in("provider", PROVIDERS_LEGADOS)
      .in("status", STATUS_CONECTADO)
      .is("reserved_for", null);
    return data ?? [];
  };

  const buscar = async (
    regra: RegraDaCaixa,
    aplicar: (q: any) => any,
  ): Promise<{ instance: any; regra: RegraDaCaixa } | null> => {
    const { data: recentes } = await aplicar(
      supabase
        .from("whatsapp_messages")
        .select("instance_id")
        .eq("organization_id", msg.organization_id),
    )
      .order("timestamp", { ascending: false })
      .limit(JANELA_DE_CONVERSA);

    const ordem: string[] = [];
    for (const r of recentes ?? []) {
      if (r?.instance_id && !ordem.includes(r.instance_id)) ordem.push(r.instance_id);
    }
    if (ordem.length === 0) return null;

    const elegiveis = await elegiveisEntre(ordem);

    // A mais recente da conversa que passa nos filtros.
    for (const id of ordem) {
      const instance = elegiveis.find((i: any) => i.id === id);
      if (instance) return { instance, regra };
    }
    return null;
  };

  if (msg.lead_id) {
    const porLead = await buscar("conversa_do_lead", (q) => q.eq("lead_id", msg.lead_id));
    if (porLead) return porLead;
  }

  const digitos = (msg.phone_number ?? "").replace(/\D/g, "");
  if (digitos.length >= 8) {
    const porTelefone = await buscar("conversa_do_telefone", (q) =>
      q.ilike("phone_number", `%${digitos.slice(-8)}%`));
    if (porTelefone) return porTelefone;
  }

  // Sem conversa conhecida: a caixa que quem agendou mais usa nas próprias
  // agendadas recentes (a Tatiane não escolhe a Carolini). Empate: a mais recente.
  if (msg.created_by) {
    const desde = new Date(Date.now() - DIAS_DO_CRIADOR * 86_400_000).toISOString();
    const { data: historico } = await supabase
      .from("scheduled_user_messages")
      .select("whatsapp_instance_id")
      .eq("organization_id", msg.organization_id)
      .eq("created_by", msg.created_by)
      .not("whatsapp_instance_id", "is", null)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(JANELA_DO_CRIADOR);

    const uso = new Map<string, number>(); // Map preserva a ordem: mais recente primeiro
    for (const r of historico ?? []) {
      if (r?.whatsapp_instance_id) {
        uso.set(r.whatsapp_instance_id, (uso.get(r.whatsapp_instance_id) ?? 0) + 1);
      }
    }
    if (uso.size > 0) {
      const elegiveis = await elegiveisEntre([...uso.keys()]);
      let melhor: any = null;
      let melhorUso = 0;
      for (const [id, n] of uso) {
        const instance = elegiveis.find((i: any) => i.id === id);
        if (instance && n > melhorUso) {
          melhor = instance;
          melhorUso = n;
        }
      }
      if (melhor) return { instance: melhor, regra: "caixa_mais_usada_pelo_criador" };
    }
  }
  return null;
}

Deno.serve(withErrorBoundary("process-scheduled-user-messages", async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const now = new Date().toISOString();

    const { data: messages, error: fetchError } = await supabase
      .from("scheduled_user_messages")
      .select("*, lead:leads(name)")
      .eq("status", "scheduled")
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchError) {
      console.error("[scheduled-user-messages] Fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!messages?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;
    // Anti-ban jitter (Onda 0 QW3): conta só envios REAIS — lock-miss não
    // dorme, e nunca antes do primeiro.
    let dispatched = 0;

    const runStartedAt = Date.now();

    for (const msg of messages) {
      // Wall-clock guard: jitter can stretch a batch past the 1-min tick; stop
      // early and let the next tick drain the tail (rows stay 'scheduled').
      if (Date.now() - runStartedAt > TICK_BUDGET_MS) break;

      // Per-row lock as a real compare-and-swap: PostgREST returns success
      // even when 0 rows match (another overlapping tick already took it), so
      // the affected row must be checked — not just the error. Lock-miss is
      // NOT a failure: the other tick owns the row.
      const { data: locked, error: lockErr } = await supabase
        .from("scheduled_user_messages")
        .update({ status: "sending" })
        .eq("id", msg.id)
        .eq("status", "scheduled")
        .select("id");

      if (lockErr) { failed++; continue; }
      if (!locked?.length) continue;

      // Fora do try: o aviso de falha definitiva (no catch) aponta para o chip
      // que chegou a ser resolvido, quando houver.
      let instance: any = null;

      try {
        // Resolve instance — may be SZ.Chat (handled separately) or WA provider.
        //
        // Etapa B: quando flag user_write_instance_strict ON e msg.lead_id
        // presente, força resolução pelo vínculo do responsável. SZ.Chat
        // continua sendo decidido após a row ser carregada.
        let isSzChat = false;

        if (msg.lead_id) {
          try {
            const strict = await resolveStrictInstanceForCaller(
              supabase,
              msg.organization_id,
              msg.lead_id,
            );
            if (strict) {
              instance = strict;
              isSzChat = (strict as any).metadata?.provider === "szchat";
            }
          } catch (err) {
            if (err instanceof StrictWriteResolutionError) {
              console.warn(
                "[scheduled-user-messages] strict_write_fallback lead=%s code=%s — using legacy instance resolution",
                msg.lead_id, err.errorCode,
              );
            } else {
              throw err;
            }
          }
        }

        if (!instance && msg.whatsapp_instance_id) {
          const { data: inst } = await supabase
            .from("whatsapp_instances")
            .select("*")
            .eq("id", msg.whatsapp_instance_id)
            .single();
          instance = inst;
          isSzChat = inst?.metadata?.provider === "szchat";
        }

        // Só quando a linha não escolheu caixa (e o strict não decidiu): a
        // caixa da conversa do cliente vence a mais antiga da org.
        let regraDaCaixa: string | null = null;
        if (!instance && !msg.whatsapp_instance_id) {
          const daConversa = await resolverCaixaDaConversa(supabase, msg);
          if (daConversa) {
            instance = daConversa.instance;
            isSzChat = instance?.metadata?.provider === "szchat";
            regraDaCaixa = daConversa.regra;
          }
        }

        if (!instance) {
          const { data: defaultInst } = await supabase
            .from("whatsapp_instances")
            .select("*")
            .eq("organization_id", msg.organization_id)
            // Meta isolation (cert Rule 2): never auto-pick a Meta number for a legacy send.
            .in("provider", PROVIDERS_LEGADOS)
            .in("status", STATUS_CONECTADO)
            // Número reservado (cobrança, ADR-0040) nunca é escolhido por fallback.
            .is("reserved_for", null)
            .limit(1)
            .single();
          instance = defaultInst;
          isSzChat = defaultInst?.metadata?.provider === "szchat";
          if (instance && !msg.whatsapp_instance_id) regraDaCaixa = "fallback_mais_antiga_da_org";
        }

        if (regraDaCaixa) {
          await logRuntime({
            module: "scheduled_user_messages",
            action: "resolve_instance",
            status: "success",
            organizationId: msg.organization_id,
            entityType: "scheduled_user_message",
            entityId: msg.id,
            payloadSnapshot: { regra: regraDaCaixa, instance_id: instance.id, lead_id: msg.lead_id ?? null },
          });
        }

        if (!instance) {
          throw new Error("Nenhuma instancia WhatsApp disponivel");
        }

        const formattedNumber = msg.phone_number.replace(/\D/g, "");

        // Anti-ban jitter (Onda 0 QW3) — espaça envios do mesmo tick. Conteúdo
        // é humano (agendado no chat), mas a ENTREGA é automação em lote: sem
        // espaçamento, 10 mensagens às 09:00 saem coladas do mesmo número.
        if (dispatched > 0) await sleepJitter();
        dispatched++;

        // Cada envio vira uma mensagem no WhatsApp, com o seu id no provider.
        // Coletar os resultados aqui, em vez de descartá-los, é o que permite
        // gravar o que de fato saiu — e só o que saiu.
        const sendOpts = { trackSource: "scheduled-user-message", trackId: msg.id };
        const deliveries: Delivery[] = [];
        const temAnexo = Boolean(msg.media_url && msg.media_type);
        // Anexo com legenda: o texto vai NA legenda e só ela — mandar também o
        // texto solto fazia o cliente receber a mesma frase duas vezes.
        // Legenda do WhatsApp tem limite (~1024 caracteres). Texto maior que isso vai
        // solto e o anexo vai SEM legenda: nunca a mesma frase duas vezes, e nunca um
        // texto cortado ou recusado por caber só como legenda.
        const cabeNaLegenda = (msg.message_content?.length ?? 0) <= LIMITE_LEGENDA;
        const textoVaiNaLegenda = temAnexo && TIPOS_COM_LEGENDA.has(msg.media_type) && cabeNaLegenda;

        if (msg.message_content && !textoVaiNaLegenda) {
          deliveries.push({
            messageType: "text",
            content: msg.message_content,
            mediaUrl: null,
            result: isSzChat
              ? await sendTextViaSzChat(supabase, msg, formattedNumber)
              : await sendTextViaInstance(
                  supabase,
                  instance,
                  formattedNumber,
                  msg.message_content,
                  sendOpts,
                ),
          });
        }

        if (temAnexo) {
          deliveries.push({
            messageType: msg.media_type,
            content: textoVaiNaLegenda ? (msg.message_content || null) : null,
            mediaUrl: msg.media_url,
            result:
              msg.media_type === "audio"
                ? await sendAudioViaInstance(
                    supabase,
                    instance,
                    formattedNumber,
                    msg.media_url,
                    sendOpts,
                  )
                : await sendMediaViaInstance(
                    supabase,
                    instance,
                    formattedNumber,
                    {
                      type: msg.media_type as "image" | "video" | "document",
                      file: msg.media_url,
                      filename: msg.media_filename || undefined,
                      caption: textoVaiNaLegenda ? (msg.message_content || undefined) : undefined,
                    },
                    sendOpts,
                  ),
          });
        }

        // Sem texto e sem mídia não houve envio nenhum: marcar 'sent' registraria
        // uma entrega que nunca existiu.
        if (deliveries.length === 0) {
          throw new Error("Mensagem agendada sem conteúdo para enviar");
        }

        const failures = deliveries.filter((d) => !d.result.success);
        const succeeded = deliveries.filter((d) => d.result.success);
        const failureDetail = failures
          .map((f) => f.result.error ?? "envio falhou")
          .join("; ");

        // Os senders devolvem Result, não exceção. Sem esta checagem a falha
        // (número inválido, provider fora, skip do governor) virava status
        // 'sent' e o vendedor achava que a mensagem tinha saído.
        if (succeeded.length === 0) {
          throw new Error(failureDetail);
        }

        await supabase
          .from("scheduled_user_messages")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            // Parcial (texto saiu, mídia não): reenviar duplicaria o que já
            // chegou, então a falha fica registrada na linha em vez de virar
            // retry.
            ...(failures.length > 0 && { error_message: failureDetail }),
          })
          .eq("id", msg.id);

        for (const delivery of succeeded) {
          await supabase.from("whatsapp_messages").upsert({
            organization_id: msg.organization_id,
            // A instância RESOLVIDA acima, não `msg.whatsapp_instance_id`: a
            // coluna da fila é nula na maioria das linhas (quem agenda pelo chat
            // não escolhe chip), e gravar nulo fazia a mensagem nascer órfã —
            // invisível no chat, que filtra por instance_id, e fora do UNIQUE
            // (message_id, instance_id), que não dedupa contra NULL.
            instance_id: instance.id,
            // O id do provider é o MESMO que volta no eco fromMe, então o eco
            // colide no UNIQUE e não cria uma segunda linha. O sintético só
            // entra quando não há id do provider (SZ.Chat) — determinístico por
            // envio, para um reenvio da mesma linha não duplicar.
            message_id:
              delivery.result.messageId || `sched_${msg.id}_${delivery.messageType}`,
            remote_jid: `${formattedNumber}@s.whatsapp.net`,
            phone_number: msg.phone_number,
            direction: "outgoing",
            message_type: delivery.messageType,
            content: delivery.content,
            media_url: delivery.mediaUrl,
            status: "sent",
            // Explícito, não herdado do DEFAULT: é este par que o
            // trg_human_pause_on_manual_send lê para pausar o copiloto. Aqui
            // pausar é o certo — quem escreveu foi o vendedor —, mas por decisão,
            // não por acidente.
            sent_source: "manual",
            sent_by_ai: false,
            lead_id: msg.lead_id,
            timestamp: new Date().toISOString(),
          }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
        }

        const { data: member } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("id", msg.created_by)
          .single();

        if (member?.user_id) {
          // Um aviso por cliente e dia, cada um com a sua conversa — ver
          // chaveDoAvisoDeEnvio.
          await emitirAviso(supabase, {
            p_organization_id: msg.organization_id,
            p_user_id: member.user_id,
            p_type: "scheduled_message_sent",
            p_group_key: chaveDoAvisoDeEnvio(diaEmSaoPaulo(), msg),
            p_title: "Mensagem agendada enviada",
            p_description: `Mensagem para ${msg.lead?.name || "lead"} enviada com sucesso`,
            p_link: linkDaConversa(instance, msg.phone_number),
            p_lead_id: msg.lead_id,
          });
        }

        sent++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const newRetry = (msg.retry_count || 0) + 1;

        if (newRetry < 3) {
          const retryAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
          await supabase
            .from("scheduled_user_messages")
            .update({ status: "scheduled", retry_count: newRetry, scheduled_at: retryAt })
            .eq("id", msg.id);
        } else {
          await supabase
            .from("scheduled_user_messages")
            .update({ status: "failed", error_message: errorMessage, retry_count: newRetry })
            .eq("id", msg.id);

          const { data: member } = await supabase
            .from("team_members")
            .select("user_id")
            .eq("id", msg.created_by)
            .single();

          if (member?.user_id) {
            // Falha NÃO coalesce: cada mensagem que não saiu pede ação no seu
            // próprio lead, então cada uma é um aviso com a sua conversa.
            await emitirAviso(supabase, {
              p_organization_id: msg.organization_id,
              p_user_id: member.user_id,
              p_type: "scheduled_message_failed",
              p_group_key: `sched_fail:${msg.id}`,
              p_title: "Falha no envio agendado",
              p_description: `Nao foi possivel enviar para ${msg.lead?.name || "lead"}: ${errorMessage}`,
              p_link: linkDaConversa(instance, msg.phone_number),
              p_lead_id: msg.lead_id,
            });
          }
        }

        failed++;
      }
    }

    await logRuntime({
      module: "scheduled_user_messages",
      action: "process_batch",
      status: "success",
      payloadSnapshot: { processed: messages.length, sent, failed },
    });

    return new Response(
      JSON.stringify({ processed: messages.length, sent, failed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[scheduled-user-messages] Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
}));
