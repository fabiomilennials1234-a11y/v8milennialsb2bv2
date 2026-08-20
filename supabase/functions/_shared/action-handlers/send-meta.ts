/**
 * send_meta_message / send_semi_automatic action handlers.
 *
 * ═══ A REFORMA DO NÓ DO INSTAGRAM — issue #1691 ═════════════════════════════
 *
 * `send_meta_message` já existia e já endereçava POR LEAD em vez de telefone —
 * que é exatamente o que o Direct exige, já que lá não há telefone. E estava
 * MORTO: 0 nós configurados e 0 execuções em 30 dias, apontando para a rota da
 * Meta direta (`send-meta-message`, Graph API).
 *
 * Morto por um motivo mecânico, não por falta de demanda: o handler mandava
 * `{ organization_id, lead_id, channel, message }` para uma função que exige
 * `recipientId` e um JWT de USUÁRIO. Um executor de workflow não tem usuário. O
 * envio nunca podia ter dado certo.
 *
 * O destino agora é o canal do NotificaMe, o mesmo que o chat usa para
 * responder pelo Direct — e o envelope, o token e a gravação da linha de saída
 * saem todos de `NotificameProvider`, que já os tem. Reimplementá-los aqui
 * criaria uma segunda verdade sobre o formato, livre para divergir.
 *
 * ─── AS TRÊS DECISÕES QUE O REVISOR PRECISA VER SEM ABRIR OUTRO ARQUIVO ─────
 *
 * 1. **SÓ AGE EM CONVERSA VINCULADA.** O vínculo mora em
 *    `lead_social_identities` e é escrito SÓ por RPC SECURITY DEFINER, no
 *    clique de um humano no chat. Sem vínculo o nó NÃO AGE — e isso não é erro:
 *    medido, 562 mensagens de Instagram recebidas em produção e ZERO com lead
 *    vinculado. Falhar aqui pararia a execução de todo lead que também tem
 *    WhatsApp, por causa de uma caixa que ninguém ligou ainda.
 *
 * 2. **SEM GUARDA DE JANELA.** A Meta documenta uma janela para o Direct e ela
 *    nunca foi medida aqui. O nó TENTA enviar; se o fornecedor recusar, o nó
 *    falha e a execução para. Das 1.749 ligações entre nós dos workflows
 *    ativos, ZERO são de saída de erro — então nó que falha derruba a execução,
 *    e esse é o comportamento escolhido, não um efeito colateral.
 *
 * 3. **NÃO GRAVA A LINHA DE SAÍDA.** `NotificameProvider` já persiste em
 *    `channel_messages` com upsert por `(external_id, channel, organization_id)`.
 *    Gravar de novo aqui duplicaria a mensagem na tela do vendedor.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { resolveVariables } from "./whatsapp-helpers.ts";
import { lerEnvioDoNoInstagram } from "../instagram-node.ts";
import {
  resolveSocialSendChannel,
  type SocialChannelRow,
} from "../notificame-social-send.ts";
import { NotificameProvider } from "../whatsapp-providers/notificame-provider.ts";

// ─── Instagram Direct ──────────────────────────────────────────────────────

/** As colunas que o gate puro de canal social lê, mais a subconta esperada. */
const COLUNAS_DO_CANAL =
  "id, organization_id, provider, channel_type, status, external_channel_id, subaccount_id";

type LinhaDeCanal = SocialChannelRow & { id: string; subaccount_id?: string | null };

