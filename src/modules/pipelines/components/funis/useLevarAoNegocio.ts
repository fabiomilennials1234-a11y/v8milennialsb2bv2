import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { anteciparDestaque, DESTAQUE_ANTECIPACAO_MS, destacarCard } from "@/modules/leads";
import {
  esperarCard,
  planejarCamera,
  RELOGIO_DO_NAVEGADOR,
  rodarCamera,
  seletorDoCard,
  type RelogioDaAnimacao,
} from "@/modules/pipelines/lib/rolar-ate-o-card";

/** O que a página decidiu levar até a tela (uma vez por pedido). */
export interface AlvoDaCamera {
  entryId: string;
  stageKey: string;
  /** Identidade do pedido: o mesmo negócio pedido de novo é outra viagem. */
  nonce: number;
  /** O botão do chat foi ativado pelo teclado: o foco vai para o card. */
  viaTeclado?: boolean;
  /** Para o anúncio do leitor de tela: "Negócio de {lead} na etapa {etapa}". */
  nomeDoLead?: string | null;
  nomeDaEtapa?: string | null;
}

/** Teto da chegada: passou disto sem o card na tela, a página avisa. */
export const PRAZO_DA_CHEGADA_MS = 6000;
/** A câmera parte com as colunas a ~60% da entrada delas: movimento contínuo. */
const PARTIDA_APOS_MONTAGEM_MS = 180;
/** Gestos com que a pessoa assume a tela — a câmera cede na hora. */
const GESTOS = ["wheel", "pointerdown", "touchstart", "keydown"] as const;

function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Resolve quando a aba está visível (Ctrl/⌘+clique abre o board em segundo plano). */
function quandoVisivel(sinal: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const pronto = () => {
      if (document.visibilityState !== "visible" && !sinal.aborted) return;
      document.removeEventListener("visibilitychange", pronto);
      resolve();
    };
    document.addEventListener("visibilitychange", pronto);
    sinal.addEventListener("abort", pronto, { once: true });
  });
}

/**
 * A chegada do "Ir para o negócio" no board: espera o card fixado estar numa
 * coluna e o board OCIOSO (nenhuma página, foco ou pilha buscando — senão a
 * câmera miraria um lugar que ainda vai mudar), espera a aba ficar visível, e
 * leva a tela até ele. O brilho é agendado para pousar no fim da câmera.
 *
 * A pessoa manda: qualquer gesto (rolar, clicar, tocar, tecla) cancela a
 * câmera, e o brilho toca onde o card estiver. Gesto ANTES da partida (o board
 * ainda buscando): sem câmera e sem aviso de prazo — ela já está navegando.
 * Uma viagem por `nonce`, contada no `registro` da página.
 */
