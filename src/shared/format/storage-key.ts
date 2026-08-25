/**
 * Sanitização de nome de arquivo para chave do Supabase Storage.
 *
 * O Storage recusa a chave com HTTP 400 `Invalid key` quando ela sai do
 * conjunto ASCII seguro — acento, cedilha, espaço e símbolo derrubam o upload
 * inteiro. O nome original NUNCA deve ser usado cru na chave; guarde-o na
 * coluna de exibição (`file_name`) e passe a chave por aqui.
 */

/** Combining diacritical marks — o resíduo da normalização NFD. */
const DIACRITICS = /[̀-ͯ]/g;

/** Extensão em minúsculas, sem o ponto. String vazia quando não há extensão. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Reduz o nome ao conjunto `[a-z0-9._-]`, preservando legibilidade:
 * remove diacríticos (NFD), troca o resto por `_`, colapsa repetições e
 * limita o comprimento para não estourar o limite de chave do Storage.
 *
 * `"ESSÊNCIA LOOFTING VERÃO I_compressed.pdf"` → `"essencia_loofting_verao_i_compressed.pdf"`
 */
export function sanitizeFileName(fileName: string, maxBaseLength = 80): string {
  const ext = extensionOf(fileName);
  const rawBase = ext ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName;

  const base = rawBase
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .toLowerCase()
    .slice(0, maxBaseLength);

  // Nome inteiro fora do ASCII (ex.: só ideogramas) colapsa para vazio.
  const safeBase = base || "arquivo";
  return ext ? `${safeBase}.${ext}` : safeBase;
}
