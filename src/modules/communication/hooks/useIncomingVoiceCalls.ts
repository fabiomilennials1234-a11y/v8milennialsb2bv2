/**
 * As ligações que ENTRAM, enquanto ainda estão tocando.
 *
 * ─── A mudança estrutural da fatia: o stream abre ANTES de existir chamada ───
 * `useVoiceCall` abre o stream de eventos no caminho de discar e o fecha quando
 * a chamada morre (`useVoiceCall.ts:395`, `teardown`). Isso basta para a saída:
 * quem disca sabe que vai haver uma chamada. Para RECEBER não existe esse
 * momento — a oferta chega sozinha, e quem não estiver ouvindo não fica sabendo.
 * O broker publica para os assinantes DAQUELE INSTANTE e não reenvia.
 *
 * Então o stream precisa ficar aberto o tempo todo. E isso tem um custo, porque
 * o `VoiceCallProvider` vive FORA das rotas: existe em toda página, para todo
 * usuário. A fatia da gravação derrubou o custo daquele provider de 3–5
 * requisições por página para 0 ou 1, e reintroduzir carga aqui desfaria aquilo.
 *
 * ─── Quem abre, quando fecha, e quanto custa ────────────────────────────────
 * Abre para quem tem PELO MENOS UM número ao alcance para receber
 * (`useAnswerableVoiceNumbers`). Quem não tem — sem permissão, sem sessão de voz
 * aberta, fora da lista do número, voz desligada — **não abre stream nenhum**, e
 * não paga uma requisição a mais do que já pagava: aquela lista já é calculada
 * hoje para decidir se o botão de ligar aparece, e as duas leituras dela têm o
 * mesmo `queryKey` do hook da saída. Medido em produção em 2026-08-03: existe
 * UMA sessão de voz aberta em toda a plataforma, numa organização com 4 membros
 * ativos — ou seja, 4 streams no total, e ZERO para as outras ~29 organizações.
 *
 * Fecha no desmonte, e quando a lista de números ao alcance esvazia (a sessão
 * caiu, o admin tirou o vendedor da lista, a voz foi desligada).
 *
 * O custo em regime é: **1 chamada a `torquecalls-signal` (o token do stream) +
 * 1 conexão HTTP viva**, por vendedor que pode receber. Não há renovação
 * periódica: o token de 60 s é conferido na ENTRADA do `/api/events` e o handler
 * do SSE zera o deadline de leitura de propósito (`broker.go:serveSSE`), então o
 * stream sobrevive à expiração do token que o abriu. Renovar a cada 45 s, como o
 * `renew_in_ms` sugere, seriam ~80 invocações por hora por vendedor para
 * comprar exatamente nada.
 *
 * ─── UM stream serve a TODOS os números ─────────────────────────────────────
 * O broker filtra por ORGANIZAÇÃO, não por sessão (`publish`, `broker.go`).
 * Chegam por um único stream os eventos de todos os números da organização,
 * independentemente de qual `tc_session_id` pediu o token. Por isso abrimos um
 * só — pedir um por número seria pagar N conexões pelo mesmo conteúdo — e por
 * isso o filtro de QUEM DEVE OUVIR é aplicado aqui, evento a evento, contra a
 * lista de sessões ao alcance.
 *
 * ─── Por que isto NÃO é uma fase de `CallPhase` ─────────────────────────────
 * Ver `callPhases.ts`. Em uma frase: `useVoiceCall` é a máquina de UMA chamada
 * que ESTE operador possui, e uma oferta de entrada não tem dono
 * (`operator_user_id` nulo) nem é uma só — N podem tocar ao mesmo tempo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { requestStreamToken } from "@/modules/communication/lib/torquecallsApi";
import {
  subscribeSessionEvents,
  type SessionEvent,
} from "@/modules/communication/lib/torquecallsEvents";
import { startIncomingRing } from "@/modules/communication/lib/voiceRingback";
import { phoneVariants } from "@/modules/communication/lib/conversationCallsQuery";
import { normalizePhone } from "@/lib/normalizePhone";
import type { CallableVoiceNumber } from "@/modules/communication/hooks/useVoipSession";

/**
 * Espera antes de reabrir um stream que caiu, dobrando até o teto.
 *
 * Um stream permanente que morre na primeira instabilidade de rede e não volta é
 * pior que não ter stream: o vendedor não recebe mais ligação nenhuma e nada na
 * tela diz isso. A reabertura é obrigatória; o recuo existe para que uma VPS
 * fora do ar não vire uma tempestade de tokens.
 */
