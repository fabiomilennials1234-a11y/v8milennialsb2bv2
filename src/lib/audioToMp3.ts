/**
 * Converte áudio em formato WebM/OGG (gravação do navegador) para MP3,
 * garantindo reprodução em todos os dispositivos (incl. Safari/iOS).
 * Usa Web Audio API para decodificar e lamejs para codificar em MP3.
 *
 * FIX: lamejs CJS tem bug com Vite — Lame.js usa MPEGMode sem importá-lo.
 * Usamos lame.min.js (bundle único) copiado para /public, que não tem esse bug.
 */

type LameMp3Encoder = {
  encodeBuffer: (left: Int16Array, right?: Int16Array) => Int8Array;
  flush: () => Int8Array;
};

type LamejsGlobal = {
  Mp3Encoder: new (ch: number, sr: number, kbps: number) => LameMp3Encoder;
};

const SAMPLE_BLOCK = 1152;

let _lamejsPromise: Promise<LamejsGlobal | null> | null = null;

/**
 * Carrega lamejs via /lamejs.min.js (bundle único que não tem o bug de MPEGMode).
 * O script define lamejs.Mp3Encoder como propriedade da função global.
 */
function loadLamejs(): Promise<LamejsGlobal | null> {
  if (_lamejsPromise) return _lamejsPromise;

  _lamejsPromise = new Promise((resolve) => {
    const g = globalThis as unknown as Record<string, unknown>;

    // Já carregado
    if (g.lamejs && (g.lamejs as LamejsGlobal).Mp3Encoder) {
      resolve(g.lamejs as LamejsGlobal);
      return;
    }

    const script = document.createElement("script");
    script.src = "/lamejs.min.js";
    script.onload = () => {
      if (g.lamejs && (g.lamejs as LamejsGlobal).Mp3Encoder) {
        resolve(g.lamejs as LamejsGlobal);
      } else {
        console.warn("[audioToMp3] lamejs loaded but Mp3Encoder not found");
        resolve(null);
      }
    };
    script.onerror = () => {
      console.warn("[audioToMp3] Failed to load lamejs.min.js");
      _lamejsPromise = null; // permitir retry
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return _lamejsPromise;
}

function floatTo16BitPCM(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Converte um Blob de áudio (webm/ogg) para MP3.
 * Retorna o mesmo blob se já for MP3/mpeg ou se a conversão falhar.
 */
export async function convertAudioBlobToMp3(blob: Blob): Promise<Blob> {
  const type = (blob.type || "").toLowerCase();
  if (type.includes("mpeg") || type.includes("mp3")) {
    return blob;
  }
  if (!type.includes("webm") && !type.includes("ogg") && !type.includes("opus")) {
    return blob;
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const numChannels = decoded.numberOfChannels;
    const sampleRate = decoded.sampleRate;
    const left = decoded.getChannelData(0);
    const right = numChannels > 1 ? decoded.getChannelData(1) : left;

    const left16 = floatTo16BitPCM(left);
    const right16 = numChannels > 1 ? floatTo16BitPCM(right) : left16;

    const lamejs = await loadLamejs();
    if (!lamejs?.Mp3Encoder) {
      console.warn("[audioToMp3] Mp3Encoder not available");
      return blob;
    }

    const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 128);
    const mp3Chunks: Int8Array[] = [];

    for (let i = 0; i < left16.length; i += SAMPLE_BLOCK) {
      const leftChunk = left16.subarray(i, i + SAMPLE_BLOCK);
      const rightChunk = right16.subarray(i, i + SAMPLE_BLOCK);
      const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) {
        mp3Chunks.push(mp3buf);
      }
    }

    const flush = encoder.flush();
    if (flush.length > 0) {
      mp3Chunks.push(flush);
    }

    return new Blob(mp3Chunks, { type: "audio/mpeg" });
  } catch (e) {
    console.warn("[audioToMp3] Conversion failed, sending original:", e);
    return blob;
  }
}
