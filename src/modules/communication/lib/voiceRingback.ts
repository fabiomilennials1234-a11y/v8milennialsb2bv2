/**
 * Os dois tons de telefonia do produto, no fone do operador.
 *
 *   · `startRingback`     — a chamada que SAI: o telefone do lead está tocando.
 *   · `startIncomingRing` — a chamada que ENTRA: alguém está ligando para nós.
 *
 * Nenhum dos dois vem do WhatsApp ou da VPS — nenhum dos dois manda áudio antes
 * de a chamada ser atendida —, então o navegador os SINTETIZA.
 *
 * ─── Por que os dois soam DIFERENTE ──────────────────────────────────────────
 * Porque significam ações opostas. O ringback diz "espere"; o toque de entrada
 * diz "atenda". Um vendedor que ouve o mesmo som nos dois casos não aprende
 * nada com o som, e passa a ter de olhar a tela — que é exatamente o que o tom
 * existe para evitar.
 *
 * E eles PODEM soar ao mesmo tempo: uma oferta de entrada chega enquanto o
 * vendedor disca. Com cadência idêntica, os dois 425 Hz batem um contra o outro
 * e viram um zumbido que não é nenhum dos dois.
 *
 * A portadora continua sendo a mesma (425 Hz, ver abaixo): é o timbre que o
 * ouvido já associa à telefonia deste produto. O que muda é a CADÊNCIA.
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
 * Cadência do toque de ENTRADA: dois toques curtos e uma pausa.
 *
 * Não é padrão de rede nenhum, e não finge ser — é decisão de produto, com dois
 * requisitos: ser reconhecível como "telefone tocando" (a rajada dupla é o que
 * quase todo aparelho do mundo faz, e o ouvido a lê sem aprender nada novo) e
 * ser INCONFUNDÍVEL com o ringback de 1 s / 4 s, que soa em resposta a uma ação
 * do próprio vendedor.
 *
 * O ciclo é mais curto que o do ringback (3 s contra 5 s) de propósito: quem
 * liga já sabe que está ligando e só espera; quem recebe pode não estar olhando,
 * e um lembrete a cada 5 s é tempo demais para uma oferta que dura segundos.
 */
export const INCOMING_RING_SEGMENTS = [0.4, 0.2, 0.4, 2.0] as const;

/**
 * O toque de entrada é ~3,5 dB mais presente que o ringback, e ainda ≈ -18 dBFS
 * — bem abaixo da conversa.
 *
 * A diferença tem razão: o ringback chega a um vendedor que ACABOU de clicar em
 * Ligar e está com os olhos na tela; o toque de entrada tem de alcançar alguém
 * que está escrevendo um e-mail. Discreto demais aqui não é elegância, é uma
 * ligação perdida.
 */
export const INCOMING_RING_GAIN = 0.12;

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
 * Um ciclo completo de uma cadência, em amostras — a parte que dá para provar
 * sem navegador.
 *
 * `segments` alterna LIGADO e DESLIGADO, em segundos, começando por um trecho
 * ligado: `[1, 4]` é o ringback; `[0.4, 0.2, 0.4, 2]` é o toque de entrada. Uma
 * cadência nova é uma lista nova, não um segundo laço — e é por isso que as
 * garantias que este arquivo carrega (rampa nas bordas, silêncio exato, fase
 * amarrada à taxa do dispositivo) valem para as duas sem serem escritas duas
 * vezes.
 *
 * A taxa vem do dispositivo e é respeitada: calcular a fase com 48 kHz fixo
 * desafinaria o tom em qualquer máquina a 44,1 kHz, e encurtaria a cadência
 * junto.
 */
