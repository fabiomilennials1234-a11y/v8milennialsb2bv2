/**
 * Caminho de áudio da chamada de voz, do lado do navegador.
 *
 * A VPS não troca mídia RTP com o navegador: ela carrega PCM cru pelos dois
 * sentidos de UM canal de dados rotulado `pcm` (ver `cmd/server/bridge.go`).
 * Este módulo é a ponta do navegador desse transporte — captura do microfone a
 * 16 kHz e reprodução do que chega —, e não sabe nada sobre WebRTC de propósito:
 * quem cria o canal e quem o fecha é o `useVoiceCall`.
 *
 * O AudioContext vive aqui, fora da árvore do React, pela mesma razão que o
 * `<audio>` antigo vivia fora dela: um remount do painel de chamada destruiria o
 * grafo de áudio no meio da conversa. Só um `stop()` explícito o derruba.
 */
import workletUrl from "./pcm-capture-processor.js?url";

import {
  CAPTURE_FRAME_SAMPLES,
  LinearResampler,
  PCM_CAPTURE_PROCESSOR,
  PCM_SAMPLE_RATE,
  PcmPlayback,
  float32ToInt16LE,
} from "./voicePcm";

export interface PcmAudioSession {
  /** Entrega uma mensagem do canal `pcm` (Int16 LE, 16 kHz) para reprodução. */
  enqueue(data: ArrayBuffer | ArrayBufferView): void;
  /** Derruba captura e reprodução. Idempotente. NÃO mexe no microfone nem no canal. */
  stop(): void;
}

export interface StartPcmAudioOptions {
  /** Microfone já concedido. As faixas continuam pertencendo a quem chamou. */
  stream: MediaStream;
  /** Recebe cada quadro de 20 ms pronto para ir no canal. */
  send: (frame: ArrayBuffer) => void;
}

/**
 * Monta o caminho de áudio e devolve o controle dele.
 *
 * Lança se o navegador não suportar AudioWorklet. Quem chama tem que tratar isso
 * ANTES de discar: uma chamada sem áudio gasta cota, toca o telefone do lead e
 * não serve para nada.
 */
export async function startPcmAudio({
  stream,
  send,
}: StartPcmAudioOptions): Promise<PcmAudioSession> {
  // Pedir 16 kHz faz o próprio navegador reamostrar a captura e a reprodução.
  // Chromium e Firefox honram; Safari antigo pode devolver a taxa do dispositivo
  // — daí a checagem logo abaixo, em vez de confiar.
  const ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });

  let stopped = false;
  const teardown = () => {
    stopped = true;
    void ctx.close().catch(() => {});
  };

  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } catch (err) {
    teardown();
    throw err;
  }

  // `getUserMedia` concedido já vale como ativação do usuário na política de
  // autoplay do Chromium, mas um contexto suspenso não chama `process()` e a
  // chamada ficaria muda sem nenhum erro. Custa nada garantir.
  void ctx.resume().catch(() => {});

  const nativeRate = ctx.sampleRate;
  const needsResample = Math.abs(nativeRate - PCM_SAMPLE_RATE) > 1;
  const resampler = needsResample ? new LinearResampler(nativeRate / PCM_SAMPLE_RATE) : null;
  // O quadro é medido em amostras da TAXA NATIVA para que, depois de reamostrar,
  // dê os 20 ms de sempre. Sem isto, um contexto de 48 kHz mandaria quadros de
  // 6,7 ms e triplicaria as mensagens no canal.
  const frameSamples = needsResample
    ? Math.round((CAPTURE_FRAME_SAMPLES * nativeRate) / PCM_SAMPLE_RATE)
    : CAPTURE_FRAME_SAMPLES;

  let source: MediaStreamAudioSourceNode;
  let node: AudioWorkletNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, PCM_CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { frameSamples },
    });
  } catch (err) {
    teardown();
    throw err;
  }

  node.port.onmessage = (ev: MessageEvent) => {
    if (stopped) return;
    const captured = ev.data as Float32Array;
    if (!captured || captured.length === 0) return;
    const pcm = resampler ? resampler.process(captured) : captured;
    if (pcm.length === 0) return;
    send(float32ToInt16LE(pcm));
  };

  source.connect(node);
  // O nó só é processado se estiver no grafo que sai no destino. Ele não escreve
  // nada na saída, então o que chega ao alto-falante por este ramo é silêncio —
  // não há realimentação do microfone.
  node.connect(ctx.destination);

  const playback = new PcmPlayback(ctx);

  return {
    enqueue(data) {
      if (!stopped) playback.enqueue(data);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        // Grafo já desmontado pelo close() de um teardown concorrente.
      }
      playback.close();
      void ctx.close().catch(() => {});
    },
  };
}
