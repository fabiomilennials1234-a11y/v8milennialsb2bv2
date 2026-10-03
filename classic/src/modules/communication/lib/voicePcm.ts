/**
 * Formato de áudio da chamada de voz — o contrato com a VPS.
 *
 * A VPS (`cmd/server/bridge.go`) não negocia mídia: ela abre UM canal de dados
 * rotulado `pcm` e trata cada mensagem como PCM cru — Int16 little-endian,
 * 16 kHz, mono — nos dois sentidos. Não há cabeçalho, não há número de
 * sequência, não há SDP descrevendo o formato. Os bytes SÃO o protocolo.
 *
 * Consequência prática: qualquer divergência aqui é silenciosa. Escala errada
 * sai como ruído, endianness errada sai como ruído branco, taxa errada sai como
 * voz de desenho animado — e nenhum dos dois lados registra erro nenhum. É por
 * isso que este arquivo é pequeno, puro e coberto por teste: é a única defesa.
 */

/** Taxa que trafega no canal. Espelha `media.PCMSampleRate` no lado Go. */
export const PCM_SAMPLE_RATE = 16000;

/**
 * Quadro de captura: 20 ms (320 amostras a 16 kHz).
 *
 * Não é um número livre. Ele decide duas coisas:
 * - latência adicionada na subida (20 ms; o quadro só sai quando fecha);
 * - quantidade de mensagens por segundo no canal (50/s).
 *
 * 20 ms é o quadro clássico de telefonia e divide certinho os 60 ms que a VPS
 * usa para encodar (`mlowFrameSize = 960`), então nada é reagrupado torto do
 * outro lado. Quadros menores gastariam mais mensagens por nada; maiores
 * empurrariam latência que já é escassa no orçamento total da conversa.
 */
export const CAPTURE_FRAME_SAMPLES = 320;

/**
 * Nome registrado pelo processador de captura (`pcm-capture-processor.js`).
 * Prefixado porque o registro de processadores é global por AudioContext e
 * colidir com outra biblioteca daria um erro obscuro em tempo de execução.
 */
export const PCM_CAPTURE_PROCESSOR = "torquecalls-pcm-capture";

const INT16_MAX = 32767;
const INT16_MIN = -32768;

/** Escala do formato. Ver o comentário de `float32ToInt16LE` sobre 32768 vs 32767. */
const INT16_SCALE = 32768;

/**
 * Float32 [-1, 1] → Int16 LE.
 *
 * Escala por 32768, e não por 32767, porque o decodificador do outro lado
 * (`media.PCMInt16LEToFloat32`) divide por 32768. Usar 32767 na ida e 32768 na
 * volta deixa um ganho residual de 32767/32768 que cresce com a amplitude: em
 * 0,9 o erro de ida-e-volta já passa de um passo de quantização. Com 32768 as
 * duas pontas são exatamente recíprocas e o erro fica limitado a meio passo.
 *
 * Satura em vez de dar a volta: sem o clamp, +1,2 vira um valor NEGATIVO em
 * complemento de dois e o estouro sai como estalo. Arredonda em vez de truncar
 * — truncar joga fora até um passo inteiro e, em sinal baixo, apaga a amostra.
 *
 * NaN vira silêncio sem branch explícito: NaN propaga pelo round/min/max e
 * `DataView.setInt16` o converte para 0. Havia uma guarda `Number.isNaN` aqui;
 * ela foi removida porque a mutação que a desligava não quebrava teste nenhum —
 * era código morto se passando por defesa. A garantia é da plataforma, e o teste
 * a fixa para pegar uma reescrita que troque o DataView por aritmética de bytes.
 */
export function float32ToInt16LE(pcm: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(pcm.length * 2);
  const view = new DataView(out);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(pcm[i] * INT16_SCALE)));
    view.setInt16(i * 2, v, true);
  }
  return out;
}

/**
 * Int16 LE → Float32 [-1, 1]. Divide por 32768 (não por 32767) porque é o que
 * `media.PCMFloat32ToInt16LE` assume do outro lado, e é o que faz o mínimo do
 * inteiro cair exatamente em -1.
 *
 * Um byte solto no fim é ignorado: mensagem truncada é perda de rede, e ler
 * meia amostra produziria um valor inventado.
 */
export function int16LEToFloat32(bytes: ArrayBuffer | ArrayBufferView): Float32Array {
  const view =
    bytes instanceof ArrayBuffer
      ? new DataView(bytes)
      : new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(view.byteLength / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = view.getInt16(i * 2, true) / INT16_SCALE;
  }
  return out;
}

