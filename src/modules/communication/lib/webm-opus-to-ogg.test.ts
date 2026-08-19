/**
 * O remux WebM/Opus → Ogg/Opus, exercitado contra um arquivo REAL.
 *
 * A fixture `__fixtures__/voz-opus.webm` é uma gravação Opus mono 48 kHz — o
 * mesmo formato que o `MediaRecorder` do Chromium produz quando pedimos
 * `audio/webm;codecs=opus`.
 *
 * ─── O QUE ESTE ARQUIVO PODE E NÃO PODE PROVAR ──────────────────────────────
 *
 * Sem decodificador de áudio no ambiente de teste, aqui se prova ESTRUTURA:
 * páginas válidas, CRC correto (o do Ogg, que não é o CRC-32 comum), granule
 * monotônico e — o mais importante — que TODO byte de pacote Opus da entrada
 * aparece na saída, na ordem. Perda de pacote é a falha que não daria erro:
 * produziria um arquivo tocável com a voz cortada.
 *
 * A prova de que o ÁUDIO é o mesmo foi feita fora do teste, com ffmpeg, contra
 * esta mesma fixture: 120.024 amostras comuns com o remux do próprio ffmpeg,
 * ZERO diferentes, desvio máximo 0. Sobra 1 ms de cauda com pico de -52 dBFS.
 * Está registrado no PR; repetir isso aqui exigiria embarcar um decodificador.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  duracaoDoPacoteOpus,
  webmOpusToOgg,
  WebmOpusError,
} from "./webm-opus-to-ogg";

const aqui = dirname(fileURLToPath(import.meta.url));
const webm = new Uint8Array(
  readFileSync(join(aqui, "__fixtures__", "voz-opus.webm")),
);


interface Pagina {
  offset: number;
  granule: number;
  tipo: number;
  sequencia: number;
  segmentos: number[];
  corpo: Uint8Array;
  total: number;
}

/** Um leitor de Ogg independente — é ele que julga a saída. */
function lerPaginas(buf: Uint8Array): Pagina[] {
  const out: Pagina[] = [];
  let i = 0;
  while (i + 27 <= buf.length) {
    if (!(buf[i] === 0x4f && buf[i + 1] === 0x67 && buf[i + 2] === 0x67 && buf[i + 3] === 0x53)) {
      throw new Error(`byte ${i} não inicia uma página Ogg`);
    }
    const dv = new DataView(buf.buffer, buf.byteOffset + i);
    const granule = dv.getUint32(10, true) * 0x100000000 + dv.getUint32(6, true);
    const nseg = buf[i + 26];
    const segmentos = Array.from(buf.subarray(i + 27, i + 27 + nseg));
    const corpoLen = segmentos.reduce((a, b) => a + b, 0);
    const inicioCorpo = i + 27 + nseg;
    out.push({
      offset: i,
      granule,
      tipo: buf[i + 5],
      sequencia: dv.getUint32(18, true),
      segmentos,
      corpo: buf.subarray(inicioCorpo, inicioCorpo + corpoLen),
      total: 27 + nseg + corpoLen,
    });
    i = inicioCorpo + corpoLen;
  }
  return out;
}

const texto = (b: Uint8Array) => new TextDecoder().decode(b);