const RECONEXAO_MIN_MS = 1_000;
const RECONEXAO_MAX_MS = 30_000;

export interface IncomingVoiceCall {
  /** Identidade da chamada na VPS — o `id` do evento, o mesmo do `call-ended`. */
  tcCallId: string;
  tcSessionId: string;
  /** O número POR ONDE ela está entrando, no nome que o vendedor reconhece. */
  instanceName: string;
  /** Dígitos de quem está ligando. Vazio quando o JID não é um telefone. */
  peerDigits: string;
  /** Instante da oferta, em ms — carimbado pela VPS, não pelo navegador. */
  offeredAt: number;
}

/**
 * Dígitos do JID, sem inventar nada.
 *
 * Espelho de `peerDigits` (`cmd/server/broker.go`), que é o que a VPS aplica
 * antes de mandar o mesmo número ao webhook. Ao SSE ela manda o JID INTEIRO
 * (`555185960716@s.whatsapp.net`) porque é a tela que o exibe; ao webhook manda
 * só os dígitos, porque `voip_calls.peer_phone` tem CHECK `^[0-9]{8,15}$`.
 *
 * A parte que importa é derrubar o servidor E O DISPOSITIVO **antes** de filtrar
 * dígitos. `555185960716:12@s.whatsapp.net` é um JID com sufixo de aparelho, e
 * filtrar dígitos direto o transforma em `55518596071612` — 14 dígitos, que
 * passam por qualquer validação de comprimento, não são telefone de ninguém e
 * não casam com lead nenhum, para sempre e sem erro. Do lado da VPS quem faz
 * isso é `jid.ToNonAD().User`; aqui são os dois cortes.
 */
export function peerDigitsFromJid(peer: string): string {
  const semServidor = peer.includes("@") ? peer.slice(0, peer.indexOf("@")) : peer;
  const semDispositivo = semServidor.includes(":")
    ? semServidor.slice(0, semServidor.indexOf(":"))
    : semServidor;
  return semDispositivo.replace(/\D/g, "");
}

/**
 * A identidade de uma chamada é o PAR `(sessão, chamada)` — nunca o id sozinho.
 *
 * Na entrada o `id` vem do stanza REMOTO (`ExtractNodeInfo → info.CallID`): é
 * string escolhida pelo outro lado, e nada garante que dois números da mesma
 * organização não recebam o mesmo valor. O broker da VPS chaveia por
 * `callKey{sessionID, callID}` exatamente por isso, e documenta o ataque em
 * `broker.go`. Chavear só pelo id aqui reintroduziria, no navegador, a premissa
 * que o Go já tinha descartado.
 *
 * Medido com id colidido entre duas sessões: com chave simples a **segunda
 * oferta nunca toca** (o dedupe a confunde com a primeira) e o fim da primeira
 * **remove a que sobrou**. Um peer remoto escolhendo o id certo cala o telefone
 * de outro número da organização.
 */
function mesmaChamada(
  oferta: { tcSessionId: string; tcCallId: string },
  tcSessionId: string,
  tcCallId: string,
): boolean {
  return oferta.tcSessionId === tcSessionId && oferta.tcCallId === tcCallId;
}

