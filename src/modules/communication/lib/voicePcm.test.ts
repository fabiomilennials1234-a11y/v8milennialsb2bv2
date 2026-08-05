/**
 * O formato do áudio é o CONTRATO com a VPS (`cmd/server/bridge.go`): Int16 LE,
 * 16 kHz, mono, nos dois sentidos. Não há negociação, não há cabeçalho, não há
 * número de sequência — só bytes. Um erro de escala ou de endianness aqui não
 * dá erro em lugar nenhum: a chamada conecta e sai ruído (ou silêncio).
 *
 * Por isso o que se testa aqui é o formato e o mecanismo, não "o áudio funciona".
 */
import { describe, expect, it } from "vitest";

import {
  LinearResampler,
  PCM_SAMPLE_RATE,
  PcmPlayback,
  float32ToInt16LE,
  int16LEToFloat32,
} from "./voicePcm";

/** Erro máximo de um passo de quantização em 16 bits. */
const ONE_LSB = 1 / 32768;

describe("float32ToInt16LE / int16LEToFloat32", () => {
  it("escreve little-endian, 2 bytes por amostra", () => {
    // 0.5 * 32768 = 16384 (0x4000). LE ⇒ byte baixo primeiro.
    const bytes = new Uint8Array(float32ToInt16LE(Float32Array.from([0.5])));
    expect(bytes.length).toBe(2);
    expect(bytes[0]).toBe(0x00);
    expect(bytes[1]).toBe(0x40);
  });

  it("preserva o sinal na ida e volta, dentro de um passo de quantização", () => {
    const input = Float32Array.from([0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 0.1234, -0.9]);
    const back = int16LEToFloat32(float32ToInt16LE(input));

    expect(back.length).toBe(input.length);
    input.forEach((v, i) => expect(Math.abs(back[i] - v)).toBeLessThanOrEqual(ONE_LSB));
  });

  it("mantém os extremos: -1 volta exato, +1 volta a um passo, 0 volta zero", () => {
    const back = int16LEToFloat32(float32ToInt16LE(Float32Array.from([1, -1, 0])));

    // −32768/32768 é exatamente −1. O positivo não tem simétrico em 16 bits:
    // o topo é 32767, então +1 volta um passo abaixo. Isso é a aritmética, não
    // um defeito — mas se alguém "consertar" com 32768 a amostra estoura para
    // −1 e o áudio ganha um estalo em cada pico.
    expect(back[1]).toBe(-1);
    expect(back[0]).toBeCloseTo(1, 4);
    expect(back[0]).toBeLessThan(1);
    expect(back[2]).toBe(0);
  });

  it("satura em vez de dar a volta quando o sinal passa de ±1", () => {
    const bytes = float32ToInt16LE(Float32Array.from([2, -2, 1.0001, -1.0001]));
    const view = new DataView(bytes);

    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
    expect(view.getInt16(4, true)).toBe(32767);
    expect(view.getInt16(6, true)).toBe(-32768);
  });

  it("arredonda para o inteiro mais próximo, não trunca", () => {
    // 0.00002 * 32767 = 0.65534. Truncar dá 0 (amostra some); arredondar dá 1.
    const view = new DataView(float32ToInt16LE(Float32Array.from([0.00002])));
    expect(view.getInt16(0, true)).toBe(1);
  });

  // Esta asserção NÃO discrimina o código atual: quem converte NaN em 0 é o
  // `DataView.setInt16`, não uma linha nossa (verificado por mutação — desligar
  // uma guarda `Number.isNaN` explícita não quebrava nada, e por isso a guarda
  // foi removida). Ela fica porque fixa a garantia da plataforma da qual o
  // formato depende: uma reescrita para aritmética de bytes crus escreveria
  // lixo aqui, e o lixo sairia como estalo na linha.
  it("converte NaN em silêncio em vez de propagar lixo", () => {
    const view = new DataView(float32ToInt16LE(Float32Array.from([NaN])));
    expect(view.getInt16(0, true)).toBe(0);
  });

  it("ignora um byte solto no fim em vez de ler além do buffer", () => {
    // 3 bytes = 1 amostra e meia. A metade não existe.
    expect(int16LEToFloat32(new Uint8Array([0, 0x40, 0x11]).buffer).length).toBe(1);
  });
});

