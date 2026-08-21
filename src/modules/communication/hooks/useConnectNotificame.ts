/**
 * useConnectNotificame — conecta um canal OFICIAL pelo Seamless do NotificaMe.
 * Na fatia 1 era só WhatsApp; na 1.1 o MESMO fluxo passa a conectar também o
 * Instagram, porque o popup, a subconta, a sessão e o diff de canais são
 * idênticos — o que muda é uma palavra na querystring (`type`) e o lugar onde a
 * linha nasce do lado de cá.
 *
 * UM TIPO, DUAS PORTAS. O `channelType` não é um detalhe de request: ele decide
 * (a) qual `start_url` abre o popup, (b) qual gate de flag o servidor aplica
 * (`notificame` para WhatsApp, `notificame_instagram` para Instagram — ligar um
 * NÃO liga o outro), (c) qual tabela recebe o canal no finish
 * (`whatsapp_instances` para WhatsApp, `messaging_channels` para Instagram) e
 * (d) qual queryKey é invalidada. Um canal de Instagram NUNCA entra em
 * `whatsapp_instances`: se entrasse, herdaria o rótulo "WhatsApp Oficial", seria
 * candidato a disparo em massa e comeria uma vaga PAGA de número.
 *
 * DEFAULT `"whatsapp"` de propósito: o call site da fatia 1 continua correto sem
 * ter tocado nele, e um clique que não escolheu nada cai no comportamento antigo.
 *
 * MODELO: SUBCONTA POR ORG. Cada org do Torque tem uma subconta própria na
 * revenda do NotificaMe, provisionada pelo servidor sob demanda.
 *
 * ⚠️ O `company_uuid` que viaja na querystring do popup é o TOKEN daquela
 * subconta — credencial, não identificador público — e ele NÃO É ROTACIONÁVEL:
 * o token É o `CompanyId`, é imutável no fornecedor e a subconta é irremovível.
 * Quem enxergar essa URL uma vez (DevTools → Network) fala com o fornecedor em
 * nome da org para sempre, por fora do Torque. Não há revogação; só há não
 * vazar. Por isso o servidor exige ADMIN OU MASTER — não a feature permission
 * `whatsapp.manage_instances`, que nasce liberada para todo membro ativo — antes
 * de devolver a `start_url`. O token da conta-mãe (a revenda inteira, todas as
 * orgs) NUNCA sai do servidor.
 *
 * DUAS PERGUNTAS DISTINTAS, DOIS MODOS — e é aqui que mora a correção desta
 * revisão. Antes, a sonda de MOUNT provisionava: abrir Configurações → WhatsApp
 * criava no fornecedor um objeto IRREMOVÍVEL e FATURÁVEL sem ninguém clicar em
 * nada, e um master passeando pelas orgs criava um em nome de cada uma.
 *   • `mode: "status"` — sonda de mount. LEITURA PURA. Diz se a plataforma está
 *     configurada e devolve a `start_url` SE a org já tiver subconta. Nada nasce.
 *   • `mode: "connect"` — SÓ no clique. Provisiona (idempotente), devolve a
 *     `start_url` e a `session_id` com a baseline de canais.
 *
 * FLUXO (quatro atos):
 *   1. SONDA — `notificame-channel-start` com `mode:"status"`. Responde 200
 *      mesmo sem configuração, justamente para que a UI nasça desabilitada COM
 *      MOTIVO. Um degrau acima do precedente `useConnectWhatsAppCloud`, que só
 *      avisa por toast DEPOIS do clique.
 *   2. POPUP — `window.open` no gesto do usuário, SEMPRE SÍNCRONO e SEM `await`
 *      antes. Qualquer `await` faz Safari e Firefox tratarem a janela como
 *      não-solicitada e bloquearem. Quando a org já tem subconta, a URL veio
 *      pré-carregada pela sonda e a janela já abre nela. Quando ainda NÃO tem, a
 *      janela abre em branco com um aviso de "preparando" e é NAVEGADA quando o
 *      `connect` responde — a janela é aberta no gesto, o destino chega depois.
 *   3. CONNECT — logo DEPOIS do `window.open` (nunca antes), `mode:"connect"`
 *      provisiona se preciso e fotografa os canais que a subconta já tinha. Essa
 *      baseline é o que faz um popup abandonado deixar de travar a org: o canal
 *      órfão está na foto e sai da conta.
 *   4. FINISH — `notificame-channel-finish` descobre QUAL canal nasceu (o
 *      postMessage só diz "channel-success", sem id e sem telefone) fazendo o
 *      diff contra a baseline da sessão, e vincula à org do auth.
 *
 * SEGURANÇA: a validação de origem do postMessage vive em `readSeamlessMessage`
 * (`../lib/notificame-message`), com igualdade estrita e teste próprio. Aqui não
 * há comparação de origem — se houvesse, haveria duas, e uma delas ficaria para
 * trás. O `session_id` trafega SEMPRE pelo nosso canal start→finish e NUNCA pelo
 * payload do terceiro; sozinho ele não autoriza nada, porque org e usuário vêm
 * do auth context no servidor. O `organization_id` viaja no body só para
 * satisfazer `requireOrganization: true`; o servidor CONFIRMA a membresia em
 * `team_members` e nunca confia no que o cliente propôs.
 *
 * ESTADO INERTE: enquanto faltarem os secrets do fornecedor — ou enquanto quem
 * olha a tela não for admin —, `isConfigured` é `false` e `configReason` carrega
 * a frase legível. Nada quebra, nada explode no console.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { readSeamlessMessage, seamlessOriginFromStartUrl } from "../lib/notificame-message";
import { messagingChannelsQueryKey } from "./useMessagingChannels";

/** Geometria do popup do Seamless — cabe o fluxo da Meta sem scroll horizontal. */
const POPUP_FEATURES = "width=680,height=760,menubar=no,toolbar=no,location=no";
const POPUP_NAME = "notificame-seamless";
/** Teto de vida do fluxo. Passou disso, o usuário abandonou a janela aberta. */
const SEAMLESS_TIMEOUT_MS = 5 * 60_000;
/** Cadência do poll de `popup.closed` — não há evento de fechamento cross-origin. */
const POPUP_POLL_MS = 500;
/** `/v1/channels` é eventualmente consistente logo após o canal nascer. */
const FINISH_RETRIES = 3;
const FINISH_RETRY_DELAY_MS = 2_000;

