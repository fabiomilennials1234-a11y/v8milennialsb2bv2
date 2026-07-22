const MAX_IMAGE_SIZE = 16 * 1024 * 1024; // 16MB — WhatsApp limit

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

export function validateWorkflowImageFile(
  file: File,
): { valid: boolean; error?: string } {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { valid: false, error: "Selecione um arquivo de imagem (JPG, PNG, GIF ou WebP)" };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { valid: false, error: "Imagem excede o limite de 16MB do WhatsApp" };
  }
  return { valid: true };
}

const MAX_DOCUMENT_SIZE = 16 * 1024 * 1024; // 16MB — WhatsApp limit

const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
];

export function validateWorkflowDocumentFile(
  file: File,
): { valid: boolean; error?: string } {
  // Some browsers report an empty type for .doc/.csv — fall back to the extension.
  const extOk = /\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/i.test(file.name);
  if (!ALLOWED_DOCUMENT_TYPES.includes(file.type) && !extOk) {
    return { valid: false, error: "Selecione um documento (PDF, DOC, XLS, PPT, TXT ou CSV)" };
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    return { valid: false, error: "Documento excede o limite de 16MB do WhatsApp" };
  }
  return { valid: true };
}

const MAX_VIDEO_SIZE = 16 * 1024 * 1024; // 16MB — WhatsApp limit

// MP4 only. WhatsApp does not deliver webm at all, and iPhone .mov is usually
// HEVC, which also fails downstream — accepting either would only turn a
// visible upload error into a silent delivery failure. No transcoding here.
const ALLOWED_VIDEO_TYPES = ["video/mp4"];

export function validateWorkflowVideoFile(
  file: File,
): { valid: boolean; error?: string } {
  // Fall back to the extension ONLY when the browser reports no type at all.
  // A declared non-mp4 type always loses: trusting the extension over it would
  // let a renamed .webm/.mov through, which is exactly the silent failure this
  // check exists to prevent.
  const typeOk = ALLOWED_VIDEO_TYPES.includes(file.type);
  const extFallbackOk = !file.type && /\.mp4$/i.test(file.name);
  if (!typeOk && !extFallbackOk) {
    return {
      valid: false,
      error:
        "Selecione um vídeo MP4. O WhatsApp não entrega .webm, e .mov de iPhone costuma falhar no envio.",
    };
  }
  if (file.size > MAX_VIDEO_SIZE) {
    return { valid: false, error: "Vídeo excede o limite de 16MB do WhatsApp" };
  }
  return { valid: true };
}

export function buildWorkflowAssetPath(orgId: string, filename: string): string {
  const ext = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "jpg";
  return `workflow-assets/${orgId}/${crypto.randomUUID()}.${ext}`;
}