/**
 * Chave textual do par, para os conjuntos da reconciliação.
 *
 * O comprimento vem na frente em vez de um separador, e a razão é que **nenhum
 * separador é seguro aqui**: o `tcCallId` vem do stanza remoto, então quem
 * escolhe os caracteres dele é o outro lado. Um separador qualquer — espaço,
 * `|`, `:` — pode aparecer dentro do id, e aí `("a b", "c")` e `("a", "b c")`
 * viram a mesma chave. Prefixar o tamanho da primeira parte torna a decodificação
 * única por construção, sem depender do alfabeto de ninguém.
 *
 * A primeira versão disto usava `\0` como separador, que é injetivo mas custou
 * caro por outro motivo: um byte NUL faz o **git tratar o arquivo como binário**,
 * e o diff deste arquivo de produção virou `Binary files differ` — invisível para
 * qualquer revisão. `grep` e `rg` também pulam o arquivo sem `-a`. Um arquivo de
 * produção que não aparece em diff é uma superfície onde qualquer coisa entra sem
 * ser vista. Toda a chave é ASCII imprimível de propósito.
 */
function chaveDaChamada(tcSessionId: string, tcCallId: string): string {
  return `${tcSessionId.length}:${tcSessionId}:${tcCallId}`;
}

/** Estado interno: a oferta mais o que só o reconciliador precisa saber. */
interface OfertaViva extends IncomingVoiceCall {
  /**
   * Já apareceu em algum `call-list`.
   *
   * Antes disso, ausência da lista NÃO é fim: o `incoming` é emitido ANTES de a
   * chamada ser fiada (`session.go:onIncomingOffer`), e um `call-list` disparado
   * nesse intervalo por outra chamada qualquer não conteria esta. Só depois de
   * tê-la visto viva uma vez é que sumir da lista significa que acabou.
   */
  confirmada: boolean;
  /**
   * ESTE vendedor saiu da lista desta oferta — recusou, ou já a está atendendo.
   *
   * ─── Por que a oferta continua no estado, apenas marcada ────────────────────
   * Porque tirá-la exigiria uma lápide paralela. A VPS RETRANSMITE `incoming`
   * (é a razão de existir o dedupe por `mesmaChamada`), então uma oferta
   * removida voltaria à tela sozinha em segundos, e evitar isso pediria um
   * segundo conjunto, com um segundo ciclo de vida, que alguém teria de lembrar
   * de limpar. Marcada, ela continua debaixo de toda a máquina que já existe: o
   * `call-list` a reconcilia, o fim a remove, o encolhimento do alcance a leva
   * junto. Uma estrutura, um ciclo de vida.
   *
   * ─── Recusar NÃO fala com a VPS, e isso é a decisão ─────────────────────────
   * O ADR-0027, decisão 3, é literal: **"O CRM nunca recusa a oferta."** E aqui
   * isso é mais que uma regra herdada — é a única leitura possível de uma oferta
   * sem dono. O mesmo ADR põe "fila ou distribuição entre vendedores" FORA DE
   * ESCOPO e registra que "todos da lista tocam ao mesmo tempo", junto com o
   * celular. Um deles clicando "agora não" não fala pelos outros: `/reject` na
   * VPS executa `cm.RejectCall(EndCallReasonDeclined)`, que derruba a ligação
   * para os colegas que estavam prestes a atender E para o aparelho na mão dele.
   *
   * Recusar aqui é sair da lista, não encerrar a ligação. O cliente segue
   * chamando, e se ninguém atender ele vira ligação perdida no histórico — que é
   * a informação que o gestor quer (história 8 do PRD #1370).
   */
  dispensada: boolean;
}

interface UseIncomingVoiceCallsOptions {
  /**
   * `false` cala o toque sem esconder o cartão.
   *
   * É o caso do vendedor que já está em chamada: um tom no fone por cima da
   * conversa é hostil, e ele não pode atender a segunda de qualquer jeito. O
   * cartão continua — é informação, não interrupção — e o celular dele continua
   * tocando, que é quem o ADR-0027 deixa decidir.
   */
  ringEnabled?: boolean;
}