export async function sendMetaMessage(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId é obrigatório no nó de Instagram", retryable: false };
  }

  // (1) O QUE ENVIAR — puro, sem banco. Documento e figurinha morrem aqui, com
  // o nome pelo qual o gestor os conhece.
  const envio = lerEnvioDoNoInstagram(params);
  if (!envio.ok) {
    return { success: false, error: envio.error, data: { code: envio.code }, retryable: false };
  }

  // (2) PARA QUEM — o vínculo que um humano fez no chat. RESOLVE, JAMAIS CRIA.
  //
  // ⚠️ Não existe unique em `(lead_id, channel_type)`: uma pessoa pode ter duas
  // contas de Instagram. Ordenamos pelo vínculo MAIS RECENTE em vez de deixar o
  // banco escolher — "a última conta que um humano apontou" é uma regra que se
  // pode explicar; "a primeira que o Postgres devolveu" não é regra nenhuma.
  const { data: identidades, error: erroDeIdentidade } = await supabase
    .from("lead_social_identities")
    .select("external_user_id, messaging_channel_id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("channel_type", "instagram")
    .order("linked_at", { ascending: false })
    .limit(1);

  if (erroDeIdentidade) {
    return {
      success: false,
      error: `Não foi possível ler o vínculo de Instagram do lead: ${erroDeIdentidade.message}`,
      retryable: true,
    };
  }

  const identidade = (identidades ?? [])[0] as
    | { external_user_id?: string | null; messaging_channel_id?: string | null }
    | undefined;
  const destinatario = (identidade?.external_user_id ?? "").trim();

  // ⚠️ SEM VÍNCULO, O NÓ NÃO AGE — e devolve SUCESSO, de propósito. A automação
  // do Instagram só vale para conversas que um humano ligou a um lead; um lead
  // que nunca escreveu no Direct simplesmente não tem endereço lá. Tratar isso
  // como falha pararia a execução inteira por causa de um canal que a org talvez
  // nem use, e encheria o histórico de erro sobre um estado que é o esperado.
  if (!destinatario) {
    return {
      success: true,
      message: "Lead sem conversa de Instagram vinculada — nada enviado",
      data: { skipped: true, reason: "lead_sem_instagram_vinculado" },
    };
  }

  // (3) POR QUAL CAIXA. Preferimos o canal em que o vínculo foi observado; ele é
  // `ON DELETE SET NULL`, então pode ter sumido sem o vínculo sumir junto.
  let linha: LinhaDeCanal | null = null;

  if (identidade?.messaging_channel_id) {
    const { data } = await supabase
      .from("messaging_channels")
      .select(COLUNAS_DO_CANAL)
      .eq("id", identidade.messaging_channel_id)
      .maybeSingle();
    linha = (data as LinhaDeCanal | null) ?? null;
  }

  // Sem canal registrado no vínculo — ou com um canal que não serve mais — cai
  // no canal de Instagram conectado da org.
  //
  // ⚠️ E FALHA FECHADO NO EMPATE. Buscamos DOIS de propósito: com mais de um
  // canal conectado não há como saber por qual a conversa correu, e escolher "o
  // primeiro" mandaria a mensagem pela identidade errada da empresa. Mesma forma
  // do desempate do webhook, e mesmo motivo do ADR-0025: a máquina nunca escolhe
  // sozinha.
  if (!linha || linha.status !== "connected") {
    const { data: candidatos } = await supabase
      .from("messaging_channels")
      .select(COLUNAS_DO_CANAL)
      .eq("organization_id", organizationId)
      .eq("provider", "notificame")
      .eq("channel_type", "instagram")
      .eq("status", "connected")
      .limit(2);

    const linhas = (candidatos ?? []) as LinhaDeCanal[];
    if (linhas.length > 1) {
      return {
        success: false,
        error:
          "A organização tem mais de um canal de Instagram conectado e o lead não indica por qual responder",
        data: { code: "instagram_channel_ambiguous" },
        retryable: false,
      };
    }
    linha = linhas[0] ?? linha;
  }

  // O MESMO gate puro que o envio pelo chat usa — inclusive a recusa de canal de
  // outra org, que aqui é ESCRITA: um canal alheio aceito manda mensagem, com a
  // marca do cliente, pela conta de outro tenant.
  const alvo = resolveSocialSendChannel(linha, organizationId);
  if (!alvo.ok) {
    return { success: false, error: alvo.error, data: { code: alvo.code }, retryable: false };
  }

  // (4) AS VARIÁVEIS — a mesma linguagem dos nós de texto do WhatsApp.
  const provider = new NotificameProvider({
    organizationId,
    channelId: alvo.channelId,
    channelKind: "instagram",
    supabaseAdmin: supabase,
    messagingChannelId: linha?.id ?? null,
    expectedSubaccountId: linha?.subaccount_id ?? null,
  });

  try {
    if (envio.kind === "media") {
      const legenda = envio.media.caption
        ? await resolveVariables(supabase, leadId, envio.media.caption, executionContext)
        : "";

      // `number` é o nome histórico do campo (nasceu no WhatsApp); para canal
      // social ele carrega o IGSID, e `normalizeNotificameRecipient` não o
      // deforma — só WhatsApp passa pelo filtro de dígitos.
      const enviada = await provider.sendMedia({
        number: destinatario,
        // `document` e `sticker` são inalcançáveis: `lerEnvioDoNoInstagram` já
        // os recusou. O tipo aqui é image | video | audio.
        type: envio.media.type,
        file: envio.media.file,
        ...(legenda ? { caption: legenda } : {}),
        trackSource: "workflow-instagram",
      });

      return {
        success: true,
        message: `Instagram Direct: ${envio.media.type} enviado`,
        data: { external_id: enviada.message_id, channel: "instagram" },
      };
    }

    const texto = await resolveVariables(supabase, leadId, envio.text, executionContext);
    const enviada = await provider.sendText({
      number: destinatario,
      text: texto,
      trackSource: "workflow-instagram",
    });

    return {
      success: true,
      message: "Instagram Direct: mensagem enviada",
      data: { external_id: enviada.message_id, channel: "instagram" },
    };
  } catch (err) {
    // SEM RETENTATIVA E SEM FALLBACK. A recusa do fornecedor sobe legível — é
    // essa frase que diz ao gestor se a causa foi a janela do Direct, um arquivo
    // que o fornecedor não conseguiu buscar, ou o canal caindo. O nó falha e a
    // execução para, que é a decisão registrada no épico #1684.
    const detalhe = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Instagram Direct recusou o envio: ${detalhe}`,
      retryable: false,
    };
  }
}

// ─── Semi-automatic (approval queue) ───────────────────────────────────────

export async function sendSemiAutomatic(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendSemiAutomatic" };
  }

  const message = (params.semiAutoMessage as string) || "";
  const resolved = await resolveVariables(supabase, leadId, message, executionContext);

  const { error } = await supabase.from("scheduled_pipe_messages").insert({
    lead_id: leadId,
    organization_id: organizationId,
    message_content: resolved,
    status: "waiting_approval",
    approver_id: params.semiAutoApprover || null,
    source: "workflow",
    scheduled_at: new Date().toISOString(),
  });

  if (error) return { success: false, error: error.message };
  return { success: true, message: "Semi-automatic message queued for approval" };
}
