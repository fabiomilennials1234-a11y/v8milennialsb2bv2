/**
 * WebM/Opus → Ogg/Opus. REMUX, não recodificação.
 *
 * ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
 *
 * A Cloud API da Meta recusou, duas vezes, o áudio gravado pelo navegador —
 * `131053 Media upload error: uploaded with mimetype as audio/mp4, however on
 * processing it is of type application/octet-stream`. A primeira suspeita foi o
 * codec (Opus dentro de MP4); pedimos AAC explícito e a recusa se repetiu, com o
 * arquivo já em AAC.
 *
 * A causa está na ESTRUTURA: o `MediaRecorder` do Chromium grava **MP4
 * fragmentado** (`moof`/`traf`), e o processador da Meta não o reconhece. Não há
 * combinação de codec que resolva — o container é o problema, e o Chrome não
 * escreve nenhum dos containers progressivos que a Meta aceita.
 *
 * O que ele escreve bem é WebM/Opus. E a Meta aceita `.ogg` com OPUS, que é
 * também o ÚNICO formato que ela aceita para NOTA DE VOZ. Os mesmos pacotes
 * Opus, em outro container: nenhuma perda de qualidade, nenhum custo de
 * codificação — só reempacotamento.
 *
 * ─── O QUE ESTE ARQUIVO NÃO FAZ ─────────────────────────────────────────────
 *
 * Não decodifica áudio, não converte codec, não cobre WebM em geral. Cobre o
 * subconjunto que um gravador de navegador produz: uma trilha de áudio Opus,
 * clusters com SimpleBlock. Qualquer coisa fora disso levanta erro com o motivo —
 * silêncio aqui viraria arquivo corrompido do outro lado, que é o defeito que
 * este arquivo existe para acabar.
 */

/** IDs EBML que interessam. O resto é pulado pelo tamanho declarado. */
const ID = {
  SEGMENT: 0x18538067,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  CODEC_ID: 0x86,
  CODEC_PRIVATE: 0x63a2,
  INFO: 0x1549a966,
  TIMECODE_SCALE: 0x2ad7b1,
  DURATION: 0x4489,
  CLUSTER: 0x1f43b675,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
} as const;

/** Elementos "mestres": entramos neles em vez de pular o conteúdo. */
const MESTRES = new Set<number>([
  ID.SEGMENT,
  ID.TRACKS,
  ID.INFO,
  ID.TRACK_ENTRY,
  ID.CLUSTER,
  ID.BLOCK_GROUP,
]);

export class WebmOpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebmOpusError";
  }
}

interface Leitor {
  bytes: Uint8Array;
  pos: number;
}

/**
 * VINT do EBML. `comMarcador` mantém o bit de comprimento (IDs) ou o remove
 * (tamanhos) — a mesma codificação com dois significados, e trocá-los produz
 * deslocamento silencioso no arquivo inteiro.
 */
function lerVint(r: Leitor, comMarcador: boolean): number {
  if (r.pos >= r.bytes.length) throw new WebmOpusError("fim inesperado do arquivo");
  const primeiro = r.bytes[r.pos];
  let largura = 1;
  while (largura <= 8 && !(primeiro & (0x80 >> (largura - 1)))) largura++;
  if (largura > 8) throw new WebmOpusError("VINT inválido no cabeçalho EBML");

  let valor = comMarcador ? primeiro : primeiro & (0xff >> largura);
  for (let i = 1; i < largura; i++) {
    valor = valor * 256 + r.bytes[r.pos + i];
  }
  r.pos += largura;
  return valor;
}

/**
 * A duração de um pacote Opus, em amostras de 48 kHz, lida do TOC.
 *
 * É o que alimenta o `granulepos` das páginas Ogg. Um granule errado não
 * corrompe o arquivo, mas faz o player exibir duração errada — e no WhatsApp a
 * barra da nota de voz sai truncada.
 */
export function duracaoDoPacoteOpus(pacote: Uint8Array): number {
  if (pacote.length === 0) throw new WebmOpusError("pacote Opus vazio");
  const toc = pacote[0];
  const config = toc >> 3;
  const code = toc & 0b11;

  // Tabela do RFC 6716 §3.1: cada configuração declara o tamanho do quadro.
  const ms =
    config < 12
      ? [10, 20, 40, 60][config % 4]
      : config < 16
        ? [10, 20][config % 2]
        : [2.5, 5, 10, 20][config % 4];

  const quadros =
    code === 0 ? 1
      : code === 1 || code === 2 ? 2
        : pacote.length >= 2 ? pacote[1] & 0x3f : 1;

  return Math.round(ms * 48 * quadros);
}

// ─── Escrita Ogg ─────────────────────────────────────────────────────────────

/**
 * CRC do Ogg: polinômio 0x04c11db7, SEM reflexão e SEM xor final.
 *
 * ⚠️ NÃO é o CRC-32 comum (o do zip/png, refletido). Usar o de prateleira produz
 * um arquivo que abre em players tolerantes e é recusado por validadores — o pior
 * dos mundos, porque parece funcionar no teste manual.
 */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    }
    t[i] = r >>> 0;
  }
  return t;
})();