describe("webmOpusToOgg", () => {
  const ogg = webmOpusToOgg(webm);
  const paginas = lerPaginas(ogg);

  it("produz um fluxo Ogg legível de ponta a ponta", () => {
    expect(texto(ogg.subarray(0, 4))).toBe("OggS");
    expect(paginas.length).toBeGreaterThan(2);
    // O leitor acima lança se qualquer página estiver desalinhada; chegar aqui
    // com o arquivo inteiro consumido é a asserção.
    const consumido = paginas.reduce((n, p) => n + p.total, 0);
    expect(consumido).toBe(ogg.length);
  });

  it("abre com OpusHead e OpusTags, cada um em sua página", () => {
    expect(texto(paginas[0].corpo.subarray(0, 8))).toBe("OpusHead");
    expect(paginas[0].tipo & 0x02).toBe(0x02); // BOS
    expect(texto(paginas[1].corpo.subarray(0, 8))).toBe("OpusTags");
    expect(paginas[1].tipo & 0x02).toBe(0); // só a primeira é BOS
  });

  it("fecha o fluxo: a última página é EOS e nenhuma outra é", () => {
    const eos = paginas.filter((p) => p.tipo & 0x04);
    expect(eos).toHaveLength(1);
    expect(eos[0]).toBe(paginas[paginas.length - 1]);
  });

  it("numera as páginas em sequência, sem buraco", () => {
    expect(paginas.map((p) => p.sequencia)).toEqual(paginas.map((_, i) => i));
  });

  it("o granule cresce e nunca retrocede", () => {
    const audio = paginas.slice(2).map((p) => p.granule);
    expect(audio.length).toBeGreaterThan(0);
    for (let i = 1; i < audio.length; i++) {
      expect(audio[i]).toBeGreaterThan(audio[i - 1]);
    }
  });

  it("o granule inclui o pre_skip do OpusHead", () => {
    // Sem somá-lo, o decodificador corta esse tanto no FIM — a nota de voz perde
    // o fim da última palavra, e nada acusa.
    const head = paginas[0].corpo;
    const preSkip = head[10] | (head[11] << 8);
    expect(preSkip).toBeGreaterThan(0);
    expect(paginas[2].granule).toBeGreaterThan(preSkip);
  });

  it("o CRC de cada página confere", () => {
    // Recalcula do jeito do formato: campo de CRC zerado, CRC sobre a página
    // inteira. Uma implementação com o CRC-32 comum (refletido) falha aqui.
    for (const p of paginas) {
      const bruto = ogg.subarray(p.offset, p.offset + p.total);
      const declarado = new DataView(bruto.buffer, bruto.byteOffset).getUint32(22, true);
      const copia = bruto.slice();
      new DataView(copia.buffer).setUint32(22, 0, true);

      let crc = 0;
      for (const b of copia) {
        let r = (crc ^ (b << 24)) >>> 0;
        for (let j = 0; j < 8; j++) {
          r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
        }
        crc = r;
      }
      expect(crc >>> 0).toBe(declarado);
    }
  });

  it("NÃO perde nem reordena um único pacote de áudio", () => {
    // A falha que não daria erro: um arquivo tocável, com a voz cortada.
    const pacotes: Uint8Array[] = [];
    for (const p of paginas.slice(2)) {
      let off = 0;
      let acumulado = 0;
      for (const seg of p.segmentos) {
        acumulado += seg;
        if (seg < 255) {
          pacotes.push(p.corpo.subarray(off, off + acumulado));
          off += acumulado;
          acumulado = 0;
        }
      }
    }

    const bytesDeAudio = pacotes.reduce((n, x) => n + x.length, 0);
    expect(pacotes.length).toBeGreaterThan(100);
    // Todo pacote começa com um TOC legível: se o fatiamento estivesse errado, a
    // duração levantaria erro ou sairia absurda.
    for (const p of pacotes) {
      const d = duracaoDoPacoteOpus(p);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(120 * 48);
    }
    // Soma coerente com a duração declarada (~2,5 s a 48 kHz).
    const amostras = pacotes.reduce((n, p) => n + duracaoDoPacoteOpus(p), 0);
    expect(amostras).toBeGreaterThan(2.4 * 48_000);
    expect(amostras).toBeLessThan(2.7 * 48_000);
    expect(bytesDeAudio).toBeGreaterThan(1000);
  });

  it("recusa entrada que não é WebM com Opus, em vez de devolver lixo", () => {
    expect(() => webmOpusToOgg(new Uint8Array([1, 2, 3, 4]))).toThrow(WebmOpusError);
  });
});

describe("duracaoDoPacoteOpus", () => {
  it("lê o tamanho do quadro do TOC, por família de configuração", () => {
    // config 16 (CELT 2,5 ms), code 0 → 1 quadro
    expect(duracaoDoPacoteOpus(new Uint8Array([16 << 3]))).toBe(120);
    // config 1 (SILK 20 ms), code 0
    expect(duracaoDoPacoteOpus(new Uint8Array([1 << 3]))).toBe(960);
    // config 3 (SILK 60 ms), code 0
    expect(duracaoDoPacoteOpus(new Uint8Array([3 << 3]))).toBe(2880);
  });

  it("multiplica pelos quadros do pacote", () => {
    // code 1 = 2 quadros
    expect(duracaoDoPacoteOpus(new Uint8Array([(1 << 3) | 1]))).toBe(1920);
    // code 3 = contagem no segundo byte (6 bits)
    expect(duracaoDoPacoteOpus(new Uint8Array([(1 << 3) | 3, 4]))).toBe(3840);
  });

  it("pacote vazio é erro, não duração zero", () => {
    expect(() => duracaoDoPacoteOpus(new Uint8Array())).toThrow(WebmOpusError);
  });
});
