/**
 * Os cinco timbres do Torque, sintetizados no próprio navegador.
 *
 * Sem arquivo de áudio: zero byte no bundle, zero requisição, e o timbre vira
 * código versionado — mudar o som do erro é um commit, não um upload. O teto
 * disso é conhecido: som sintetizado não vira assinatura sonora de marca. Se um
 * dia isso for a régua, troca-se por arquivo aqui dentro, sem tocar em quem
 * chama.
 *
 * O vocabulário é deliberado: quanto mais grave e mais longo, mais caro é
 * ignorar.
 */

import type { Timbre } from "./decisao-de-entrega";

interface Nota {
  freq: number;
  dur: number;
  ganho: number;
  em: number;
  tipo?: OscillatorType;
  desliza?: number;
}

const PARTITURAS: Record<Timbre, Nota[]> = {
  // Dois toques curtos e agudos: chega dezenas de vezes por hora, tem que sumir
  // do ouvido.
  mensagem: [
    { freq: 880, dur: 0.09, ganho: 0.28, em: 0 },
    { freq: 1318, dur: 0.11, ganho: 0.22, em: 0.085 },
  ],
  // Tríade ascendente: notícia boa soa como notícia boa.
  lead: [
    { freq: 523.25, dur: 0.13, ganho: 0.24, em: 0 },
    { freq: 659.25, dur: 0.13, ganho: 0.24, em: 0.075 },
    { freq: 830.61, dur: 0.32, ganho: 0.26, em: 0.15 },
  ],
  // Sino de cauda longa: evento de agenda merece um segundo inteiro.
  reuniao: [
    { freq: 1046.5, dur: 0.85, ganho: 0.22, em: 0 },
    { freq: 1568, dur: 0.55, ganho: 0.09, em: 0.005 },
    { freq: 2093, dur: 0.35, ganho: 0.04, em: 0.01 },
  ],
  // Dois pulsos graves: desconfortável de propósito.
  erro: [
    { freq: 233.08, dur: 0.17, ganho: 0.34, em: 0, tipo: "triangle" },
    { freq: 174.61, dur: 0.3, ganho: 0.34, em: 0.19, tipo: "triangle" },
  ],
  // Um clique seco.
  sistema: [{ freq: 1200, dur: 0.06, ganho: 0.2, em: 0, desliza: 900 }],
};

type FabricaDeContexto = () => AudioContext | null;

const fabricaPadrao: FabricaDeContexto = () => {
  const Construtor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Construtor ? new Construtor() : null;
};

export class MotorDeSom {
  private contexto: AudioContext | null = null;
  private destravado = false;
  private escutando = false;

  constructor(private readonly fabrica: FabricaDeContexto = fabricaPadrao) {}

  /**
   * O navegador só deixa tocar depois de um gesto da pessoa. Chamar isto DENTRO
   * do gesto (um clique no sino, por exemplo) é o que destrava o áudio.
   */
  destravar(): void {
    const ctx = this.contextoAtivo();
    this.destravado = ctx?.state === "running";
  }

  /**
   * Arma a escuta de gestos.
   *
   * A primeira versão disto usava `{ once: true }` e removia os ouvintes no
   * cleanup do efeito. Dois problemas, e os dois deixam o produto MUDO em
   * produção: o componente que armava a escuta desmonta (o sino existe na barra
   * e na gaveta móvel), levando os ouvintes junto antes de qualquer clique; e um
   * `resume()` recusado marcava como destravado assim mesmo.
   *
   * Agora os ouvintes ficam até o contexto estar de fato `running`, e o estado
   * é lido do próprio AudioContext em vez de ser presumido.
   */
  destravarNoPrimeiroGesto(): () => void {
    if (typeof window === "undefined" || this.escutando) return () => {};
    this.escutando = true;

    const aoGesto = () => {
      this.destravar();
      if (this.destravado) {
        window.removeEventListener("pointerdown", aoGesto);
        window.removeEventListener("keydown", aoGesto);
        this.escutando = false;
      }
    };

    window.addEventListener("pointerdown", aoGesto);
    window.addEventListener("keydown", aoGesto);

    // Sem cleanup de propósito: desarmar a escuta ao desmontar um componente
    // qualquer foi exatamente o que emudeceu o sino.
    return () => {};
  }

  /** Toca o timbre. Volume de 0 a 100. Silencioso e sem exceção onde não há áudio. */
  tocar(timbre: Timbre, volume: number): void {
    const ctx = this.contextoAtivo();
    if (!ctx) return;

    // Contexto suspenso toca no vazio: os osciladores rodam, ninguém ouve. Só
    // vale agendar as notas depois que ele estiver de fato correndo.
    if (ctx.state === "suspended") {
      void ctx.resume().then(
        () => this.agendar(ctx, timbre, volume),
        () => undefined,
      );
      return;
    }

    this.agendar(ctx, timbre, volume);
  }

  private agendar(ctx: AudioContext, timbre: Timbre, volume: number): void {
    const mestre = ctx.createGain();
    mestre.gain.value = Math.max(0.0001, (volume / 100) * 0.9);
    const compressor = ctx.createDynamicsCompressor();
    mestre.connect(compressor);
    compressor.connect(ctx.destination);

    for (const nota of PARTITURAS[timbre]) {
      const osc = ctx.createOscillator();
      const ganho = ctx.createGain();
      const inicio = ctx.currentTime + nota.em;

      osc.type = nota.tipo ?? "sine";
      osc.frequency.setValueAtTime(nota.freq, inicio);
      if (nota.desliza) {
        osc.frequency.exponentialRampToValueAtTime(nota.desliza, inicio + nota.dur);
      }

      ganho.gain.setValueAtTime(0.0001, inicio);
      ganho.gain.exponentialRampToValueAtTime(nota.ganho, inicio + 0.012);
      ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + nota.dur);

      osc.connect(ganho);
      ganho.connect(mestre);
      osc.start(inicio);
      osc.stop(inicio + nota.dur + 0.05);
    }
  }

  private contextoAtivo(): AudioContext | null {
    try {
      if (!this.contexto) this.contexto = this.fabrica();
      // A retomada acontece num lugar só (`tocar`), porque ela é ASSÍNCRONA:
      // pedir aqui e agendar em seguida agendaria com o contexto ainda suspenso.
      return this.contexto;
    } catch {
      // Áudio indisponível não pode derrubar o sino.
      return null;
    }
  }
}

export const motorDeSom = new MotorDeSom();
