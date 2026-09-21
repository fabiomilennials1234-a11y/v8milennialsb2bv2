/** Product upload budget; this is not a claimed Uazapi/WhatsApp limit. */
export const QUESTION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const QUESTION_IMAGE_BUCKET = "workflow-question-images";
export type QuestionImageMime = "image/png" | "image/jpeg" | "image/webp";
/** Inspect binary container signatures instead of trusting filename or browser MIME. */
export function inspectQuestionImage(bytes: Uint8Array): QuestionImageMime | null {
  const prefix = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (bytes.length >= 45 && prefix(137, 80, 78, 71, 13, 10, 26, 10)
    && new TextDecoder().decode(bytes.slice(12, 16)) === "IHDR"
    && new TextDecoder().decode(bytes.slice(-8, -4)) === "IEND") return "image/png";
  if (bytes.length >= 4 && prefix(255, 216, 255) && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return "image/jpeg";
  if (bytes.length >= 20 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(new TextDecoder().decode(bytes.slice(12, 16)))
    && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length) return "image/webp";
  return null;
}
export interface QuestionImageAsset {
  bucket: typeof QUESTION_IMAGE_BUCKET;
  path: string;
  mimeType: QuestionImageMime;
  sizeBytes: number;
}

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export function isQuestionImagePath(path: unknown, organizationId?: string): path is string {
  return typeof path === "string" && new RegExp(`^${uuid}/${uuid}\\.(png|jpg|webp)$`).test(path)
    && (!organizationId || path.split("/")[0] === organizationId);
}
export function isQuestionImageAsset(value: unknown, organizationId?: string): value is QuestionImageAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Record<string, unknown>;
  const extension = asset.mimeType === "image/png" ? "png" : asset.mimeType === "image/jpeg" ? "jpg" : asset.mimeType === "image/webp" ? "webp" : null;
  return asset.bucket === QUESTION_IMAGE_BUCKET && isQuestionImagePath(asset.path, organizationId)
    && extension !== null && asset.path.endsWith(`.${extension}`)
    && typeof asset.sizeBytes === "number" && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 && asset.sizeBytes <= QUESTION_IMAGE_MAX_BYTES;
}
