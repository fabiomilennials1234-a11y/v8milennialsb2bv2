import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRingbackCycle,
  RINGBACK_FREQUENCY_HZ,
  RINGBACK_GAIN,
  RINGBACK_OFF_SECONDS,
  RINGBACK_ON_SECONDS,
  startRingback,
} from "./voiceRingback";

const RATE = 48000;

/**
 * Conta cruzamentos de zero para MEDIR a frequência que saiu do buffer.
 *
 * O valor esperado é sempre o literal `425`, nunca `RINGBACK_FREQUENCY_HZ`.
 * Comparar a medição contra a constante que gerou o sinal é a constante
 * confirmando a si mesma: trocar 425 por 440 moveria os dois lados junto e o
 * teste seguiria verde com o tom errado. (Verificado por mutação — a primeira
 * versão deste arquivo fazia exatamente isso e passava.)
 */
function measureHz(samples: Float32Array, from: number, to: number, rate: number): number {
  let crossings = 0;
  for (let i = from + 1; i < to; i++) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) {
      crossings++;
    }
  }
  return crossings / 2 / ((to - from) / rate);
}

/** Maior amplitude absoluta numa janela — o envelope, amostrado. */
function peakIn(samples: Float32Array, from: number, to: number): number {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

describe("buildRingbackCycle", () => {
  it("dura um ciclo inteiro da cadência", () => {
    const cycle = buildRingbackCycle(RATE);
    expect(cycle.length).toBe((RINGBACK_ON_SECONDS + RINGBACK_OFF_SECONDS) * RATE);
  });

  it("emite 425 Hz — o tom nacional, não um tom qualquer", () => {
    const cycle = buildRingbackCycle(RATE);
    // Mede longe das rampas, onde o sinal é senóide pura. Esperado = literal.
    const hz = measureHz(cycle, Math.round(0.1 * RATE), Math.round(0.9 * RATE), RATE);
    expect(hz).toBeGreaterThan(423);
    expect(hz).toBeLessThan(427);
    // E a constante publicada é a que o padrão manda — quem lê o módulo não
    // precisa medir para saber.
    expect(RINGBACK_FREQUENCY_HZ).toBe(425);
  });

  it("toca 1s e cala 4s — a cadência brasileira", () => {
    const cycle = buildRingbackCycle(RATE);
    const onSamples = RINGBACK_ON_SECONDS * RATE;

    // Trecho ligado: tem sinal.
    let peakOn = 0;
    for (let i = 0; i < onSamples; i++) peakOn = Math.max(peakOn, Math.abs(cycle[i]));
    expect(peakOn).toBeGreaterThan(0);

    // Trecho desligado: silêncio EXATO. Qualquer resíduo aqui vira zumbido de
    // 4 segundos no fone do vendedor a cada ciclo.
    for (let i = onSamples; i < cycle.length; i++) {
      expect(cycle[i]).toBe(0);
    }
  });

  it("não estoura o volume — vai direto no fone do operador", () => {
    const cycle = buildRingbackCycle(RATE);
    let peak = 0;
    for (const s of cycle) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeLessThanOrEqual(RINGBACK_GAIN + 1e-6);
    // E o teto escolhido é discreto de verdade, não "1.0 com outro nome".
    expect(RINGBACK_GAIN).toBeLessThan(0.15);
  });

  it("entra e sai em rampa — senóide cortada na unha vira estalo", () => {
    const cycle = buildRingbackCycle(RATE);
    const onSamples = RINGBACK_ON_SECONDS * RATE;
    const ms = (n: number) => Math.round((n / 1000) * RATE);

    // Um degrau de amplitude é uma descontinuidade, e descontinuidade é um
    // transiente de banda larga: o operador ouve "tec" a cada borda, dois por
    // ciclo. Testar só `cycle[0] ≈ 0` NÃO pega isso — uma senóide sem envelope
    // também começa em zero, porque sin(0) = 0. (Verificado por mutação: a
    // primeira versão deste teste passava com a rampa removida.)
    //
    // O que caracteriza a rampa é o ENVELOPE crescendo ao longo dela. Cada
    // janela tem 5 ms, o bastante para conter pelo menos um pico da senóide de
    // 425 Hz (período 2,35 ms).
    const cheio = peakIn(cycle, ms(400), ms(405));
    expect(peakIn(cycle, ms(0), ms(5))).toBeLessThan(peakIn(cycle, ms(5), ms(10)));
    expect(peakIn(cycle, ms(5), ms(10))).toBeLessThan(cheio);

    // Simétrico na saída: o toque MORRE em rampa, não cortado.
    const fimA = peakIn(cycle, onSamples - ms(10), onSamples - ms(5));
    const fimB = peakIn(cycle, onSamples - ms(5), onSamples);
    expect(fimB).toBeLessThan(fimA);
    expect(fimA).toBeLessThan(cheio);

    // E no platô a amplitude é cheia — uma rampa que nunca sobe seria "sem
    // estalo" pelo caminho errado.
    expect(cheio).toBeGreaterThan(RINGBACK_GAIN * 0.95);
  });

  it("acompanha a taxa de amostragem do dispositivo", () => {
    // Um dispositivo a 44,1 kHz não pode receber um tom desafinado nem uma
    // cadência mais curta só porque o cálculo assumiu 48 kHz. Medir a
    // frequência AQUI é o que pega um `sampleRate` trocado por literal dentro
    // do cálculo de fase — só conferir o comprimento do buffer não pega.
    const rate = 44100;
    const cycle = buildRingbackCycle(rate);
    expect(cycle.length).toBe((RINGBACK_ON_SECONDS + RINGBACK_OFF_SECONDS) * rate);

    const hz = measureHz(cycle, Math.round(0.1 * rate), Math.round(0.9 * rate), rate);
    expect(hz).toBeGreaterThan(423);
    expect(hz).toBeLessThan(427);
  });
});

/** AudioContext de mentira: jsdom não tem Web Audio. */
function installAudioContext() {
  const channelData = new Map<object, Float32Array>();
  const source = {
    buffer: null as unknown,
    loop: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const ctx = {
    sampleRate: RATE,
    state: "suspended",
    destination: { name: "destination" },
    createBuffer: vi.fn((_ch: number, length: number, sampleRate: number) => {
      const buf = { length, sampleRate, getChannelData: () => channelData.get(buf)! };
      channelData.set(buf, new Float32Array(length));
      return buf;
    }),
    createBufferSource: vi.fn(() => source),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const ctor = vi.fn(function AudioContextStub() {
    return ctx;
  });
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = ctor;
  return { ctx, source, ctor, channelData };
}

describe("startRingback", () => {
  beforeEach(() => vi.clearAllMocks());

  // A garantia que mais importa deste arquivo inteiro. O tom é para o OPERADOR
  // ouvir. Se ele encostar no grafo de captura, a pessoa do outro lado passa a
  // ouvir o próprio tom de chamada — que é pior que não ter som nenhum.
  it("sai por um AudioContext PRÓPRIO, sem tocar no grafo da captura", () => {
    const { ctx, source, ctor } = installAudioContext();

    const tone = startRingback();

    expect(ctor).toHaveBeenCalledTimes(1);
    // Um único destino, e ele é o alto-falante deste contexto. Web Audio proíbe
    // conectar nós entre contextos diferentes (lança InvalidAccessError), então
    // o vazamento para o worklet de captura deixa de ser convenção e passa a ser
    // impossível pela plataforma.
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledWith(ctx.destination);

    tone.stop();
  });

  it("repete a cadência para sempre, sem depender de relógio de JS", () => {
    const { source } = installAudioContext();

    const tone = startRingback();

    // `loop` no próprio nó de áudio: a repetição é feita pelo relógio de áudio,
    // com precisão de amostra. Um `setInterval` reagendando o tom derrapa e é
    // estrangulado quando a aba vai para segundo plano — e o vendedor que trocou
    // de aba enquanto o telefone toca perderia o som ou ouviria picotado.
    expect(source.loop).toBe(true);
    expect(source.start).toHaveBeenCalled();

    tone.stop();
  });

  it("carrega no buffer o ciclo de verdade, não silêncio", () => {
    const { ctx, channelData } = installAudioContext();

    const tone = startRingback();

    expect(ctx.createBuffer).toHaveBeenCalledWith(1, (1 + 4) * RATE, RATE);
    const written = [...channelData.values()][0];
    let peak = 0;
    for (const s of written) peak = Math.max(peak, Math.abs(s));
    expect(peak).toBeCloseTo(RINGBACK_GAIN, 2);

    tone.stop();
  });

  it("destrava o contexto suspenso pela política de autoplay", () => {
    const { ctx } = installAudioContext();

    const tone = startRingback();

    expect(ctx.resume).toHaveBeenCalled();

    tone.stop();
  });

  it("stop() cala e fecha o contexto", () => {
    const { ctx, source } = installAudioContext();

    startRingback().stop();

    expect(source.stop).toHaveBeenCalled();
    // Fechar o contexto é a garantia de último recurso: mesmo que o `stop()` do
    // nó falhe, o dispositivo de áudio é liberado. Oscilador vazado toca para
    // sempre, e ninguém tem como calá-lo depois.
    expect(ctx.close).toHaveBeenCalled();
  });

  it("stop() é idempotente", () => {
    const { ctx } = installAudioContext();

    const tone = startRingback();
    tone.stop();
    tone.stop();

    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("navegador sem Web Audio não derruba a chamada", () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;

    // Sem tom é uma chamada pior; sem chamada é um vendedor parado. O tom nunca
    // pode ser o que impede alguém de ligar.
    const tone = startRingback();
    expect(() => tone.stop()).not.toThrow();
  });
});
