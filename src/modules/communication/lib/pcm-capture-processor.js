/**
 * Processador de captura do microfone da chamada de voz (AudioWorklet).
 *
 * ─── Por que este arquivo é .js solto, e não .ts do bundle ────────────────────
 * O escopo do AudioWorklet não é o da página: não tem `window`, não tem
 * `import`, e o módulo é carregado por URL via `audioWorklet.addModule()`. Ele
 * PRECISA existir como arquivo próprio no servidor. O `?url` no import do
 * `voicePcmSession.ts` faz o Vite servir este arquivo tal e qual no dev server e
 * emiti-lo como asset com hash no build de produção — a mesma URL funciona nos
 * dois, e o hash evita o cache velho depois de um deploy.
 *
 * ─── Por que worklet, e não ScriptProcessorNode ───────────────────────────────
 * ScriptProcessor está obsoleto e roda na THREAD PRINCIPAL: qualquer render do
 * React que segure a thread por 30 ms picota o áudio que está sendo enviado.
 * O worklet roda na thread de áudio, em tempo real, e não é afetado pela UI.
 *
 * ─── Por que ele resolve o problema do pacer da VPS ───────────────────────────
 * O pacer (`cmd/server/pacer.go`) derruba a chamada se receber mais de 16000
 * amostras/s sustentado por 3 s. Este processador não tem ritmo próprio: ele é
 * chamado pelo relógio de áudio do sistema, uma vez por quantum de renderização,
 * e por construção produz exatamente `sampleRate` amostras por segundo. O ritmo
 * do envio é o do tempo real porque é o do relógio de áudio — não porque alguém
 * escolheu um intervalo.
 */

/** Vale só se o chamador não passar nada; o valor real vem de processorOptions. */
const DEFAULT_FRAME_SAMPLES = 320;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const requested = options && options.processorOptions && options.processorOptions.frameSamples;
    this.frameSamples =
      typeof requested === "number" && requested > 0
        ? Math.floor(requested)
        : DEFAULT_FRAME_SAMPLES;
    this.frame = new Float32Array(this.frameSamples);
    this.filled = 0;
  }

  process(inputs) {
    // O quantum é de 128 amostras e o quadro tem 320: acumular é obrigatório,
    // senão sairiam 375 mensagens por segundo em vez de 50.
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      // Fonte ainda não conectada, ou faixa mutada de um jeito que o navegador
      // resolve entregando nada. Devolver `true` mantém o nó vivo — devolver
      // `false` o encerraria e o microfone morreria no meio da chamada.
      return true;
    }

    for (let i = 0; i < channel.length; i++) {
      this.frame[this.filled++] = channel[i];
      if (this.filled === this.frameSamples) {
        // Transferido, não copiado: o buffer sai daqui sem clone estruturado.
        // Por isso um Float32Array novo entra no lugar — o antigo fica destacado.
        const out = this.frame;
        this.port.postMessage(out, [out.buffer]);
        this.frame = new Float32Array(this.frameSamples);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("torquecalls-pcm-capture", PcmCaptureProcessor);