/**
 * Reamostrador linear com fase contínua entre blocos.
 *
 * Só entra em uso quando o navegador RECUSA abrir o AudioContext a 16 kHz.
 * Chromium e Firefox honram `new AudioContext({ sampleRate })` e reamostram a
 * captura sozinhos; Safari antigo não. Sem este caminho, um Safari velho
 * mandaria 48 kHz rotulado como 16 kHz — o interlocutor ouviria voz de
 * desenho animado a 3× a velocidade, e nada no sistema acusaria erro.
 *
 * A fase é guardada entre chamadas de propósito: reiniciar a cada bloco de
 * 20 ms repetiria uma amostra na emenda, e 50 emendas por segundo é um zumbido
 * audível, não um detalhe.
 */
export class LinearResampler {
  private pos = 0;
  private prev = 0;

  /** ratio = taxa de entrada / taxa de saída. 3 decima 48 kHz para 16 kHz. */
  constructor(private readonly ratio: number) {}

  process(input: Float32Array): Float32Array {
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    if (this.ratio === 1) return input;

    const out: number[] = [];
    let p = this.pos;
    while (p <= n - 1) {
      const i = Math.floor(p);
      const frac = p - i;
      // i === -1 acontece quando a fase caiu antes do começo deste bloco;
      // a amostra que falta é a última do bloco anterior.
      const a = i < 0 ? this.prev : input[i];
      const b = i + 1 < n ? input[i + 1] : a;
      out.push(a + (b - a) * frac);
      p += this.ratio;
    }
    this.prev = input[n - 1];
    this.pos = p - n;
    return Float32Array.from(out);
  }
}

/** O mínimo de AudioContext que o PcmPlayback usa — para poder ser testado. */
export interface PcmPlaybackContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
}

export interface PcmPlaybackOptions {
  /** Colchão, em segundos, entre o relógio de áudio e o próximo quadro. */
  targetLatency?: number;
  /** Teto de fila, em segundos. Acima disso o quadro que chega é descartado. */
  maxLatency?: number;
}

/**
 * Toca o PCM que chega da VPS agendando cada quadro no relógio de áudio.
 *
 * O problema real não é converter amostra — é a FILA. Tocar cada mensagem assim
 * que chega faz o som picotar a cada oscilação da rede; empilhar tudo faz a
 * conversa atrasar até virar rádio amador. Os dois números abaixo são o
 * compromisso, e nenhum dos dois é chute:
 *
 * - `targetLatency = 60 ms` é exatamente UM quadro da VPS (960 amostras a
 *   16 kHz, ver `mlowFrameSize`). É o menor colchão que absorve o atraso de um
 *   quadro inteiro sem secar. Menos que isso não protege de nada — a unidade de
 *   jitter neste canal é o quadro.
 *
 * - `maxLatency = 240 ms` são quatro quadros. O orçamento de conversa fluida
 *   (G.114) é ~150 ms boca-a-ouvido de ponta a ponta, e aqui já se gastou a
 *   perna do WhatsApp, a transcodificação MLow na VPS e a internet. Deixar a
 *   fila passar de 240 ms troca "um estalo" por "os dois falando por cima",
 *   que é o defeito pior. Passou do teto, o quadro que CHEGA morre — descartar
 *   o novo drena o atraso sem cortar o que já está tocando.
 */
export class PcmPlayback {
  private playhead = 0;
  private readonly live = new Set<AudioBufferSourceNode>();
  private readonly target: number;
  private readonly max: number;
  private closed = false;

  /** Observabilidade: descarte esporádico é jitter; descarte constante é rede ruim. */
  droppedFrames = 0;

  constructor(
    private readonly ctx: PcmPlaybackContext,
    opts: PcmPlaybackOptions = {},
  ) {
    this.target = opts.targetLatency ?? 0.06;
    this.max = opts.maxLatency ?? 0.24;
  }

  enqueue(data: ArrayBuffer | ArrayBufferView): void {
    if (this.closed) return;
    const pcm = int16LEToFloat32(data);
    if (pcm.length === 0) return;

    const now = this.ctx.currentTime;
    if (this.playhead <= now) {
      // Secou (primeiro quadro, ou silêncio longo). `<=` e não `<` porque
      // playhead igual a currentTime já é fila zerada — e no primeiro quadro os
      // dois valem 0. Reancorar com o colchão: agendar no passado faz o
      // navegador despejar tudo de uma vez.
      this.playhead = now + this.target;
    } else if (this.playhead - now > this.max) {
      this.droppedFrames++;
      return;
    }

    const buffer = this.ctx.createBuffer(1, pcm.length, PCM_SAMPLE_RATE);
    buffer.getChannelData(0).set(pcm);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      this.live.delete(source);
    };
    source.start(this.playhead);
    this.live.add(source);

    this.playhead += pcm.length / PCM_SAMPLE_RATE;
  }

  close(): void {
    this.closed = true;
    for (const source of this.live) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Já terminou sozinho entre o agendamento e o desligamento.
      }
    }
    this.live.clear();
    this.playhead = 0;
  }
}
