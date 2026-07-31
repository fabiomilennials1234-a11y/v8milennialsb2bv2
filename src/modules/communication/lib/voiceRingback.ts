/**
 * Tom de chamada (ringback) no fone do operador.
 *
 * O som que o vendedor ouve enquanto o telefone do lead toca. Ele não vem do
 * WhatsApp nem da VPS — nenhum dos dois manda áudio antes de a chamada ser
 * atendida —, então o navegador o SINTETIZA.
 *
 * ─── A garantia que governa este arquivo ─────────────────────────────────────
 * O tom é para o OPERADOR ouvir, e não pode encostar no áudio que vai para o
 * WhatsApp. Se vazar para a captura, a pessoa do outro lado passa a ouvir o
 * próprio tom de chamada — pior que não ter som nenhum, e do tipo de defeito que
 * ninguém reporta direito porque só quem está do lado de lá percebe.
 *
 * A defesa é estrutural, não disciplinar: este módulo cria o PRÓPRIO
 * AudioContext. O grafo de captura (`voicePcmSession.ts`) vive em outro, e a Web
 * Audio API PROÍBE conectar nós entre contextos distintos — `connect()` lança
 * `InvalidAccessError`. O vazamento deixa de depender de alguém lembrar de não
 * fazê-lo e passa a ser recusado pela plataforma.
 *
 * (Mesmo dentro de um contexto só o vazamento exigiria erro grosseiro: o
 * worklet de captura só lê o que está conectado à ENTRADA dele, e ali só entra o
 * microfone. Mas "exigiria erro grosseiro" é uma garantia mais fraca que
 * "impossível", e esta é barata.)
 *
 * ─── Por que um buffer em laço, e não OscillatorNode ─────────────────────────
 * Os dois sintetizam — nenhum baixa arquivo, nenhum passa pela `media-src` da
 * CSP. A diferença está na CADÊNCIA.
 *
 * O tom brasileiro não é contínuo: é 1 s ligado e 4 s desligado, para sempre,
 * até alguém atender. Com `OscillatorNode` isso vira automação de ganho, e
 * automação de `AudioParam` é sempre FINITA — não existe primitiva de laço.
 * Manter a cadência exigiria um `setInterval` reagendando o ganho, e temporizador
 * de JS é estrangulado quando a aba vai para segundo plano (Chromium clampeia
 * para 1 s ou mais). O vendedor que troca de aba enquanto o telefone toca
 * ouviria o tom picotado ou mudo.
 *
 * Um `AudioBufferSourceNode` com `loop = true` repete no relógio de ÁUDIO, com
 * precisão de amostra, sem nenhum temporizador e sem limite de duração. A
 * cadência inteira — inclusive as rampas — vira uma função pura, testável sem
 * navegador.
 */

/**
 * 425 Hz é o tom de chamada nacional (o mesmo da rede fixa brasileira). Não é
 * escolha estética: um tom fora do padrão soa como defeito do sistema, e o
 * vendedor não tem como saber que aquilo é o "normal" deste produto.
 */
export const RINGBACK_FREQUENCY_HZ = 425;

/** Cadência brasileira: 1 s tocando, 4 s em silêncio. */
export const RINGBACK_ON_SECONDS = 1;
export const RINGBACK_OFF_SECONDS = 4;

/**
 * ≈ -22 dBFS. Vai direto no fone de quem está de headset o dia inteiro, e ele
 * precisa CONVIVER com a voz que vem logo depois — um tom mais alto que a
 * conversa faz o operador baixar o volume do sistema e depois não escutar o
 * cliente. Discreto e presente, não chamativo.
 */
export const RINGBACK_GAIN = 0.08;

/**
 * Rampa de entrada e saída de cada toque.
 *
 * Senóide que começa e termina na unha é uma descontinuidade, e descontinuidade
 * é transiente de banda larga: sai um "tec" audível a cada borda, dois por
 * ciclo. 10 ms é curto demais para mudar o ataque percebido e longo o bastante
 * para matar o estalo.
 */
export const RINGBACK_RAMP_SECONDS = 0.01;

export interface RingbackTone {
  /** Cala o tom e libera o dispositivo de áudio. Idempotente. */
  stop(): void;
}

/**
 * Um ciclo completo da cadência, em amostras — a parte que dá para provar sem
 * navegador.
 *
 * A taxa vem do dispositivo e é respeitada: calcular a fase com 48 kHz fixo
 * desafinaria o tom em qualquer máquina a 44,1 kHz, e encurtaria a cadência
 * junto.
 */
export function buildRingbackCycle(sampleRate: number): Float32Array {
  const onSamples = Math.round(RINGBACK_ON_SECONDS * sampleRate);
  const totalSamples = Math.round((RINGBACK_ON_SECONDS + RINGBACK_OFF_SECONDS) * sampleRate);

  // O resto do buffer já nasce zerado: os 4 s de silêncio são a ausência de
  // escrita, não um trecho preenchido com "quase zero".
  const cycle = new Float32Array(totalSamples);

  const rampSamples = Math.max(1, Math.round(RINGBACK_RAMP_SECONDS * sampleRate));
  const phaseStep = (2 * Math.PI * RINGBACK_FREQUENCY_HZ) / sampleRate;

  for (let i = 0; i < onSamples; i++) {
    // Envelope trapezoidal: sobe na primeira rampa, fica cheio, desce na última.
    // O `min` dos dois lados resolve o caso degenerado de um toque mais curto
    // que duas rampas sem precisar de ramo à parte.
    const rise = Math.min(1, i / rampSamples);
    const fall = Math.min(1, (onSamples - 1 - i) / rampSamples);
    cycle[i] = Math.sin(phaseStep * i) * RINGBACK_GAIN * Math.min(rise, fall);
  }

  return cycle;
}

/** Handle inerte para quando não há Web Audio. Ver `startRingback`. */
const SILENT: RingbackTone = { stop() {} };

/**
 * Começa a tocar. Devolve na hora — nada aqui espera rede nem disco.
 *
 * Nunca lança. Um navegador sem Web Audio (ou com o contexto barrado) rende uma
 * chamada sem tom, que é pior; render uma exceção renderia um vendedor sem
 * chamada, que é muito pior. O tom é um conforto, não um pré-requisito — e por
 * isso ele é a única peça deste fluxo que NÃO impede a discagem ao falhar.
 */
export function startRingback(): RingbackTone {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) return SILENT;

  let ctx: AudioContext;
  let source: AudioBufferSourceNode;
  try {
    ctx = new Ctor();

    const cycle = buildRingbackCycle(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, cycle.length, ctx.sampleRate);
    buffer.getChannelData(0).set(cycle);

    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // ÚNICA conexão deste módulo, e o destino é o alto-falante do PRÓPRIO
    // contexto. Qualquer outra aresta aqui é bug de vazamento.
    source.connect(ctx.destination);

    // O clique em "Ligar" já é ativação do usuário, então o contexto deve nascer
    // liberado — mas política de autoplay varia por navegador e por configuração
    // do site, e um contexto suspenso é silêncio sem erro nenhum. Custa nada.
    void ctx.resume?.().catch(() => {});

    source.start();
  } catch {
    return SILENT;
  }

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Nó já derrubado. O `close` abaixo é o que realmente garante silêncio.
      }
      // Garantia de último recurso: mesmo que parar o nó falhe, fechar o
      // contexto libera o dispositivo. Tom vazado toca para sempre e não sobra
      // ninguém com referência para calá-lo.
      void ctx.close?.().catch(() => {});
    },
  };
}
