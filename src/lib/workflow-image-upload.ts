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

export function buildWorkflowAssetPath(orgId: string, filename: string): string {
  const ext = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "jpg";
  return `workflow-assets/${orgId}/${crypto.randomUUID()}.${ext}`;
}