const FALLBACK_REASON = "Canal oficial indisponível no momento";

/**
 * Canais que o Seamless conecta. ALLOWLIST fechada — o servidor tem a sua,
 * idêntica, e é a dele que vale. `facebook` existe no fornecedor e NÃO entra
 * aqui: nenhum caminho desta fatia o liga.
 */
export type SeamlessChannelType = "whatsapp" | "instagram";

/** Rótulo do canal na microcopy. Nunca "WhatsApp" numa frase de Instagram. */
const CHANNEL_LABEL: Record<SeamlessChannelType, string> = {
  whatsapp: "WhatsApp Oficial",
  instagram: "Instagram",
};

/** Nenhuma URL conhecida — org sem subconta, ou sonda que falhou. */
const NO_START_URLS: Readonly<Record<SeamlessChannelType, string | null>> = Object.freeze({
  whatsapp: null,
  instagram: null,
});

/**
 * Janela de espera do popup no primeiro connect da org, antes de ele ser
 * navegado para o fornecedor. `about:blank` herda a NOSSA origem, então este
 * documento é escrito por nós e some no instante em que a navegação ocorre.
 */
const POPUP_WAITING_HTML =
  '<!doctype html><meta charset="utf-8"><title>Preparando conexão</title>' +
  '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
  'background:#0b0b0d;color:#a1a1aa;font:400 14px/1.5 Inter,system-ui,sans-serif">' +
  "<p>Preparando sua conta oficial…</p></body>";

/** Resposta normalizada da sonda `notificame-channel-start` em `mode:"status"`. */
interface StartProbe {
  /** Plataforma configurada E o usuário autorizado. É o que habilita o botão. */
  configured: boolean;
  /**
   * URL do popup POR CANAL, quando a org JÁ tem subconta. `null` com
   * `configured:true` NÃO é indisponibilidade — é "ainda não provisionada" (ou,
   * no caso do Instagram, "flag do canal desligada"), e o clique resolve.
   *
   * O servidor devolve as duas na MESMA ida (`start_urls`); um servidor ainda
   * não atualizado devolve só `start_url`, que é a do WhatsApp — e é por isso
   * que `instagram` NÃO herda o legado: herdar mandaria o usuário para um
   * fluxo de WhatsApp com a palavra "Instagram" no botão.
   */
  startUrls: Record<SeamlessChannelType, string | null>;
  reason: string | null;
  /** Código estável de máquina — vocabulário fechado nosso. */
  code: string | null;
}

/**
 * A URL do popup é do canal que se pediu?
 *
 * É a ÚNICA coisa no browser que distingue um fluxo do outro: o popup devolve
 * `{status:"channel-success"}` idêntico para os dois, sem id e sem tipo. Quem
 * decide o que foi conectado é a URL que abrimos — então ela é conferida, nunca
 * presumida.
 *
 * Ausência de `type` ⇒ WhatsApp: é o que o servidor da fatia 1 emite, e lá o
 * tipo era fixo.
 */
function startUrlMatchesChannel(url: string, channelType: SeamlessChannelType): boolean {
  try {
    return (new URL(url).searchParams.get("type") ?? "whatsapp") === channelType;
  } catch {
    // URL impossível de parsear não é do canal nenhum. Fail-closed.
    return false;
  }
}

/**
 * Lê `start_urls` (servidor novo) com degradação para `start_url` (servidor da
 * fatia 1, ainda em prod enquanto o deploy da 1.1 não sai).
 *
 * Cada URL é conferida contra a chave em que veio. Um servidor que devolvesse a
 * URL de WhatsApp na chave `instagram` mandaria quem clicou "Conectar Instagram"
 * para o fluxo de WhatsApp — e o finish vincularia um NÚMERO. Confiar na chave
 * seria confiar em quem já errou.
 */
