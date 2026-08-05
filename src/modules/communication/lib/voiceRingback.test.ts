import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildIncomingRingCycle,
  buildRingbackCycle,
  INCOMING_RING_GAIN,
  INCOMING_RING_SEGMENTS,
  RINGBACK_FREQUENCY_HZ,
  RINGBACK_GAIN,
  RINGBACK_OFF_SECONDS,
  RINGBACK_ON_SECONDS,
  startIncomingRing,
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

describe("buildIncomingRingCycle — o toque de quem RECEBE", () => {
  /**
   * Conta quantas rajadas de som existem no ciclo, medindo o ENVELOPE.
   *
   * É a medição que separa as duas cadências de verdade. Comparar
   * `INCOMING_RING_SEGMENTS` com `[RINGBACK_ON, RINGBACK_OFF]` seria comparar
   * duas constantes — trocar uma pela outra moveria os dois lados junto e o
   * teste seguiria verde com o mesmo som nos dois casos.
   */
  function contarRajadas(samples: Float32Array, rate: number): number {
    const janela = Math.round(0.02 * rate); // 20 ms: contém picos de 425 Hz
    let rajadas = 0;
    let dentro = false;
    for (let i = 0; i + janela <= samples.length; i += janela) {
      const temSom = peakIn(samples, i, i + janela) > 1e-4;
      if (temSom && !dentro) rajadas++;
      dentro = temSom;
    }
    return rajadas;
  }

  it("são DUAS rajadas por ciclo, contra UMA do ringback", () => {
    // O que se afirma é o som, medido dos dois buffers — não a lista de
    // segmentos que os gerou.
    expect(contarRajadas(buildIncomingRingCycle(RATE), RATE)).toBe(2);
    expect(contarRajadas(buildRingbackCycle(RATE), RATE)).toBe(1);
  });

  it("o ciclo é mais curto que o do ringback — quem recebe não pode esperar 5 s", () => {
    expect(buildIncomingRingCycle(RATE).length).toBeLessThan(buildRingbackCycle(RATE).length);
  });

  it("mantém a portadora de 425 Hz — é o timbre da telefonia deste produto", () => {
    const cycle = buildIncomingRingCycle(RATE);
    // Mede dentro da primeira rajada, longe das rampas. Esperado = literal.
    const ms = (n: number) => Math.round((n / 1000) * RATE);
    const hz = measureHz(cycle, ms(50), ms(350), RATE);
    expect(hz).toBeGreaterThan(423);
    expect(hz).toBeLessThan(427);
  });

  it("o intervalo entre as rajadas é silêncio EXATO", () => {
    const cycle = buildIncomingRingCycle(RATE);
    const [ligado1, desligado1] = INCOMING_RING_SEGMENTS;
    const inicioDoVao = Math.round(ligado1 * RATE);
    const fimDoVao = Math.round((ligado1 + desligado1) * RATE);
    // Qualquer resíduo aqui vira zumbido contínuo no fone do vendedor.
    for (let i = inicioDoVao; i < fimDoVao; i++) expect(cycle[i]).toBe(0);
  });

  it("a pausa longa do fim é silêncio EXATO", () => {
    const cycle = buildIncomingRingCycle(RATE);
    const antesDaPausa = INCOMING_RING_SEGMENTS.slice(0, 3).reduce((a, b) => a + b, 0);
    for (let i = Math.round(antesDaPausa * RATE); i < cycle.length; i++) {
      expect(cycle[i]).toBe(0);
    }
  });

  it("é mais presente que o ringback, e ainda longe de estourar", () => {
    let picoEntrada = 0;
    for (const s of buildIncomingRingCycle(RATE)) picoEntrada = Math.max(picoEntrada, Math.abs(s));
    let picoSaida = 0;
    for (const s of buildRingbackCycle(RATE)) picoSaida = Math.max(picoSaida, Math.abs(s));

    // Alcançar quem não está olhando pede mais presença que confirmar uma ação
    // que o próprio vendedor acabou de tomar.
    expect(picoEntrada).toBeGreaterThan(picoSaida);
    // Mas continua discreto de verdade, não "1.0 com outro nome": ele convive
    // com a voz que vem logo depois.
    expect(picoEntrada).toBeLessThanOrEqual(INCOMING_RING_GAIN + 1e-6);
    expect(INCOMING_RING_GAIN).toBeLessThan(0.2);
  });

  it("cada rajada entra e sai em rampa — corte na unha vira estalo", () => {
    const cycle = buildIncomingRingCycle(RATE);
    const ms = (n: number) => Math.round((n / 1000) * RATE);
    const cheio = peakIn(cycle, ms(150), ms(155));

    // Subida da PRIMEIRA rajada.
    expect(peakIn(cycle, ms(0), ms(5))).toBeLessThan(peakIn(cycle, ms(5), ms(10)));
    expect(peakIn(cycle, ms(5), ms(10))).toBeLessThan(cheio);

    // Descida da SEGUNDA. Com duas rajadas por ciclo são QUATRO bordas, não
    // duas — quatro chances de estalo, e é por isso que testar só a primeira
    // não bastaria.
    const fimDaSegunda = Math.round(
      (INCOMING_RING_SEGMENTS[0] + INCOMING_RING_SEGMENTS[1] + INCOMING_RING_SEGMENTS[2]) * RATE,
    );
    expect(peakIn(cycle, fimDaSegunda - ms(5), fimDaSegunda)).toBeLessThan(
      peakIn(cycle, fimDaSegunda - ms(10), fimDaSegunda - ms(5)),
    );
  });

  it("acompanha a taxa de amostragem do dispositivo", () => {
    const rate = 44100;
    const cycle = buildIncomingRingCycle(rate);
    const total = INCOMING_RING_SEGMENTS.reduce((a, b) => a + b, 0);
    expect(cycle.length).toBe(Math.round(total * rate));

    const ms = (n: number) => Math.round((n / 1000) * rate);
    const hz = measureHz(cycle, ms(50), ms(350), rate);
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

// ─── a política de autoplay ──────────────────────────────────────────────────

/**
 * AudioContext BARRADO, do jeito que o navegador barra de verdade.
 *
 * MEDIDO em Chromium 147/macOS, numa página sem gesto nenhum:
 *   · `state` === `"suspended"` já na criação;
 *   · `resume()` devolve uma promessa que **NUNCA ASSENTA** — ainda estava
 *     pendente 3 s depois, sem resolver e sem rejeitar;
 *   · UM clique em qualquer lugar do documento a resolve retroativamente e leva
 *     o contexto a `running`.
 *
 * Este dublê PROJETA exatamente isso, e a promessa pendente é a parte que não
 * pode ser afrouxada: um dublê cujo `resume()` resolvesse na hora deixaria
 * passar uma detecção pendurada no `.then()` — que é a implementação óbvia, e é
 * a que nunca roda no navegador real. O toque ficaria mudo e ninguém saberia.
 */
function installBlockedAudioContext() {
  const channelData = new Map<object, Float32Array>();
  const source = {
    buffer: null as unknown,
    loop: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  /** Resolvedores das promessas de `resume()` que ainda não assentaram. */
  const pendentes: Array<() => void> = [];
  const ctx = {
    sampleRate: RATE,
    state: "suspended" as AudioContextState,
    destination: { name: "destination" },
    createBuffer: vi.fn((_ch: number, length: number, sampleRate: number) => {
      const buf = { length, sampleRate, getChannelData: () => channelData.get(buf)! };
      channelData.set(buf, new Float32Array(length));
      return buf;
    }),
    createBufferSource: vi.fn(() => source),
    resume: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          if (ctx.state === "running") resolve();
          else pendentes.push(resolve);
        }),
    ),
    close: vi.fn(async () => {}),
  };
  /** O que o gesto do usuário faz: destrava e resolve o que estava preso. */
  const liberarPeloGesto = () => {
    ctx.state = "running";
    for (const r of pendentes.splice(0)) r();
  };
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn(
    function AudioContextStub() {
      return ctx;
    },
  );
  return { ctx, source, liberarPeloGesto };
}

describe("startIncomingRing — o toque que NÃO nasce de um clique", () => {
  beforeEach(() => vi.clearAllMocks());

  it("toca a cadência de entrada, não a de saída", () => {
    const { ctx } = installAudioContext();

    const tone = startIncomingRing();

    const total = INCOMING_RING_SEGMENTS.reduce((a, b) => a + b, 0);
    expect(ctx.createBuffer).toHaveBeenCalledWith(1, Math.round(total * RATE), RATE);

    tone.stop();
  });

  // A garantia estrutural continua valendo para o tom novo: contexto PRÓPRIO,
  // porque a Web Audio proíbe conectar nós entre contextos e é isso que torna o
  // vazamento para o grafo de captura impossível, não apenas improvável.
  it("sai por um AudioContext próprio, sem tocar no grafo da captura", () => {
    const { ctx, source, ctor } = installAudioContext();

    const tone = startIncomingRing();

    expect(ctor).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledWith(ctx.destination);

    tone.stop();
  });

  /**
   * O TESTE QUE IMPORTA. Um toque que não soa é pior que nenhum, porque ninguém
   * descobre que ele existiu — e a promessa do `resume()` deste dublê nunca
   * assenta, exatamente como no navegador medido.
   */
  it("avisa que ficou mudo SEM esperar a promessa do resume, que nunca vem", () => {
    installBlockedAudioContext();
    const silenciou = vi.fn();
    const audivel = vi.fn();

    const tone = startIncomingRing({ onSilenced: silenciou, onAudible: audivel });

    // Síncrono: nem um `await` entre o início e o aviso.
    expect(silenciou).toHaveBeenCalledTimes(1);
    expect(audivel).not.toHaveBeenCalled();

    tone.stop();
  });

  it("um gesto em qualquer lugar da página destrava, e a tela é avisada", async () => {
    const { liberarPeloGesto } = installBlockedAudioContext();
    const silenciou = vi.fn();
    const audivel = vi.fn();

    const tone = startIncomingRing({ onSilenced: silenciou, onAudible: audivel });
    expect(silenciou).toHaveBeenCalled();

    // O ouvinte foi armado no `window`, em captura — para que um
    // `stopPropagation()` de qualquer componente não engula a única chance de
    // destravar o áudio.
    liberarPeloGesto();
    globalThis.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();

    expect(audivel).toHaveBeenCalled();

    tone.stop();
  });

  it("com o áudio já liberado, avisa que dá para ouvir e não arma gesto nenhum", () => {
    const { ctx } = installBlockedAudioContext();
    ctx.state = "running";
    const silenciou = vi.fn();
    const audivel = vi.fn();

    const tone = startIncomingRing({ onSilenced: silenciou, onAudible: audivel });

    expect(audivel).toHaveBeenCalledTimes(1);
    expect(silenciou).not.toHaveBeenCalled();

    tone.stop();
  });

  /**
   * O ouvinte de gesto é global. Sem soltá-lo no `stop()`, cada ligação que
   * chega numa aba muda deixa um para trás — e eles vão se acumulando sobre
   * contextos já fechados.
   */
  it("stop() solta o ouvinte de gesto que tinha armado", async () => {
    const { liberarPeloGesto } = installBlockedAudioContext();
    const audivel = vi.fn();

    const tone = startIncomingRing({ onAudible: audivel });
    tone.stop();

    liberarPeloGesto();
    globalThis.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    await Promise.resolve();

    // Nada acontece depois de parado: o tom já morreu, e avisar que ele "voltou
    // a ser audível" acenderia um aviso na tela para uma ligação que acabou.
    expect(audivel).not.toHaveBeenCalled();
  });

  it("navegador sem Web Audio também conta como mudo — e a tela precisa saber", () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
    const silenciou = vi.fn();

    const tone = startIncomingRing({ onSilenced: silenciou });

    expect(silenciou).toHaveBeenCalledTimes(1);
    expect(() => tone.stop()).not.toThrow();
  });
});