describe("LinearResampler", () => {
  it("mantém a fase entre blocos ao decimar 48k → 16k", () => {
    const r = new LinearResampler(48000 / PCM_SAMPLE_RATE);
    // Rampa contínua partida em dois blocos de 10 — e 10 NÃO é múltiplo do
    // passo 3, de propósito. Com bloco múltiplo do passo a fase cai em zero na
    // emenda por acidente e o teste passa mesmo com o resampler reiniciando a
    // cada bloco (medido: essa era exatamente a versão cega desta asserção).
    const a = Float32Array.from({ length: 10 }, (_, i) => i);
    const b = Float32Array.from({ length: 10 }, (_, i) => i + 10);

    const out = [...r.process(a), ...r.process(b)];

    // Reiniciar a fase daria [..., 9, 10, 13, 16, 19]: a emenda encurta o passo
    // e vira um clique 50 vezes por segundo.
    expect(out).toEqual([0, 3, 6, 9, 12, 15, 18]);
  });

  it("interpola por cima da emenda usando a última amostra do bloco anterior", () => {
    // Interpolação 8k → 16k: a amostra nova entre blocos só existe se a última
    // do bloco anterior for guardada. Sem isso ela sai do nada (ou some).
    const r = new LinearResampler(0.5);

    const out = [...r.process(Float32Array.from([0, 2])), ...r.process(Float32Array.from([4, 6]))];

    // Rampa perfeita: o `3` é a amostra que cai exatamente na emenda.
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("devolve o mesmo número de amostras quando as taxas são iguais", () => {
    const r = new LinearResampler(1);
    const input = Float32Array.from({ length: 320 }, (_, i) => i / 320);
    expect(Array.from(r.process(input))).toEqual(Array.from(input));
  });
});

/** AudioContext de mentira: só o que o PcmPlayback usa, com relógio manual. */
function fakeContext() {
  const scheduled: Array<{ at: number; samples: number; rate: number; stopped: boolean }> = [];
  const ctx = {
    currentTime: 0,
    destination: {} as AudioNode,
    createBuffer(_ch: number, length: number, sampleRate: number) {
      return {
        length,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      } as unknown as AudioBuffer;
    },
    createBufferSource() {
      const node = {
        buffer: null as AudioBuffer | null,
        onended: null,
        connect: () => {},
        disconnect: () => {},
        start(at: number) {
          scheduled.push({
            at,
            samples: node.buffer?.length ?? 0,
            rate: node.buffer?.sampleRate ?? 0,
            stopped: false,
          });
        },
        stop() {
          const last = scheduled[scheduled.length - 1];
          if (last) last.stopped = true;
        },
      };
      return node as unknown as AudioBufferSourceNode;
    },
  };
  return { ctx, scheduled };
}

/** 60 ms de PCM — o mesmo tamanho de quadro que a VPS emite (960 amostras). */
function frame(samples = 960) {
  return float32ToInt16LE(new Float32Array(samples));
}

describe("PcmPlayback", () => {
  it("agenda o primeiro quadro com o colchão de latência, não em currentTime", () => {
    const { ctx, scheduled } = fakeContext();
    ctx.currentTime = 10;
    const p = new PcmPlayback(ctx, { targetLatency: 0.06, maxLatency: 0.24 });

    p.enqueue(frame());

    // Sem colchão o primeiro quadro já nasce atrasado e todo jitter vira falha.
    expect(scheduled[0].at).toBeCloseTo(10.06, 6);
    expect(scheduled[0].rate).toBe(PCM_SAMPLE_RATE);
  });

  it("encadeia os quadros seguintes sem folga entre eles", () => {
    const { ctx, scheduled } = fakeContext();
    const p = new PcmPlayback(ctx, { targetLatency: 0.06, maxLatency: 0.24 });

    p.enqueue(frame());
    ctx.currentTime = 0.06;
    p.enqueue(frame());

    // 960 amostras a 16 kHz = 60 ms exatos. Qualquer folga é um estalo audível.
    expect(scheduled[1].at).toBeCloseTo(scheduled[0].at + 0.06, 6);
  });

  it("descarta o quadro quando a fila passa do teto em vez de acumular atraso", () => {
    const { ctx, scheduled } = fakeContext();
    const p = new PcmPlayback(ctx, { targetLatency: 0.06, maxLatency: 0.12 });

    // Relógio parado: cada quadro empilha 60 ms à frente. O terceiro já passa
    // do teto de 120 ms e tem que morrer — segurar vira conversa atrasada, que
    // é pior que uma falha de 60 ms.
    p.enqueue(frame());
    p.enqueue(frame());
    p.enqueue(frame());
    p.enqueue(frame());

    expect(scheduled.length).toBe(2);
    expect(p.droppedFrames).toBe(2);
  });

  it("reancora no colchão depois de secar, em vez de agendar no passado", () => {
    const { ctx, scheduled } = fakeContext();
    const p = new PcmPlayback(ctx, { targetLatency: 0.06, maxLatency: 0.24 });

    p.enqueue(frame());
    ctx.currentTime = 5; // silêncio longo: a fila secou faz tempo
    p.enqueue(frame());

    // Agendar em 0.06 (o playhead velho) tocaria no passado — o navegador toca
    // tudo de uma vez e o áudio sai picotado.
    expect(scheduled[1].at).toBeCloseTo(5.06, 6);
  });

  it("ignora mensagem vazia", () => {
    const { ctx, scheduled } = fakeContext();
    const p = new PcmPlayback(ctx, { targetLatency: 0.06, maxLatency: 0.24 });

    p.enqueue(new ArrayBuffer(0));

    expect(scheduled.length).toBe(0);
  });

  it("close() para o que já estava agendado", () => {
    const { ctx, scheduled } = fakeContext();
    const p = new PcmPlayback(ctx, { targetLatency: 0.06, maxLatency: 0.24 });

    p.enqueue(frame());
    p.close();

    // Sem isto o áudio remoto continua saindo depois de desligar.
    expect(scheduled[0].stopped).toBe(true);
  });
});
