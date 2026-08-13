/**
 * useConnectNotificame — conecta um número WhatsApp OFICIAL pelo Seamless do
 * NotificaMe (fatia 1). É a terceira porta de entrada da superfície de conexões,
 * ao lado do QR da Uazapi e do Embedded Signup da Meta.
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

const FALLBACK_REASON = "WhatsApp Oficial indisponível no momento";

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
   * URL do popup, quando a org JÁ tem subconta. `null` com `configured:true` NÃO
   * é indisponibilidade — é "ainda não provisionada", e o clique resolve.
   */
  startUrl: string | null;
  reason: string | null;
  /** Código estável de máquina — vocabulário fechado nosso. */
  code: string | null;
}

/** Microcopy por código estável de erro das edge functions. */
function messageForCode(code: string | undefined, configReason: string | null): string {
  switch (code) {
    case "ambiguous_channel":
      // Sob subconta por org, ambíguo NÃO é mais "canal sem dono na conta-mãe":
      // é dois canais nascidos depois da foto, ou seja, outra conexão em curso
      // na mesma org. E o cliente não tem painel no fornecedor onde resolver —
      // o token é nosso —, então mandá-lo até lá seria mentira.
      return "Outra conexão está em andamento. Aguarde alguns segundos e tente de novo.";
    case "no_channel_found":
      return "O NotificaMe ainda não registrou o canal. Tente conectar de novo em instantes.";
    case "channel_already_bound":
      return "Esse canal já está vinculado a outra organização.";
    case "quota_exceeded":
      return "Limite de números da organização atingido.";
    case "feature_disabled":
      return "WhatsApp Oficial não habilitado para esta organização.";
    case "permission_denied":
      // O servidor exige admin ou master. A frase é deliberadamente sobre QUEM
      // pode, não sobre "erro": um membro comum não fez nada errado.
      return "Apenas administradores podem conectar o WhatsApp Oficial.";
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
      return "Não foi possível concluir a conexão do WhatsApp Oficial.";
  }
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
  | { ok: true; startUrl: string; sessionId: string | null }
  | { ok: false; code: string | null };

export interface UseConnectNotificameResult {
  /** Abre o popup do Seamless. SÍNCRONO — precisa rodar no gesto do clique. */
  connectNotificame: () => void;
  /** True do `window.open` até o finish resolver (ou o usuário desistir). */
  isConnecting: boolean;
  /** False quando falta secret do fornecedor ou o usuário não é admin — INERTE. */
  isConfigured: boolean;
  /** Motivo legível para a UI mostrar ANTES do clique. `null` quando pronto. */
  configReason: string | null;
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
          startUrl: null,
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
        | { configured?: boolean; start_url?: string | null; reason?: string; code?: string }
        | null;

      if (result?.configured === true) {
        return {
          configured: true,
          // Ausente ⇒ org sem subconta ainda. Botão VIVO: o clique provisiona.
          startUrl: typeof result.start_url === "string" ? result.start_url : null,
          reason: null,
          code: null,
        };
      }

      return {
        configured: false,
        startUrl: null,
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
  const configReason = isConfigured ? null : probe.data?.reason ?? FALLBACK_REASON;
  const startUrl = probe.data?.startUrl ?? null;

  /** Semeia o cache com a URL recém-provisionada: o próximo clique já abre nela. */
  const cacheStartUrl = useCallback(
    (url: string) => {
      queryClient.setQueryData<StartProbe>(["notificame_start_url", organizationId], {
        configured: true,
        startUrl: url,
        reason: null,
        code: null,
      });
    },
    [queryClient, organizationId],
  );

  // ── Finalização: descobre e vincula o canal, server-side ───────────────────
  const finish = useCallback(async () => {
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
        const result = data as { instance_id?: string } | null;
        if (!result?.instance_id) {
          toast.error("Resposta inesperada do servidor");
          return;
        }
        await queryClient.invalidateQueries({
          queryKey: ["whatsapp_instances", organizationId],
        });
        toast.success("WhatsApp Oficial conectado!");
        return;
      }

      const body = await readFnError(error);
      // `no_channel_found` é consistência eventual do `/v1/channels`: o canal
      // acabou de nascer e a listagem ainda não o enxerga.
      // `ambiguous_channel` só é retentável QUANDO houve sessão: com a baseline
      // aplicada, dois candidatos significam concorrência real (outro canal
      // nascendo agora), e concorrência real se resolve esperando. Sem sessão,
      // ambíguo é estado parado — retentar seria só repetir o mesmo erro.
      const retryable =
        body.code === "no_channel_found" || (body.code === "ambiguous_channel" && !!sessionId);
      if (retryable && attempt < FINISH_RETRIES - 1) {
        await sleep(FINISH_RETRY_DELAY_MS);
        continue;
      }
      toast.error(messageForCode(body.code, configReason));
      return;
    }
  }, [organizationId, queryClient, configReason]);

  // ── Clique ────────────────────────────────────────────────────────────────
  // NÃO é async, e não há `await` antes do `window.open`: o navegador só libera
  // a janela enquanto o gesto do usuário está vivo na pilha. É por isso que a
  // janela abre EM BRANCO quando a URL ainda não existe, em vez de esperar o
  // provisionamento e abrir depois — esperar seria abrir janela sem gesto, e
  // Safari/Firefox bloqueiam.
  const connectNotificame = useCallback(() => {
    if (isConnecting) return;

    if (isConfigLoading) {
      toast.info("Verificando disponibilidade do WhatsApp Oficial...");
      return;
    }
    if (!isConfigured) {
      toast.info(configReason ?? FALLBACK_REASON);
      return;
    }
    if (!organizationId) {
      toast.error("Organização não encontrada");
      return;
    }

    // Primeiro clique da org: ainda não há subconta, logo não há URL. A janela
    // abre mesmo assim — no gesto — e é NAVEGADA quando o connect responder.
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
      toast.error("Permita pop-ups neste site para conectar o WhatsApp Oficial");
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
        body: { organization_id: organizationId, mode: "connect" },
      })
      .then(async ({ data, error }): Promise<ConnectOutcome> => {
        if (error) return { ok: false, code: (await readFnError(error)).code ?? null };
        const result = data as
          | { configured?: boolean; start_url?: unknown; session_id?: unknown; code?: unknown }
          | null;
        if (result?.configured !== true || typeof result.start_url !== "string") {
          return { ok: false, code: typeof result?.code === "string" ? result.code : null };
        }
        return {
          ok: true,
          startUrl: result.start_url,
          sessionId: typeof result.session_id === "string" ? result.session_id : null,
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
          settleWith(messageForCode(r.code ?? undefined, configReason));
        }
        return;
      }

      // A URL só existe depois desta resposta na primeira vez da org. Semear o
      // cache aqui é o que faz o SEGUNDO clique abrir direto no fornecedor —
      // inclusive quando este popup foi abandonado no meio.
      cacheStartUrl(r.startUrl);
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

      void finish().finally(() => {
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
      toast.error("Tempo esgotado para conectar o WhatsApp Oficial");
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
    startUrl,
    configReason,
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
    isConfigLoading,
    isProvisioning,
  };
}