export function buildTonePattern(
  sampleRate: number,
  segments: readonly number[],
  gain: number,
): Float32Array {
  // O total sai da soma em SEGUNDOS, não da soma dos segmentos já arredondados:
  // é assim que o ciclo fecha exatamente na duração anunciada, e é o que faz o
  // laço do `AudioBufferSourceNode` emendar sem derrapar a cada volta.
  const total = segments.reduce((soma, s) => soma + s, 0);
  const cycle = new Float32Array(Math.round(total * sampleRate));

  const rampSamples = Math.max(1, Math.round(RINGBACK_RAMP_SECONDS * sampleRate));
  const phaseStep = (2 * Math.PI * RINGBACK_FREQUENCY_HZ) / sampleRate;

  let cursor = 0;
  for (let s = 0; s < segments.length; s++) {
    const len = Math.round(segments[s] * sampleRate);
    // Índice PAR é trecho ligado; ímpar é silêncio — e silêncio é a ausência de
    // escrita, não um trecho preenchido com "quase zero". O buffer já nasce
    // zerado.
    if (s % 2 === 0) {
      for (let i = 0; i < len && cursor + i < cycle.length; i++) {
        // Envelope trapezoidal: sobe na primeira rampa, fica cheio, desce na
        // última. O `min` dos dois lados resolve o caso degenerado de um toque
        // mais curto que duas rampas sem precisar de ramo à parte.
        const rise = Math.min(1, i / rampSamples);
        const fall = Math.min(1, (len - 1 - i) / rampSamples);
        // A fase reinicia a cada rajada. É o que mantém todo trecho ligado
        // começando em sin(0) = 0, onde a rampa tem menos trabalho — e é o que
        // faz esta função devolver, para `[1, 4]`, exatamente o mesmo buffer que
        // a versão de uma rajada só devolvia.
        cycle[cursor + i] = Math.sin(phaseStep * i) * gain * Math.min(rise, fall);
      }
    }
    cursor += len;
  }

  return cycle;
}

/** A cadência de quem LIGA: 1 s tocando, 4 s em silêncio. */
export function buildRingbackCycle(sampleRate: number): Float32Array {
  return buildTonePattern(
    sampleRate,
    [RINGBACK_ON_SECONDS, RINGBACK_OFF_SECONDS],
    RINGBACK_GAIN,
  );
}

/** A cadência de quem RECEBE: duas rajadas curtas e uma pausa. */
export function buildIncomingRingCycle(sampleRate: number): Float32Array {
  return buildTonePattern(sampleRate, INCOMING_RING_SEGMENTS, INCOMING_RING_GAIN);
}

/** Handle inerte para quando não há Web Audio. Ver `startTone`. */
const SILENT: RingbackTone = { stop() {} };

/**
 * Gestos que a política de autoplay aceita como ativação. `capture: true` para
 * que um `stopPropagation()` de qualquer componente da árvore não engula a
 * única chance de destravar o áudio.
 */
const GESTOS = ["pointerdown", "keydown", "touchstart"] as const;

export interface ToneOptions {
  /**
   * O navegador NÃO deixou o tom soar. Quem chama tem de MOSTRAR isso: um toque
   * silencioso é pior que nenhum, porque ninguém descobre que ele existiu.
   */
  onSilenced?: () => void;
  /** O tom passou a soar — na hora, ou depois de o usuário encostar na página. */
  onAudible?: () => void;
}

/**
 * Começa a tocar uma cadência. Devolve na hora — nada aqui espera rede nem disco.
 *
 * Nunca lança. Um navegador sem Web Audio (ou com o contexto barrado) rende uma
 * chamada sem tom, que é pior; render uma exceção renderia um vendedor sem
 * chamada, que é muito pior. O tom é um conforto, não um pré-requisito — e por
 * isso ele é a única peça deste fluxo que NÃO impede a discagem ao falhar.
 *
 * ─── A política de autoplay, MEDIDA — e por que a detecção é SÍNCRONA ────────
 * Medido em Chromium 147/macOS, numa página sem gesto nenhum:
 *
 *   · `new AudioContext().state` === `"suspended"`, já na criação;
 *   · `ctx.resume()` devolve uma promessa que **NUNCA ASSENTA** — nem resolve
 *     nem rejeita, e ainda estava pendente 3 s depois;
 *   · o contexto segue `suspended` indefinidamente, e o console avisa
 *     "The AudioContext was not allowed to start";
 *   · UM clique em qualquer lugar do documento resolve retroativamente aquela
 *     promessa antiga e leva o contexto a `running` — e a partir daí todo
 *     contexto NOVO já nasce `running` (ativação pegajosa).
 *
 * A consequência é o que governa o desenho: **pendurar a detecção no `.then()`
 * do `resume()` é pendurá-la num callback que nunca roda.** Quem lê `ctx.state`
 * de forma síncrona descobre; quem espera a promessa fica esperando para
 * sempre, e o silêncio vira silêncio sobre o silêncio.
 *
 * Por isso: chama-se `resume()` (que resolve o caso comum, onde já há ativação),
 * confere-se `ctx.state` NA HORA, e — se estiver suspenso — avisa-se quem chamou
 * e arma-se um ouvinte de gesto que tenta de novo. O buffer já está tocando em
 * laço desde o `start()`: o relógio de um contexto suspenso não anda, então
 * quando ele destrava a cadência começa do início, não do meio.
 */