export function useLevarAoNegocio({
  alvo,
  etapa,
  pipelineId,
  registro,
  onNaoDeu,
  relogio = RELOGIO_DO_NAVEGADOR,
}: {
  alvo: AlvoDaCamera | null;
  /** A coluna em que o card do alvo está AGORA (`null` = ainda não está no board). */
  etapa: string | null;
  pipelineId: string;
  /** O nonce que já viajou. Da PÁGINA: o board remonta e não repete a chegada. */
  registro: MutableRefObject<number | null>;
  /** O card não apareceu no prazo (a página oferece abrir o negócio). */
  onNaoDeu: (alvo: AlvoDaCamera) => void;
  relogio?: RelogioDaAnimacao;
}): { anuncio: string } {
  const buscandoColunas = useIsFetching({ queryKey: ["pipeline-page", pipelineId] });
  const buscandoPilha = useIsFetching({ queryKey: ["pipeline-desfecho-por-mes", pipelineId] });
  const ocioso = buscandoColunas === 0 && buscandoPilha === 0;

  const montadoEm = useRef(relogio.agora());
  const assumiuAntes = useRef<number | null>(null);
  const viagem = useRef<AbortController | null>(null);
  const onNaoDeuRef = useRef(onNaoDeu);
  onNaoDeuRef.current = onNaoDeu;
  const [anuncio, setAnuncio] = useState("");

  // A viagem só morre com a página ou com um pedido novo.
  useEffect(() => () => viagem.current?.abort(), []);

  // A pessoa manda desde a chegada, não só depois da partida.
  useEffect(() => {
    if (!alvo || registro.current === alvo.nonce) return;
    const { nonce } = alvo;
    const assumiu = () => {
      if (registro.current !== nonce) assumiuAntes.current = nonce;
    };
    for (const gesto of GESTOS) window.addEventListener(gesto, assumiu, { capture: true, passive: true });
    return () => {
      for (const gesto of GESTOS) window.removeEventListener(gesto, assumiu, { capture: true });
    };
  }, [alvo, registro]);

  // Teto: o board nunca ficou pronto para este pedido. Quem já assumiu a tela
  // não pediu aviso nenhum.
  useEffect(() => {
    if (!alvo || registro.current === alvo.nonce) return;
    const teto = setTimeout(() => {
      if (registro.current === alvo.nonce) return;
      registro.current = alvo.nonce;
      if (assumiuAntes.current !== alvo.nonce) onNaoDeuRef.current(alvo);
    }, PRAZO_DA_CHEGADA_MS);
    return () => clearTimeout(teto);
  }, [alvo, registro]);

  useEffect(() => {
    if (!alvo || !etapa || !ocioso || registro.current === alvo.nonce) return;
    registro.current = alvo.nonce;
    // Assumiu antes da partida: nada de puxar a tela nem o foco dela — só o
    // brilho, onde o card estiver.
    if (assumiuAntes.current === alvo.nonce) {
      destacarCard(alvo.entryId);
      return;
    }
    viagem.current?.abort();
    const ctrl = new AbortController();
    viagem.current = ctrl;
    // Tocar no próprio card é o "achei": não há o que destacar depois.
    let tocouNoCard = false;
    const assumiu = (e: Event) => {
      const alvoDoGesto = e.target instanceof Element ? e.target : null;
      if (e.type === "pointerdown" && alvoDoGesto?.closest(`[data-lead-id="${CSS.escape(alvo.entryId)}"]`)) tocouNoCard = true;
      ctrl.abort();
    };
    for (const gesto of GESTOS) window.addEventListener(gesto, assumiu, { capture: true, passive: true });
    const soltar = () => {
      for (const gesto of GESTOS) window.removeEventListener(gesto, assumiu, { capture: true });
    };

    void (async () => {
      try {
        await quandoVisivel(ctrl.signal);
        const card = await esperarCard(seletorDoCard(etapa, alvo.entryId), {
          sinal: ctrl.signal,
          prazoMs: PRAZO_DA_CHEGADA_MS,
          relogio,
        });
        if (!card) {
          // A pessoa assumiu a tela antes: ela manda, sem aviso. Sem gesto, o
          // card nunca apareceu — a página avisa e oferece abrir o negócio.
          if (!ctrl.signal.aborted) onNaoDeuRef.current(alvo);
          return;
        }
        const naEtapa = alvo.nomeDaEtapa ? ` na etapa ${alvo.nomeDaEtapa}` : "";
        setAnuncio(`Negócio de ${alvo.nomeDoLead ?? "lead"}${naEtapa}.`);

        const espera = montadoEm.current + PARTIDA_APOS_MONTAGEM_MS - relogio.agora();
        if (espera > 0 && !ctrl.signal.aborted) await new Promise((r) => setTimeout(r, espera));

        const reduzido = movimentoReduzido();
        if (ctrl.signal.aborted || reduzido) {
          if (reduzido && !ctrl.signal.aborted) await rodarCamera(planejarCamera(card, { barra: barraDoBoard() }), { reduzido: true });
          if (!tocouNoCard) destacarCard(alvo.entryId);
        } else {
          const plano = planejarCamera(card, { barra: barraDoBoard() });
          // O pouso começa um instante antes de a câmera parar.
          destacarCard(alvo.entryId, {
            inicio: relogio.agora() + plano.duracaoTotalMs - DESTAQUE_ANTECIPACAO_MS,
          });
          const chegou = await rodarCamera(plano, { sinal: ctrl.signal, relogio });
          // Interrompida: o brilho toca agora, onde o card estiver — a menos que
          // a interrupção tenha sido tocar no próprio card (o "achei"). O flag é
          // preciso: esta linha roda entre os listeners do MESMO pointerdown,
          // antes de o card encerrar o destaque.
          if (!chegou && !tocouNoCard) anteciparDestaque(alvo.entryId);
        }

        // Pelo teclado, o foco vai para o card — a menos que a pessoa já tenha
        // assumido a tela (uma tecla na busca não pode ir parar no card).
        if (alvo.viaTeclado && !ctrl.signal.aborted) {
          const alvoDoFoco = card.parentElement?.closest<HTMLElement>('[role="button"]') ?? card;
          alvoDoFoco.focus({ preventScroll: true });
        }
      } finally {
        soltar();
      }
    })();
  }, [alvo, etapa, ocioso, registro, relogio]);

  return { anuncio };
}

function barraDoBoard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-quadro="barra-topo"]');
}
