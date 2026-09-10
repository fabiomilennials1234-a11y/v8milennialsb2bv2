export const MAX_COMMENT_FILES = 5;
export const MAX_COMMENT_FILE_SIZE = 20 * 1024 * 1024;
export const COMMENT_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
export const COMMENT_FILE_ACCEPT = Object.keys(COMMENT_FILE_TYPES)
  .map((x) => `.${x}`)
  .join(",");
export interface CommentAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
}
export function validateCommentFiles(files: File[]): void {
  if (files.length > MAX_COMMENT_FILES)
    throw new Error("Anexe no máximo 5 arquivos por comentário.");
  for (const file of files) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!COMMENT_FILE_TYPES[extension])
      throw new Error(`Formato não permitido: ${file.name}`);
    if (!file.size || file.size > MAX_COMMENT_FILE_SIZE)
      throw new Error("Cada arquivo deve ter conteúdo e no máximo 20 MB.");
    if (
      file.name.length > 200 ||
      Array.from(file.name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /[\u200e\u200f\u202a-\u202e\u2066-\u2069/\\]/u.test(
        file.name,
      )
    )
      throw new Error(
        "Nome de arquivo inválido. Renomeie o documento e tente novamente.",
      );
  }
}
export function commentFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