function crcOgg(dados: Uint8Array): number {
  let crc = 0;
  for (const b of dados) {
    crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

interface PaginaOgg {
  /** Pacotes COMPLETOS nesta página. O gravador de navegador não produz pacote
   *  maior que uma página, então não há continuação — e o código recusa o caso
   *  em vez de fingir que cobriu. */
  pacotes: Uint8Array[];
  granule: number;
  sequencia: number;
  serial: number;
  bos: boolean;
  eos: boolean;
}

function montarPagina(p: PaginaOgg): Uint8Array {
  const lacing: number[] = [];
  for (const pacote of p.pacotes) {
    let restante = pacote.length;
    while (restante >= 255) {
      lacing.push(255);
      restante -= 255;
    }
    lacing.push(restante);
  }
  if (lacing.length > 255) {
    throw new WebmOpusError("pacotes demais para uma página Ogg");
  }

  const corpo = p.pacotes.reduce((n, x) => n + x.length, 0);
  const pagina = new Uint8Array(27 + lacing.length + corpo);
  const dv = new DataView(pagina.buffer);

  pagina.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  pagina[4] = 0; // versão
  pagina[5] = (p.bos ? 0x02 : 0) | (p.eos ? 0x04 : 0);

  // granulepos é 64 bits little-endian. Escrito em duas metades porque o alvo do
  // build não garante BigInt64 no DataView.
  dv.setUint32(6, p.granule >>> 0, true);
  dv.setUint32(10, Math.floor(p.granule / 0x100000000) >>> 0, true);

  dv.setUint32(14, p.serial >>> 0, true);
  dv.setUint32(18, p.sequencia >>> 0, true);
  dv.setUint32(22, 0, true); // CRC entra depois, com o campo zerado
  pagina[26] = lacing.length;
  pagina.set(lacing, 27);

  let off = 27 + lacing.length;
  for (const pacote of p.pacotes) {
    pagina.set(pacote, off);
    off += pacote.length;
  }

  dv.setUint32(22, crcOgg(pagina), true);
  return pagina;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("torque-crm");
  const out = new Uint8Array(8 + 4 + vendor.length + 4);
  out.set(new TextEncoder().encode("OpusTags"), 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(8, vendor.length, true);
  out.set(vendor, 12);
  dv.setUint32(12 + vendor.length, 0, true); // zero comentários
  return out;
}

// ─── Leitura WebM ────────────────────────────────────────────────────────────

interface TrilhaOpus {
  numero: number;
  opusHead: Uint8Array;
}

/**
 * `pre_skip` do OpusHead — amostras que o decodificador descarta no INÍCIO.
 *
 * Entra em toda `granulepos` porque o mapeamento Ogg/Opus define o granule como
 * "amostras a decodificar INCLUINDO o pre-skip". Sem somá-lo, o decodificador
 * corta esse tanto no FIM: a nota de voz perde os últimos milissegundos, que é
 * onde costuma estar o fim da palavra.
 */
function preSkipDe(opusHead: Uint8Array): number {
  return opusHead.length >= 12 ? opusHead[10] | (opusHead[11] << 8) : 0;
}

/**
 * O `OpusHead` que o gravador guardou em `CodecPrivate`, e os pacotes de áudio
 * dos clusters, na ordem.
 */
function lerWebm(bytes: Uint8Array): {
  trilha: TrilhaOpus;
  pacotes: Uint8Array[];
  /** Amostras de 48 kHz que o arquivo declara ter. `null` quando não declara. */
  amostras: number | null;
} {
  const r: Leitor = { bytes, pos: 0 };
  let trilha: TrilhaOpus | null = null;
  const pacotes: Uint8Array[] = [];

  // Estado da TrackEntry em curso: o CodecID pode vir DEPOIS do CodecPrivate.
  let numeroAtual: number | null = null;
  let codecAtual: string | null = null;
  let privadoAtual: Uint8Array | null = null;
  // Escala padrão do Matroska: 1 ms em nanossegundos.
  let escala = 1_000_000;
  let duracao: number | null = null;

  const fecharTrilha = () => {
    if (codecAtual === "A_OPUS" && numeroAtual !== null && privadoAtual) {
      trilha ??= { numero: numeroAtual, opusHead: privadoAtual };
    }
    numeroAtual = null;
    codecAtual = null;
    privadoAtual = null;
  };

  const percorrer = (fim: number) => {
    while (r.pos < fim) {
      const id = lerVint(r, true);
      const tamanho = lerVint(r, false);
      const inicio = r.pos;
      const limite = Math.min(inicio + tamanho, bytes.length);

      if (MESTRES.has(id)) {
        percorrer(limite);
        if (id === ID.TRACK_ENTRY) fecharTrilha();
        r.pos = limite;
        continue;
      }

      switch (id) {
        case ID.TRACK_NUMBER: {
          let n = 0;
          for (let i = inicio; i < limite; i++) n = n * 256 + bytes[i];
          numeroAtual = n;
          break;
        }
        case ID.CODEC_ID:
          codecAtual = new TextDecoder()
            .decode(bytes.subarray(inicio, limite))
            .replace(/\0+$/, "");
          break;
        case ID.TIMECODE_SCALE: {
          let n = 0;
          for (let i = inicio; i < limite; i++) n = n * 256 + bytes[i];
          if (n > 0) escala = n;
          break;
        }
        case ID.DURATION: {
          // Float de 4 ou 8 bytes, big-endian.
          const dv = new DataView(bytes.buffer, bytes.byteOffset + inicio, limite - inicio);
          duracao = limite - inicio === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
          break;
        }
        case ID.CODEC_PRIVATE:
          privadoAtual = bytes.slice(inicio, limite);
          break;
        case ID.SIMPLE_BLOCK:
        case ID.BLOCK: {
          const rb: Leitor = { bytes, pos: inicio };
          const numeroTrilha = lerVint(rb, false);
          rb.pos += 2; // timecode relativo (int16) — a ordem já é a do arquivo
          const flags = bytes[rb.pos];
          rb.pos += 1;

          // Lacing: o gravador de navegador não usa. Recusar é honesto; tratar
          // errado produziria pacotes truncados que só aparecem no ouvido do
          // destinatário.
          if (id === ID.SIMPLE_BLOCK && (flags & 0x06) !== 0) {
            throw new WebmOpusError(
              "bloco WebM com lacing — formato de gravação não suportado",
            );
          }
          if (!trilha || numeroTrilha === trilha.numero || trilha === null) {
            pacotes.push(bytes.slice(rb.pos, limite));
          }
          break;
        }
        default:
          break;
      }

      r.pos = limite;
    }
  };

  percorrer(bytes.length);
  fecharTrilha();

  if (!trilha) {
    throw new WebmOpusError("nenhuma trilha Opus encontrada no WebM");
  }
  if (pacotes.length === 0) {
    throw new WebmOpusError("WebM sem pacotes de áudio");
  }

  // `Duration` vem na escala do arquivo (ns por unidade). 48 kHz é a taxa em que
  // o Opus SEMPRE conta granule, independente da taxa de captura.
  const amostras = duracao !== null
    ? Math.round((duracao * escala) / 1_000_000_000 * 48_000)
    : null;

  return { trilha, pacotes, amostras };
}

// ─── A função ────────────────────────────────────────────────────────────────

/** Quantos pacotes por página. 50 × 20 ms ≈ 1 s de áudio por página. */
const PACOTES_POR_PAGINA = 50;

/**
 * Reempacota WebM/Opus como Ogg/Opus.
 *
 * `serial` existe para o teste poder fixar o fluxo — na prática o valor não
 * importa desde que seja o mesmo em todas as páginas.
 */
export function webmOpusToOgg(bytes: Uint8Array, serial = 0x546f7271): Uint8Array {
  const { trilha, pacotes, amostras } = lerWebm(bytes);
  const preSkip = preSkipDe(trilha.opusHead);

  const paginas: Uint8Array[] = [];
  let sequencia = 0;

  // Página 1: OpusHead, sozinha e marcada como início do fluxo (exigência do
  // mapeamento Ogg/Opus).
  paginas.push(montarPagina({
    pacotes: [trilha.opusHead],
    granule: 0,
    sequencia: sequencia++,
    serial,
    bos: true,
    eos: false,
  }));

  // Página 2: OpusTags, também sozinha.
  paginas.push(montarPagina({
    pacotes: [opusTags()],
    granule: 0,
    sequencia: sequencia++,
    serial,
    bos: false,
    eos: false,
  }));

  let decodificadas = 0;
  for (let i = 0; i < pacotes.length; i += PACOTES_POR_PAGINA) {
    const lote = pacotes.slice(i, i + PACOTES_POR_PAGINA);
    for (const p of lote) decodificadas += duracaoDoPacoteOpus(p);
    const ultima = i + PACOTES_POR_PAGINA >= pacotes.length;

    // O granule da ÚLTIMA página é o que APARA o rabo: o último pacote Opus
    // costuma passar do fim real do áudio (quadros são de 20 ms, a gravação não
    // termina em múltiplo disso). Declarar a duração do arquivo aqui é o que
    // entrega o mesmo áudio do original, em vez de original + padding.
    const alvo = ultima && amostras !== null
      ? Math.min(decodificadas, amostras)
      : decodificadas;

    paginas.push(montarPagina({
      pacotes: lote,
      granule: preSkip + alvo,
      sequencia: sequencia++,
      serial,
      bos: false,
      eos: ultima,
    }));
  }

  const total = paginas.reduce((n, p) => n + p.length, 0);
  const saida = new Uint8Array(total);
  let off = 0;
  for (const p of paginas) {
    saida.set(p, off);
    off += p.length;
  }
  return saida;
}