export function useIncomingVoiceCalls(
  numbers: CallableVoiceNumber[],
  options?: UseIncomingVoiceCallsOptions,
): {
  calls: IncomingVoiceCall[];
  /** O navegador barrou o toque. A tela TEM de dizer isso — ver `startTone`. */
  ringSilenced: boolean;
  /** Tira a oferta da tela DESTE vendedor. Não fala com a VPS — ver `dispensada`. */
  dispensar: (tcSessionId: string, tcCallId: string) => void;
  /**
   * Devolve à tela uma oferta dispensada, se ela ainda estiver viva.
   *
   * Existe por um caminho só, e ele é real: o atendimento dispensa a oferta no
   * CLIQUE, para o toque calar e o cartão sair na hora — mas o atendimento pode
   * falhar depois disso (o vendedor nega o microfone, o navegador não tem
   * AudioWorklet). Nesse caso a ligação continua tocando de verdade, e engolir o
   * cartão tiraria dele a chance de tentar de novo por um erro que ele mesmo
   * pode corrigir. Se a chamada tiver morrido nesse meio tempo, ela já não está
   * na lista e isto não faz nada — que é a resposta certa.
   */
  restaurar: (tcSessionId: string, tcCallId: string) => void;
} {
  const { organizationId } = useOrganization();
  const [ofertas, setOfertas] = useState<OfertaViva[]>([]);
  const [ringSilenced, setRingSilenced] = useState(false);

  /**
   * As sessões ao alcance, em ref: o ouvinte do stream é registrado UMA vez, no
   * começo, e leria para sempre o valor do render em que nasceu. É a mesma razão
   * do `tcCallIdRef` em `useVoiceCall`.
   */
  const alcance = useMemo(
    () => new Map(numbers.map((n) => [n.tcSessionId, n.instanceName])),
    [numbers],
  );
  const alcanceRef = useRef(alcance);
  alcanceRef.current = alcance;

  /**
   * Identidade ESTÁVEL do conjunto de sessões. É `string`, então o efeito do
   * stream só reabre quando o conjunto muda de verdade — e não a cada refetch do
   * react-query, que devolve um array novo com o mesmo conteúdo.
   */
  const assinatura = useMemo(
    () => numbers.map((n) => n.tcSessionId).sort().join("|"),
    [numbers],
  );

  const remover = useCallback((tcSessionId: string, tcCallId: string) => {
    setOfertas((atual) =>
      atual.some((o) => mesmaChamada(o, tcSessionId, tcCallId))
        ? atual.filter((o) => !mesmaChamada(o, tcSessionId, tcCallId))
        : atual,
    );
  }, []);

  /** Liga ou desliga a marca de "saí da lista desta oferta". */
  const marcar = useCallback((tcSessionId: string, tcCallId: string, valor: boolean) => {
    setOfertas((atual) =>
      atual.some((o) => mesmaChamada(o, tcSessionId, tcCallId) && o.dispensada !== valor)
        ? atual.map((o) =>
          mesmaChamada(o, tcSessionId, tcCallId) ? { ...o, dispensada: valor } : o
        )
        : atual,
    );
  }, []);

  const dispensar = useCallback(
    (tcSessionId: string, tcCallId: string) => marcar(tcSessionId, tcCallId, true),
    [marcar],
  );
  const restaurar = useCallback(
    (tcSessionId: string, tcCallId: string) => marcar(tcSessionId, tcCallId, false),
    [marcar],
  );

  const aplicar = useCallback(
    (event: SessionEvent) => {
      /**
       * `call-list` é o INSTANTÂNEO das chamadas vivas, e a VPS o emite a toda
       * conexão nova (`serveSSE` chama `publishCallList` logo depois do
       * snapshot). É ele que fecha o pior defeito possível desta fatia: o stream
       * cai, o `call-ended` acontece enquanto ninguém ouve, e o CRM fica tocando
       * para uma ligação que já morreu. Nenhum relógio conserta um evento que
       * não chegou; reconciliar conserta.
       *
       * Ele só REMOVE. Criar oferta a partir daqui seria um segundo produtor do
       * mesmo fato — e `incoming` é o evento desenhado para anunciá-la, com tipo
       * próprio justamente para que a criação não dependa de interpretar um
       * campo dentro de um caminho compartilhado.
       */
      if (event.type === "call-list") {
        // Pelo PAR, como o broker chaveia — ver `mesmaChamada`. Uma lista
        // indexada só por id faria a chamada de uma sessão "confirmar" a de
        // outra, e a reconciliação passaria a apagar a errada.
        const vivas = new Set<string>();
        const lista = Array.isArray(event.calls) ? event.calls : [];
        for (const bruta of lista) {
          const linha = bruta as { callId?: unknown; sessionId?: unknown } | null;
          if (typeof linha?.callId === "string" && typeof linha?.sessionId === "string") {
            vivas.add(chaveDaChamada(linha.sessionId, linha.callId));
          }
        }
        setOfertas((atual) => {
          let mudou = false;
          const proxima: OfertaViva[] = [];
          for (const o of atual) {
            const estaViva = vivas.has(chaveDaChamada(o.tcSessionId, o.tcCallId));
            if (estaViva) {
              if (!o.confirmada) {
                proxima.push({ ...o, confirmada: true });
                mudou = true;
              } else {
                proxima.push(o);
              }
              continue;
            }
            if (o.confirmada) {
              mudou = true; // sumiu da lista depois de ter estado nela: acabou.
              continue;
            }
            proxima.push(o); // ainda não confirmada: ausência não é fim.
          }
          return mudou ? proxima : atual;
        });
        return;
      }

      const sessionId = typeof event.sessionId === "string" ? event.sessionId : null;
      const id = typeof event.id === "string" ? event.id : null;

      if (event.type === "incoming") {
        /**
         * O FILTRO, e ele é fail-closed: sem identidade de sessão, ou com uma
         * sessão fora do alcance deste vendedor, a oferta não entra. É aqui que
         * "não toca para quem não está na lista" acontece — o stream traz os
         * eventos da organização inteira, e a forma permissiva ("passa se não
         * disser de quem é") faria o número de um colega tocar no fone errado.
         */
        const instanceName = sessionId ? alcanceRef.current.get(sessionId) : undefined;
        if (!sessionId || instanceName === undefined || !id) return;

        const peer = typeof event.peer === "string" ? event.peer : "";
        const offeredAt =
          typeof event.offeredAt === "number" ? event.offeredAt : Date.now();

        setOfertas((atual) =>
          // A VPS retransmite oferta; duas linhas para a mesma chamada seriam
          // dois cartões e dois motivos de confusão. A identidade é o PAR
          // `(sessão, chamada)` — ver `mesmaChamada`.
          atual.some((o) => mesmaChamada(o, sessionId, id))
            ? atual
            : [
                ...atual,
                {
                  tcCallId: id,
                  tcSessionId: sessionId,
                  instanceName,
                  peerDigits: peerDigitsFromJid(peer),
                  offeredAt,
                  confirmada: false,
                  dispensada: false,
                },
              ],
        );
        return;
      }

      // Fim sem identidade COMPLETA não remove nada: apagar pelo id sozinho
      // derrubaria o cartão da sessão errada numa colisão. O broker sempre manda
      // `sessionId` nos três tipos terminais (verificado em `endCall`,
      // `upsertCall` e `emitIncomingClaimed`), e o `call-list` é a rede para o
      // caso de algum dia não mandar.
      if (!id || !sessionId) return;

      /**
       * Todo fim é o MESMO fim, de propósito.
       *
       * O cliente desistiu, o celular do vendedor atendeu, um colega atendeu
       * pelo CRM, o WhatsApp derrubou — os quatro chegam por este stream e os
       * quatro querem a mesma coisa: parar de tocar. Depender de QUAL motivo
       * veio seria depender de uma string que o WhatsApp escolhe
       * (`HandleCallTerminate` copia o atributo `reason` verbatim) e que
       * ninguém aqui controla.
       *
       * `call-status` entra na conta porque uma oferta só é oferta enquanto está
       * `ringing`: qualquer outro estado significa que ela já não está esperando
       * por este vendedor.
       */
      const acabou =
        event.type === "call-ended" ||
        event.type === "incoming-claimed" ||
        (event.type === "call-status" && event.status !== "ringing");

      if (acabou) remover(sessionId, id);
    },
    [remover],
  );

  // O laço do stream lê sempre a versão mais nova do tratador sem reabrir a
  // conexão por causa dele.
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  /**
   * O alcance encolheu: as ofertas que ficaram fora dele saem JUNTO.
   *
   * O filtro do `incoming` decide na ENTRADA, e isso basta enquanto o alcance
   * não muda. Mas ele muda em pleno voo — o admin tira o vendedor da lista do
   * número, a sessão cai, a voz é desligada — e uma oferta já aceita ficava na
   * tela tocando por um número ao qual ele acabou de perder acesso. Medido: com
   * o alcance indo de `[A, B]` para `[A]` e uma oferta viva em B, o cartão e o
   * tom continuavam até o `call-ended` chegar.
   *
   * Depende de `assinatura` (string), e não do Map, para não reavaliar a cada
   * render — a mesma razão do efeito do stream.
   */
  useEffect(() => {
    setOfertas((atual) => {
      const dentro = atual.filter((o) => alcanceRef.current.has(o.tcSessionId));
      return dentro.length === atual.length ? atual : dentro;
    });
  }, [assinatura]);

  useEffect(() => {
    if (!assinatura) {
      // Sem número ao alcance não há stream. As ofertas já foram embora pelo
      // efeito acima, que trata este caso como o caso geral do alcance vazio.
      return;
    }

    // Qualquer sessão do conjunto serve para PEDIR o token — o stream que ela
    // abre é da organização inteira. A ordenada primeira é a escolha
    // determinística, para que dois renders não peçam tokens diferentes.
    const tcSessionId = assinatura.split("|")[0];

    let vivo = true;
    let destravarEspera: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const laco = async () => {
      let espera = RECONEXAO_MIN_MS;
      while (vivo) {
        try {
          const stream = await requestStreamToken({
            // `pair: true` fica de fora: aquele token faz o QR trafegar no
            // stream e exige `voip.session.manage`. Receber ligação não precisa
            // de nenhum dos dois, e credencial pedida à toa é credencial vazada
            // à toa.
            tcSessionId,
            organizationId: organizationId ?? undefined,
          });
          if (!vivo) return;

          await subscribeSessionEvents({
            vpsUrl: stream.vpsUrl,
            token: stream.token,
            onEvent: (event) => {
              // Um evento recebido prova que a conexão presta. Sem este reset, um
              // stream que cai de hora em hora acabaria com 30 s de recuo
              // permanente por causa de falhas antigas.
              espera = RECONEXAO_MIN_MS;
              aplicarRef.current(event);
            },
            signal: controller.signal,
          });
        } catch {
          // Token recusado, VPS fora, rede caída. A reabertura abaixo é a
          // resposta para os três — e o `call-list` que a VPS manda a toda
          // conexão nova reconcilia o que se perdeu enquanto estivemos fora.
        }

        if (!vivo) return;
        const atraso = espera;
        espera = Math.min(espera * 2, RECONEXAO_MAX_MS);
        await new Promise<void>((resolve) => {
          destravarEspera = resolve;
          timer = setTimeout(resolve, atraso);
        });
      }
    };

    void laco();

    return () => {
      vivo = false;
      controller.abort();
      if (timer) clearTimeout(timer);
      // Solta a espera para o laço acordar, ver `vivo === false` e terminar.
      // Sem isto sobra uma promessa que nunca assenta segurando a continuação.
      destravarEspera?.();
    };
  }, [assinatura, organizationId]);

  // `confirmada` é assunto do reconciliador; quem consome a lista não deve nem
  // saber que ela existe. `dispensada` some junto com a oferta: para quem já
  // saiu da lista dela, ela deixou de existir.
  const calls = useMemo<IncomingVoiceCall[]>(
    () =>
      ofertas
        .filter((o) => !o.dispensada)
        .map(({ confirmada: _confirmada, dispensada: _dispensada, ...publica }) => publica),
    [ofertas],
  );

  /**
   * UM tom para N ofertas.
   *
   * A dependência é o BOOLEANO, não a contagem: a segunda ligação chegando não
   * pode reiniciar o tom da primeira, e três ofertas não podem virar três
   * osciladores empilhados. E o efeito ser amarrado ao estado — em vez de um
   * `start()` no lugar onde a oferta entra e um `stop()` em cada um dos quatro
   * lugares onde ela sai — é o que garante que ele CALA em todo caminho de
   * saída, inclusive no desmonte. Tom vazado toca para sempre.
   *
   * Conta a lista JÁ FILTRADA: recusar tem de calar o toque no clique. Contar
   * `ofertas` faria a última oferta recusada seguir tocando para um cartão que
   * não está mais na tela — a pior combinação possível.
   */
  const deveTocar = calls.length > 0 && options?.ringEnabled !== false;

  useEffect(() => {
    if (!deveTocar) return;
    const tom = startIncomingRing({
      onSilenced: () => setRingSilenced(true),
      onAudible: () => setRingSilenced(false),
    });
    return () => {
      tom.stop();
      setRingSilenced(false);
    };
  }, [deveTocar]);

  return { calls, ringSilenced, dispensar, restaurar };
}

