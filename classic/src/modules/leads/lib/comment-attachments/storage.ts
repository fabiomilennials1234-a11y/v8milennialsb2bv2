import { supabase } from "@/integrations/supabase/client";
import {
  COMMENT_FILE_TYPES,
  validateCommentFiles,
  type CommentAttachment,
} from "./files";
const BUCKET = "deal-comment-documents";

export async function uploadCommentFiles(
  files: File[],
  context: {
    organizationId: string;
    entryId: string;
    userId: string;
    commentId: string;
  },
): Promise<CommentAttachment[]> {
  validateCommentFiles(files);
  const uploaded: CommentAttachment[] = [];
  try {
    for (const file of files) {
      const extension = file.name.split(".").pop()!.toLowerCase();
      const type = COMMENT_FILE_TYPES[extension];
      const path = `${context.organizationId}/${context.entryId}/${context.userId}/${context.commentId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: type, upsert: false });
      if (error) throw error;
      uploaded.push({ path, name: file.name, size: file.size, type });
    }
    return uploaded;
  } catch (error) {
    await removeUnpublishedCommentFiles(uploaded);
    throw error;
  }
}

/** Policy only permits removing unpublished uploads owned by this user. */
export async function removeUnpublishedCommentFiles(
  files: CommentAttachment[],
) {
  if (!files.length) return;
  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove(files.map((f) => f.path));
    if (error) console.warn("Não foi possível limpar anexos não publicados.");
  } catch {
    console.warn("Não foi possível limpar anexos não publicados.");
  }
}

export async function downloadCommentFile(file: CommentAttachment) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(file.path);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