function readStartUrls(
  result: { start_url?: unknown; start_urls?: unknown } | null,
): Record<SeamlessChannelType, string | null> {
  const legacy = typeof result?.start_url === "string" ? result.start_url : null;
  const map = (result?.start_urls ?? null) as Record<string, unknown> | null;
  const pick = (key: SeamlessChannelType): string | null => {
    const raw = map && typeof map[key] === "string" ? (map[key] as string) : null;
    return raw && startUrlMatchesChannel(raw, key) ? raw : null;
  };
  return {
    whatsapp: pick("whatsapp") ?? (legacy && startUrlMatchesChannel(legacy, "whatsapp") ? legacy : null),
    // Sem herança do legado — ver o comentário de `startUrls`.
    instagram: pick("instagram"),
  };
}

/**
 * Microcopy por código estável de erro das edge functions. `channelLabel` entra
 * nas frases que nomeiam o canal; o default preserva as frases da fatia 1.
 */
function messageForCode(
  code: string | undefined,
  configReason: string | null,
  channelLabel: string = CHANNEL_LABEL.whatsapp,
): string {
  switch (code) {
    case "ambiguous_channel":
      // Sob subconta por org, ambíguo NÃO é mais "canal sem dono na conta-mãe":
      // é dois canais nascidos depois da foto, ou seja, outra conexão em curso
      // na mesma org. E o cliente não tem painel no fornecedor onde resolver —
      // o token é nosso —, então mandá-lo até lá seria mentira.
      return "Outra conexão está em andamento. Aguarde alguns segundos e tente de novo.";
    case "no_channel_found":
      return "O NotificaMe ainda não registrou o canal. Tente conectar de novo em instantes.";
    case "channel_type_undetermined":
      // Chega aqui SÓ depois das retentativas: o fornecedor listou o canal e
      // seguiu sem dizer de que tipo ele é. O servidor recusa gravar sem tipo
      // confirmado, então o canal EXISTE do lado de lá e não está vinculado —
      // e é isso que a frase precisa dizer. "Tente de novo" sozinho mandaria o
      // usuário repetir um fluxo que já criou o canal, e criaria o segundo.
      return "O canal foi criado, mas não conseguimos identificar o tipo dele. Fale com o suporte para vinculá-lo — não repita a conexão, ela criaria um canal duplicado.";
    case "channel_already_bound":
      return "Esse canal já está vinculado a outra organização.";
    case "quota_exceeded":
      return "Limite de números da organização atingido.";
    case "feature_disabled":
      return `${channelLabel} não habilitado para esta organização.`;
    case "instagram_not_enabled":
      // Flag SEPARADA da do WhatsApp Oficial: ligar o canal oficial de WhatsApp
      // numa org não liga o Instagram dela, e vice-versa. Fail-closed no servidor.
      return "Instagram ainda não está habilitado para esta organização.";
    case "permission_denied":
      // O servidor exige admin ou master. A frase é deliberadamente sobre QUEM
      // pode, não sobre "erro": um membro comum não fez nada errado.
      return `Apenas administradores podem conectar o ${channelLabel}.`;
    case "provisioning_in_progress":
      return "Estamos preparando sua conta oficial. Tente de novo em instantes.";
    case "subaccount_provision_failed":
      return "Não foi possível preparar sua conta oficial. Tente de novo em instantes.";
    case "subaccount_missing":
      return "Sua conta oficial ainda não está pronta. Comece a conexão novamente.";
    case "subaccount_needs_reconciliation":
      // Estado TERMINAL, não transitório. A subconta pode existir no fornecedor
      // sem que a gente tenha o token dela, e só sai disso com conferência humana
      // contra `GET /v1/resale/`. Cair no default aqui — "não foi possível,
      // tente de novo" — convidaria a insistir num estado que nenhum clique
      // resolve. Clicar de novo é seguro (o servidor entra em `adopt_only` e não
      // cria segunda subconta), mas é tempo perdido e ruído no suporte.
      return "Sua conta oficial precisa de uma verificação da nossa equipe. Fale com o suporte — reabrir esta tela não resolve.";
    case "session_invalid":
      return "A sessão de conexão expirou. Comece a conexão novamente.";
    case "origin_not_allowed":
      return "Conexão indisponível a partir deste endereço.";
    case "not_configured":
      return configReason ?? FALLBACK_REASON;
    default:
      return `Não foi possível concluir a conexão do ${channelLabel}.`;
  }
}

/**
 * Motivo do estado INERTE escrito no vocabulário do CANAL pedido.
 *
 * POR QUE ISTO EXISTE. A sonda é UMA só para os dois canais, e quem escreve a
 * frase dela é o SERVIDOR — cujas frases nomeiam o WhatsApp Oficial ("WhatsApp
 * Oficial ainda não está configurado nesta plataforma"), porque foi para ele que
 * a fatia 1 as escreveu. Renderizar essa prosa num card de Instagram é dizer
 * "WhatsApp" numa tela que não fala de WhatsApp — o defeito que esta função
 * remove. A tradução parte do `code`, que é vocabulário FECHADO nosso; a prosa
 * do servidor nunca atravessa de canal.
 *
 * Sem código conhecido, frase neutra: genérica é melhor que errada.
 */