/**
 * O nome de quem está ligando — quando existe.
 *
 * **47% dos contatos não têm lead.** Este hook devolve `null` nesse caso, e a
 * tela mostra o telefone: um cartão que só funciona para o contato cadastrado
 * seria um cartão que não funciona em quase metade das ligações.
 *
 * ─── O casamento do telefone, e por que ele não é uma regra nova ────────────
 * A oferta chega com o JID (`555185960716`), que vem COM o DDI e SEM o nono
 * dígito, enquanto o CRM guarda `51985960716`. `normalizePhone` é exatamente a
 * tradução entre os dois (ela tira o `55` e insere o `9`), e é a mesma função
 * que o chat usa — espelho de `normalize_brazilian_phone` no banco.
 * `phoneVariants` cobre o resto: medido em produção, `leads.normalized_phone`
 * tem 124 linhas gravadas COM o DDI, contra as quais a igualdade canônica
 * sozinha erraria em silêncio.
 *
 * ─── Isto é EXIBIÇÃO, não o vínculo ─────────────────────────────────────────
 * Quem liga a ligação ao lead de verdade é a E2, dentro de
 * `fn_voip_apply_vps_event`, e é ela que grava `voip_calls.lead_id`. Lá o
 * desempate é explícito (a forma canônica ganha das variantes; entre iguais, o
 * cadastro mais novo). Aqui basta o mais novo — e se as duas discordarem em
 * algum dos 124 casos, o que a tela mostra é um nome, não um vínculo. Repetir o
 * desempate em PostgREST seria uma terceira cópia de uma regra que já tem duas.
 */
export function useIncomingCallerName(peerDigits: string): string | null {
  const { organizationId } = useOrganization();
  const canonical = normalizePhone(peerDigits);

  const { data } = useQuery<string | null>({
    queryKey: ["voip_incoming_caller", organizationId, canonical],
    enabled: !!organizationId && !!canonical,
    // Quem é o dono de um telefone não muda enquanto o telefone toca.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: linha, error } = await supabase
        .from("leads")
        .select("name")
        .eq("organization_id", organizationId!)
        .is("deleted_at", null)
        .in("normalized_phone", phoneVariants(canonical!))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Erro aqui é infraestrutura, e a resposta é a mesma de "não achei": o
      // cartão cai para o telefone, que é a informação que sempre existe.
      if (error || !linha) return null;
      return linha.name ?? null;
    },
  });

  return data ?? null;
}
