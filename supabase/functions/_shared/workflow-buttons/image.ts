import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isQuestionImageAsset, QUESTION_IMAGE_BUCKET } from "../../../../src/contracts/workflows/question-image.ts";

/** Immutable private asset from the execution snapshot. Sign only when actually sending. */
export async function resolveWorkflowQuestionImageUrl(
  supabase: SupabaseClient,
  organizationId: string,
  image: unknown,
): Promise<string | undefined> {
  if (image === undefined || image === null) return undefined;
  if (!isQuestionImageAsset(image, organizationId)) throw new Error("question_buttons_image_invalid");
  const signed = await supabase.storage.from(QUESTION_IMAGE_BUCKET).createSignedUrl(image.path, 3600);
  if (signed.error || !signed.data?.signedUrl) throw new Error("question_buttons_image_unavailable");
  return signed.data.signedUrl;
}