function reasonForChannel(code: string | null, channelType: SeamlessChannelType): string {
  const channelLabel = CHANNEL_LABEL[channelType];
  if (!code) return FALLBACK_REASON;
  // Único código da sonda cuja frase do servidor nomeia um canal. Em
  // `messageForCode` ele resolve ecoando aquela prosa — aqui, não.
  if (code === "not_configured") {
    return `${channelLabel} ainda não está configurado nesta plataforma`;
  }
  // Os demais códigos da sonda (`provisioning_in_progress`,
  // `subaccount_*`, `permission_denied`, `feature_disabled`,
  // `instagram_not_enabled`) já têm frase neutra ou parametrizada pelo rótulo.
  return messageForCode(code, null, channelLabel);
}

/**
 * Desembrulha o corpo de erro de `supabase.functions.invoke`.
 *
 * O supabase-js v2 embrulha qualquer non-2xx numa `FunctionsHttpError` cujo
 * `.message` é sempre a mesma frase genérica; o `{ error, code }` que a edge
 * function escreveu fica em `error.context` (um `Response`) e precisa ser lido.
 */
async function readFnError(error: unknown): Promise<{ code?: string; error?: string }> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== "function") return {};
  try {
    const body = (await ctx.json()) as { code?: unknown; error?: unknown };
    return {
      code: typeof body?.code === "string" ? body.code : undefined,
      error: typeof body?.error === "string" ? body.error : undefined,
    };
  } catch {
    // Corpo não-JSON ou já consumido — o chamador cai na microcopy padrão.
    return {};
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Desfecho normalizado do `mode:"connect"` — o único que provisiona. */
type ConnectOutcome =
  | { ok: true; startUrl: string; sessionId: string | null; adoptChannelId: string | null }
  | { ok: false; code: string | null };

export interface UseConnectNotificameResult {
  /**
   * Abre o popup do Seamless para o canal pedido. SÍNCRONO — precisa rodar no
   * gesto do clique. Sem argumento ⇒ `"whatsapp"`, o comportamento da fatia 1.
   */
  connectNotificame: (channelType?: SeamlessChannelType) => void;
  /** True do `window.open` até o finish resolver (ou o usuário desistir). */
  isConnecting: boolean;
  /** False quando falta secret do fornecedor ou o usuário não é admin — INERTE. */
  isConfigured: boolean;
  /**
   * Motivo legível para a UI mostrar ANTES do clique. `null` quando pronto.
   *
   * ⚠️ É a razão do **WhatsApp Oficial** — a prosa do servidor, preservada byte
   * a byte para o call site da fatia 1. Uma tela de OUTRO canal que renderize
   * isto exibe a palavra "WhatsApp" no card errado. Use `configReasonFor`.
   */
  configReason: string | null;
  /**
   * A razão do CANAL que a tela representa. É o que toda superfície deve ler:
   * `configReasonFor("instagram")` nunca devolve uma frase de WhatsApp, e
   * `configReasonFor("whatsapp")` é idêntico a `configReason`.
   */
  configReasonFor: (channelType?: SeamlessChannelType) => string | null;
  /** True enquanto a sonda de configuração está em voo. */
  isConfigLoading: boolean;
  /**
   * True entre o clique e a resposta do `mode:"connect"` quando a org ainda NÃO
   * tinha subconta — o popup está aberto e em branco enquanto o fornecedor cria
   * a conta. Estado DISTINTO de `isConfigLoading`: a sonda já respondeu, a espera
   * agora é uma ida-e-volta ao fornecedor, e a microcopy da UI muda por isso.
   */
  isProvisioning: boolean;
}

export function useConnectNotificame({ enabled }: { enabled: boolean }): UseConnectNotificameResult {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;
  const [isConnecting, setIsConnecting] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);

  // Um único desarme, guardado em ref e idempotente: listener, poll e timeout
  // são armados juntos e têm que morrer juntos, venha o fim de onde vier.
  const cleanupRef = useRef<(() => void) | null>(null);
  // "Já decidimos o desfecho" — impede que o poll de `popup.closed` grite
  // "cancelado" logo depois de um sucesso (o popup fecha sozinho ao concluir).
  const settledRef = useRef(false);
  /**
   * Origem esperada do `postMessage`, DERIVADA da URL para onde o popup foi.
   * Nunca uma constante: `NOTIFICAME_BASE_URL` é configurável no servidor e
   * `api.` e `hub.` são o mesmo backend, então comparar contra host fixo faria
   * uma troca de base descartar toda mensagem legítima em silêncio — com o canal
   * já nascido, faturável e irremovível do outro lado.
   */
  const expectedOriginRef = useRef<string | null>(null);
  // Promessa da sessão de conexão, aberta DEPOIS do `window.open`. O finish a
  // aguarda; ela nunca rejeita, porque sessão é melhoria de precisão e não
  // pré-requisito — sem ela o servidor degrada para a regra sem baseline.
  const sessionRef = useRef<Promise<string | null> | null>(null);

  const runCleanup = useCallback(() => {
    const fn = cleanupRef.current;
    cleanupRef.current = null;
    fn?.();
  }, []);

  // Desmontar a tela no meio do fluxo não pode deixar listener nem interval vivos.
  useEffect(() => () => runCleanup(), [runCleanup]);

  // ── Sonda de mount — LEITURA PURA ─────────────────────────────────────────
  // `mode:"status"` é o ponto todo desta revisão: montar a tela não pode criar
  // nada no fornecedor. A sonda só reporta estado (configurado / inerte com
  // motivo) e, se a org já tiver subconta, entrega a `start_url` pré-montada —
  // que é o que permite o `window.open` SÍNCRONO no clique.
  //
  // O cache segue travado (`staleTime: Infinity`, sem refetch em mount nem em
  // foco) por outra razão que não o dinheiro: a resposta só muda quando a org
  // provisiona, e esse momento é conhecido — o próprio clique semeia o cache.
  const probe = useQuery({
    queryKey: ["notificame_start_url", organizationId],
    enabled: enabled && !!organizationId,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<StartProbe> => {
      const { data, error } = await supabase.functions.invoke("notificame-channel-start", {
        // O modo é EXPLÍCITO e o servidor faz fallback para `status` em qualquer
        // valor que não seja `connect`. Nenhum caminho de mount provisiona.
        body: { organization_id: organizationId, mode: "status" },
      });

      if (error) {
        // A sonda responde 200 mesmo sem configuração; um non-2xx aqui é a
        // função ausente/negando (ainda não deployada, flag off server-side,
        // usuário não-admin). Degrada para INERTE com motivo — nunca para tela
        // quebrada.
        const body = await readFnError(error);
        return {
          configured: false,
          startUrls: { ...NO_START_URLS },
          // NUNCA ecoar `body.error`. `withErrorBoundary` devolve `error.message`
          // CRU ao cliente, e uma falha ao falar com o fornecedor pode carregar o
          // token da CONTA-MÃE dentro dessa string. `reason` é renderizado em
          // toast e no card, então repetir a mensagem do servidor transforma um
          // vazamento de servidor em vazamento de tela. Só o `code` — que é
          // vocabulário fechado nosso — vira texto para o usuário.
          reason: messageForCode(body.code, null),
          code: body.code ?? null,
        };
      }

      const result = data as
        | {
            configured?: boolean;
            start_url?: string | null;
            start_urls?: Record<string, unknown> | null;
            reason?: string;
            code?: string;
          }
        | null;

      if (result?.configured === true) {
        return {
          configured: true,
          // Ausentes ⇒ org sem subconta ainda. Botão VIVO: o clique provisiona.
          startUrls: readStartUrls(result),
          reason: null,
          code: null,
        };
      }

      return {
        configured: false,
        startUrls: { ...NO_START_URLS },
        reason: result?.reason ?? "NotificaMe ainda não configurado nesta organização",
        code: typeof result?.code === "string" ? result.code : null,
      };
    },
  });

  // A query fica DESABILITADA enquanto o team member não resolve, e uma query
  // desabilitada não é `isLoading` no TanStack v5 — sem somar esse caso, o card
  // piscaria "indisponível" antes de a org sequer ter carregado.
  const isConfigLoading = probe.isLoading || (enabled && !organizationId);

  const isConfigured = probe.data?.configured === true;
  // A prosa do SERVIDOR — e ela fala de WhatsApp Oficial. Fica como está para o
  // call site da fatia 1; qualquer outro canal passa por `configReasonFor`.
  const configReason = isConfigured ? null : probe.data?.reason ?? FALLBACK_REASON;
  // O código é o que viaja entre canais. A frase, não.
  const configCode = probe.data?.code ?? null;
  const startUrls = probe.data?.startUrls ?? NO_START_URLS;

  /**
   * Razão do estado inerte, no vocabulário do canal pedido.
   *
   * O WhatsApp continua recebendo a frase do servidor, intacta: é o call site
   * que já existia, e nada nele mudou. Os demais canais são traduzidos a partir
   * do `code` por `reasonForChannel` — ver o comentário lá em cima sobre por que
   * a prosa do servidor não pode atravessar de canal.
   */
  const configReasonFor = useCallback(
    (channelType: SeamlessChannelType = "whatsapp"): string | null => {
      if (isConfigured) return null;
      if (channelType === "whatsapp") return configReason;
      return reasonForChannel(configCode, channelType);
    },
    [isConfigured, configReason, configCode],
  );

  /**
   * Semeia o cache com a URL recém-provisionada: o próximo clique já abre nela.
   * Escreve SÓ a chave do canal conectado — sobrescrever o mapa inteiro apagaria
   * a URL do outro canal, e o próximo clique nele abriria janela em branco à toa.
   */
  const cacheStartUrl = useCallback(
    (url: string, channelType: SeamlessChannelType) => {
      queryClient.setQueryData<StartProbe>(
        ["notificame_start_url", organizationId],
        (prev): StartProbe => ({
          configured: true,
          startUrls: { ...(prev?.startUrls ?? NO_START_URLS), [channelType]: url },
          reason: null,
          code: null,
        }),
      );
    },
    [queryClient, organizationId],
  );

  // ── Finalização: descobre e vincula o canal, server-side ───────────────────
  const finish = useCallback(
    async (channelType: SeamlessChannelType) => {
      const channelLabel = CHANNEL_LABEL[channelType];
      // A sessão foi aberta lá atrás, em paralelo ao fluxo da Meta. Aqui só se
      // colhe o resultado — e `null` é desfecho válido (caminho degradado, sem
      // baseline), não erro.
      const sessionId = await (sessionRef.current ?? Promise.resolve(null));

      for (let attempt = 0; attempt < FINISH_RETRIES; attempt++) {
        const { data, error } = await supabase.functions.invoke("notificame-channel-finish", {
          body: {
            organization_id: organizationId,
            ...(sessionId ? { session_id: sessionId } : {}),
          },
        });

        if (!error) {
          const result = data as
            | { instance_id?: string; messaging_channel_id?: string; channel_kind?: string }
            | null;
          // `channel_kind` é a palavra do SERVIDOR sobre o que ele acabou de
          // gravar, e ela ganha da nossa: se o finish decidiu diferente, é a
          // decisão dele que está no banco. Ausente ⇒ servidor da fatia 1, que só
          // sabia WhatsApp; aí vale o que pedimos.
          const kind: SeamlessChannelType =
            result?.channel_kind === "instagram" || result?.channel_kind === "whatsapp"
              ? result.channel_kind
              : channelType;
          // Cada canal tem a SUA chave de identidade. Aceitar `instance_id` num
          // desfecho de Instagram seria aceitar que o canal caiu em
          // `whatsapp_instances` — exatamente o que este desenho impede.
          const boundId = kind === "instagram" ? result?.messaging_channel_id : result?.instance_id;
          if (!boundId) {
            toast.error("Resposta inesperada do servidor");
            return;
          }
          await queryClient.invalidateQueries({
            queryKey:
              kind === "instagram"
                ? messagingChannelsQueryKey(organizationId)
                : ["whatsapp_instances", organizationId],
          });
          toast.success(`${CHANNEL_LABEL[kind]} conectado!`);
          return;
        }

        const body = await readFnError(error);
        // `no_channel_found` é consistência eventual do `/v1/channels`: o canal
        // acabou de nascer e a listagem ainda não o enxerga.
        // `channel_type_undetermined` é a MESMA consistência eventual, um passo
        // adiante: o canal já apareceu na listagem, mas ainda sem o `type`. O
        // servidor recusa gravar sem tipo confirmado — ele não escolhe tabela pelo
        // que pedimos no clique —, então a espera é o que resolve. Não retentar
        // aqui transformaria uma janela de segundos em erro terminal na tela,
        // logo depois de o usuário ter concluído o fluxo do fornecedor.
        // `ambiguous_channel` só é retentável QUANDO houve sessão: com a baseline
        // aplicada, dois candidatos significam concorrência real (outro canal
        // nascendo agora), e concorrência real se resolve esperando. Sem sessão,
        // ambíguo é estado parado — retentar seria só repetir o mesmo erro.
        // `channel_type_mismatch` NÃO entra: ali o fornecedor RESPONDEU o tipo, e
        // retentar traria a mesma resposta.
        const retryable =
          body.code === "no_channel_found" ||
          body.code === "channel_type_undetermined" ||
          (body.code === "ambiguous_channel" && !!sessionId);
        if (retryable && attempt < FINISH_RETRIES - 1) {
          await sleep(FINISH_RETRY_DELAY_MS);
          continue;
        }
        // A razão DESTE canal, não a do WhatsApp: `messageForCode` a usa no caso
        // `not_configured`, e ali a frase do servidor nomearia o canal errado.
        toast.error(messageForCode(body.code, configReasonFor(channelType), channelLabel));
        return;
      }
    },
    [organizationId, queryClient, configReasonFor],
  );

  // ── Clique ────────────────────────────────────────────────────────────────
  // NÃO é async, e não há `await` antes do `window.open`: o navegador só libera
  // a janela enquanto o gesto do usuário está vivo na pilha. É por isso que a
  // janela abre EM BRANCO quando a URL ainda não existe, em vez de esperar o
  // provisionamento e abrir depois — esperar seria abrir janela sem gesto, e
  // Safari/Firefox bloqueiam.
  const connectNotificame = useCallback((channelType: SeamlessChannelType = "whatsapp") => {
    const channelLabel = CHANNEL_LABEL[channelType];
    // GLOBAL, não por canal: dois popups simultâneos (um de cada canal) na mesma
    // org fariam a baseline da segunda sessão já conter o canal da primeira, e o
    // pareamento canal↔sessão se perderia.
    if (isConnecting) return;

    if (isConfigLoading) {
      toast.info(`Verificando disponibilidade do ${channelLabel}...`);
      return;
    }
    if (!isConfigured) {
      toast.info(configReasonFor(channelType) ?? FALLBACK_REASON);
      return;
    }
    if (!organizationId) {
      toast.error("Organização não encontrada");
      return;
    }

    // URL DESTE canal. Ausente ⇒ ou a org ainda não tem subconta, ou o servidor
    // ainda é o da fatia 1 (sem `start_urls`) — nos dois casos a janela abre em
    // branco no gesto e é navegada quando o `connect` responder com a URL certa.
    const startUrl = startUrls[channelType];
    const needsProvisioning = !startUrl;
    // Origem esperada do postMessage: DERIVADA da URL para onde o popup realmente
    // foi, nunca de uma constante. `NOTIFICAME_BASE_URL` é configurável e `api.` e
    // `hub.` são o mesmo backend, então uma troca plausível de base faria a
    // igualdade estrita contra um host fixo descartar TODA mensagem legítima — sem
    // erro, sem toast, com o canal já nascido e faturável do outro lado. Fica em
    // ref porque o listener é montado antes de o `connect` responder no primeiro
    // clique da org, quando a URL ainda não existe.
    expectedOriginRef.current = seamlessOriginFromStartUrl(startUrl);
    const popup = window.open(startUrl ?? "about:blank", POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      toast.error(`Permita pop-ups neste site para conectar o ${channelLabel}`);
      return;
    }

    settledRef.current = false;
    setIsConnecting(true);
    setIsProvisioning(needsProvisioning);

    if (needsProvisioning) {
      try {
        // `about:blank` herda a nossa origem — este write é same-origin e some
        // na navegação. Se o navegador recusar, o custo é uma janela em branco.
        popup.document.write(POPUP_WAITING_HTML);
        popup.document.close();
      } catch {
        // Sem placeholder. O fluxo não depende dele.
      }
    }

    /** Encerra o fluxo agora, com motivo. Idempotente via `settledRef`. */
    const settleWith = (message: string) => {
      if (settledRef.current) return;
      settledRef.current = true;
      runCleanup();
      try {
        popup.close();
      } catch {
        // Já fechado — irrelevante para o desfecho.
      }
      toast.error(message);
      setIsConnecting(false);
      setIsProvisioning(false);
    };

    // ── CONNECT, SEMPRE depois do `window.open` ─────────────────────────────
    // Provisiona a subconta (idempotente) e fotografa os canais que ela já
    // tinha; o canal novo será o diff exato contra essa foto.
    //
    // A ordem é o contrato, e ela é observável por `invocationCallOrder`: o
    // `window.open` já retornou quando esta linha roda. Disparar é síncrono de
    // propósito — adiar por timer só abriria janela para o clique ser desfeito
    // antes da foto ser tirada, e a foto tem que ser fresca no clique.
    const connect: Promise<ConnectOutcome> = supabase.functions
      .invoke("notificame-channel-start", {
        // `channel_type` é PROPOSTA do cliente, nunca decisão: o servidor tem a
        // sua allowlist fechada, aplica o gate de flag do canal pedido e é ele
        // quem carimba `requested_channel_type` na sessão.
        body: { organization_id: organizationId, mode: "connect", channel_type: channelType },
      })
      .then(async ({ data, error }): Promise<ConnectOutcome> => {
        if (error) return { ok: false, code: (await readFnError(error)).code ?? null };
        const result = data as
          | {
            configured?: boolean;
            start_url?: unknown;
            session_id?: unknown;
            code?: unknown;
            adopt_channel_id?: unknown;
          }
          | null;
        if (result?.configured !== true || typeof result.start_url !== "string") {
          return { ok: false, code: typeof result?.code === "string" ? result.code : null };
        }
        return {
          ok: true,
          startUrl: result.start_url,
          sessionId: typeof result.session_id === "string" ? result.session_id : null,
          adoptChannelId: typeof result.adopt_channel_id === "string"
            ? result.adopt_channel_id
            : null,
        };
      })
      .catch((): ConnectOutcome => ({ ok: false, code: null }));

    // O finish só quer a sessão — e `null` é desfecho válido: sem baseline o
    // servidor degrada em vez de morrer. Nunca rejeita.
    sessionRef.current = connect.then((r) => (r.ok ? r.sessionId : null));

    void connect.then((r) => {
      setIsProvisioning(false);

      if (!r.ok) {
        // Nada a navegar e nada a conectar. Se a janela já tinha destino (org
        // com subconta), o usuário segue nela: o provisionamento era no-op e a
        // falha foi da foto — o finish degrada sozinho. Só derrubamos o fluxo
        // quando a janela ficaria em branco para sempre.
        if (needsProvisioning) {
          settleWith(messageForCode(r.code ?? undefined, configReasonFor(channelType), channelLabel));
        }
        return;
      }

      // ── ADOÇÃO: o canal JÁ existe na subconta ────────────────────────────
      // Não navegamos o popup, e não é otimização: a subconta com canal já
      // conectado está com a cota gasta, então o Seamless responderia
      // `channel limit exceeded` e a janela morreria sem emitir `postMessage` —
      // o único gatilho do finish. O usuário via "Conexão cancelada" com o canal
      // certo conectado do outro lado, e a mensagem do fornecedor o mandava
      // cobrar um suporte que não tinha culpa.
      //
      // O servidor já tirou este canal (e só ele) da foto, então o finish o
      // enxerga como candidato único e vincula pelo caminho normal.
      if (r.adoptChannelId) {
        settledRef.current = true;
        runCleanup();
        try {
          popup.close();
        } catch {
          // Já fechado ou cross-origin — irrelevante para o desfecho.
        }
        void finish(channelType).finally(() => {
          setIsConnecting(false);
          setIsProvisioning(false);
        });
        return;
      }

      // ── A URL devolvida é DESTE canal? ───────────────────────────────────
      // O servidor da fatia 1 ignora `channel_type` e devolve sempre a URL do
      // WhatsApp. Navegar a janela para ela mandaria quem clicou "Conectar
      // Instagram" para o fluxo de WhatsApp, e o finish vincularia um NÚMERO.
      // Pior que o erro do momento: semear essa URL na chave do Instagram gruda
      // o estado errado no cache, e o clique seguinte abre nela DIRETO, sem
      // sequer passar por aqui.
      //
      // A janela em que isso acontece é real e pode durar horas: front e edge
      // functions sobem em atos separados e manuais (EasyPanel e CLI), em
      // qualquer ordem.
      if (!startUrlMatchesChannel(r.startUrl, channelType)) {
        if (needsProvisioning) {
          settleWith(`Conexão do ${channelLabel} indisponível no momento. Tente de novo em instantes.`);
        }
        // Janela já estava na URL certa (veio do cache, que só guarda URL
        // conferida): o usuário segue nela. Só não semeamos nada.
        return;
      }

      // A URL só existe depois desta resposta na primeira vez da org. Semear o
      // cache aqui é o que faz o SEGUNDO clique abrir direto no fornecedor —
      // inclusive quando este popup foi abandonado no meio.
      cacheStartUrl(r.startUrl, channelType);
      // A janela vai para ESTA url agora, então a origem esperada é a dela.
      expectedOriginRef.current = seamlessOriginFromStartUrl(r.startUrl);

      if (!needsProvisioning || settledRef.current) return;
      try {
        if (!popup.closed) popup.location.href = r.startUrl;
      } catch {
        // Janela fechada entre o teste e a atribuição — o poll de `closed`
        // encerra o fluxo com "conexão cancelada".
      }
    });

    const onMessage = (event: MessageEvent) => {
      // Toda a regra de origem mora em `readSeamlessMessage`. Aqui só o desfecho.
      // Passamos a origem derivada da URL real do popup. `null` é fail-closed no
      // helper: rejeita tudo. Isso é seguro aqui porque a ref é preenchida ANTES
      // de a janela ser navegada — enquanto ela é `null`, o popup ainda está em
      // `about:blank` e não tem como falar em nome do fornecedor.
      const outcome = readSeamlessMessage(event, expectedOriginRef.current);
      if (outcome === "ignore") return;

      settledRef.current = true;
      runCleanup();
      try {
        popup.close();
      } catch {
        // Popup já fechado ou cross-origin — irrelevante para o desfecho.
      }

      if (outcome === "failure") {
        toast.error("Conexão não concluída no NotificaMe");
        setIsConnecting(false);
        setIsProvisioning(false);
        return;
      }

      void finish(channelType).finally(() => {
        setIsConnecting(false);
        setIsProvisioning(false);
      });
    };

    window.addEventListener("message", onMessage);

    // Não existe evento de "popup fechado" entre origens diferentes — poll é a
    // única forma de saber que o usuário desistiu, e sem ele `isConnecting`
    // ficaria preso para sempre com o botão em spinner.
    const pollId = window.setInterval(() => {
      if (!popup.closed || settledRef.current) return;
      settledRef.current = true;
      runCleanup();
      toast.info("Conexão cancelada");
      setIsConnecting(false);
      setIsProvisioning(false);
    }, POPUP_POLL_MS);

    const timeoutId = window.setTimeout(() => {
      if (settledRef.current) return;
      settledRef.current = true;
      runCleanup();
      toast.error(`Tempo esgotado para conectar o ${channelLabel}`);
      setIsConnecting(false);
      setIsProvisioning(false);
    }, SEAMLESS_TIMEOUT_MS);

    cleanupRef.current = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
    };
  }, [
    isConnecting,
    isConfigLoading,
    isConfigured,
    startUrls,
    configReasonFor,
    organizationId,
    cacheStartUrl,
    finish,
    runCleanup,
  ]);

  return {
    connectNotificame,
    isConnecting,
    isConfigured,
    configReason,
    configReasonFor,
    isConfigLoading,
    isProvisioning,
  };
}
