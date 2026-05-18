import type { ActionInput, ActionResult } from "./types.ts";

/**
 * Add a tag to a lead. Resolves by tagId or tagName.
 * Creates tag in org if tagName provided but not found.
 */
export async function addTag(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for addTag" };
  }

  const tagName = params.tagName as string | undefined;
  const tagId = params.tagId as string | undefined;

  let resolvedTagId = tagId;

  if (!resolvedTagId && tagName) {
    // Try to find existing tag by name
    const { data: tag } = await supabase
      .from("tags")
      .select("id")
      .eq("name", tagName)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!tag) {
      // Create tag
      const { data: newTag } = await supabase
        .from("tags")
        .insert({ name: tagName, color: "#6366f1", organization_id: organizationId })
        .select("id")
        .single();
      resolvedTagId = newTag?.id;
    } else {
      resolvedTagId = tag.id;
    }
  }

  if (!resolvedTagId) {
    return { success: false, error: "No tag configured (provide tagId or tagName)" };
  }

  await supabase.from("lead_tags").upsert(
    { lead_id: leadId, tag_id: resolvedTagId },
    { onConflict: "lead_id,tag_id", ignoreDuplicates: true },
  );

  return { success: true, message: `Tag "${tagName || tagId}" added` };
}

/**
 * Remove a tag from a lead. Resolves by tagId or tagName.
 */
export async function removeTag(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for removeTag" };
  }

  const tagId = params.tagId as string | undefined;
  const tagName = params.tagName as string | undefined;

  let resolvedTagId = tagId;

  if (!resolvedTagId && tagName) {
    const { data: tag } = await supabase
      .from("tags")
      .select("id")
      .eq("name", tagName)
      .eq("organization_id", organizationId)
      .maybeSingle();
    resolvedTagId = tag?.id;
  }

  if (!resolvedTagId) {
    return { success: false, error: "Tag not found (provide tagId or existing tagName)" };
  }

  await supabase.from("lead_tags").delete().eq("lead_id", leadId).eq("tag_id", resolvedTagId);
  return { success: true, message: `Tag "${tagName || tagId}" removed` };
}