function startTone(cycle: (sampleRate: number) => Float32Array, opts?: ToneOptions): RingbackTone {
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctor) {
    // Sem Web Audio não há tom nenhum, e isso é exatamente o caso que
    // `onSilenced` existe para tornar visível.
    opts?.onSilenced?.();
    return SILENT;
  }

  let ctx: AudioContext;
  let source: AudioBufferSourceNode;
  try {
    ctx = new Ctor();

    const samples = cycle(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);

    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    // ÚNICA conexão deste módulo, e o destino é o alto-falante do PRÓPRIO
    // contexto. Qualquer outra aresta aqui é bug de vazamento.
    source.connect(ctx.destination);

    source.start();
  } catch {
    opts?.onSilenced?.();
    return SILENT;
  }

  let stopped = false;
  let destravar: ((this: unknown, ev: Event) => void) | null = null;

  const largarGesto = () => {
    if (!destravar) return;
    const ouvinte = destravar;
    destravar = null;
    for (const gesto of GESTOS) {
      try {
        globalThis.removeEventListener?.(gesto, ouvinte as EventListener, true);
      } catch {
        // Ambiente sem DOM. Nada a soltar.
      }
    }
  };

  /** Lê o estado AGORA. Ver o cabeçalho: a promessa do `resume` pode não vir. */
  const conferir = () => {
    if (stopped) return;
    if (ctx.state === "running") {
      largarGesto();
      opts?.onAudible?.();
      return;
    }
    opts?.onSilenced?.();
    armarGesto();
  };

  const armarGesto = () => {
    if (destravar || stopped) return;
    destravar = () => {
      // O gesto já aconteceu quando este ouvinte roda, então este `resume`
      // acontece DENTRO da ativação — que é o que a política exige.
      try {
        void ctx.resume?.().catch(() => {});
      } catch {
        // Contexto já fechado.
      }
      // Conferir no próximo tique: o `state` vira `running` na volta da
      // microtask, não dentro do próprio despacho do evento.
      queueMicrotask(conferir);
    };
    for (const gesto of GESTOS) {
      try {
        globalThis.addEventListener?.(gesto, destravar as EventListener, true);
      } catch {
        // Ambiente sem DOM: sem gesto para ouvir, o tom fica mudo e já foi dito.
      }
    }
  };

  try {
    void ctx.resume?.().catch(() => {});
  } catch {
    // Alguns navegadores lançam em vez de rejeitar. O `conferir` abaixo decide.
  }
  conferir();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      largarGesto();
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

/** Tom de quem LIGA. Nasce de um clique, então quase nunca é barrado. */
export function startRingback(opts?: ToneOptions): RingbackTone {
  return startTone(buildRingbackCycle, opts);
}

/**
 * Toque de quem RECEBE.
 *
 * Diferente do ringback em uma coisa que decide o desenho: **não há clique
 * antes dele.** A oferta chega sozinha, e se o documento ainda não foi tocado
 * desde que carregou, o navegador cala o tom sem erro nenhum. Por isso quem
 * chama daqui deve tratar `onSilenced` — ver `IncomingCallPanel`.
 */
export function startIncomingRing(opts?: ToneOptions): RingbackTone {
  return startTone(buildIncomingRingCycle, opts);
}
