import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export interface HelpCategory {
  id: string;
  organization_id: string | null;
  name: string;
  slug: string;
  icon: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface HelpArticleMedia {
  url: string;
  type: "image" | "gif";
  caption?: string;
}

export interface HelpArticle {
  id: string;
  category_id: string;
  organization_id: string | null;
  title: string;
  summary: string | null;
  content: string;
  media: HelpArticleMedia[];
  tags: string[];
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface HelpArticleWithCategory extends HelpArticle {
  category: HelpCategory;
}

// ---- Queries ----

export function useHelpCategories() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["help-categories", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("help_categories")
        .select("*")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("sort_order");

      if (error) throw error;
      return data as HelpCategory[];
    },
    enabled: isReady,
  });
}

export function useHelpArticles(categoryId?: string) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["help-articles", organizationId, categoryId],
    queryFn: async () => {
      let query = supabase
        .from("help_articles")
        .select("*, category:help_categories(*)")
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("sort_order");

      if (categoryId) {
        query = query.eq("category_id", categoryId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as HelpArticleWithCategory[];
    },
    enabled: isReady,
  });
}

export function useHelpArticle(articleId: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["help-article", articleId],
    queryFn: async () => {
      if (!articleId) return null;
      const { data, error } = await supabase
        .from("help_articles")
        .select("*, category:help_categories(*)")
        .eq("id", articleId)
        .single();

      if (error) throw error;
      return data as HelpArticleWithCategory;
    },
    enabled: isReady && !!articleId,
  });
}

// ---- Mutations (Admin) ----

export function useCreateHelpCategory() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (category: Omit<HelpCategory, "id" | "created_at" | "organization_id">) => {
      const { data, error } = await supabase
        .from("help_categories")
        .insert({ ...category, organization_id: organizationId })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help-categories"] });
    },
  });
}

export function useUpdateHelpCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<HelpCategory> & { id: string }) => {
      const { data, error } = await supabase
        .from("help_categories")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help-categories"] });
    },
  });
}

export function useDeleteHelpCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("help_categories")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help-categories"] });
      queryClient.invalidateQueries({ queryKey: ["help-articles"] });
    },
  });
}

export function useCreateHelpArticle() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (article: Omit<HelpArticle, "id" | "created_at" | "updated_at" | "organization_id">) => {
      const { data, error } = await supabase
        .from("help_articles")
        .insert({ ...article, organization_id: organizationId })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help-articles"] });
    },
  });
}

export function useUpdateHelpArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<HelpArticle> & { id: string }) => {
      const { data, error } = await supabase
        .from("help_articles")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help-articles"] });
      queryClient.invalidateQueries({ queryKey: ["help-article"] });
    },
  });
}

export function useDeleteHelpArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("help_articles")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help-articles"] });
    },
  });
}

export function useUploadHelpMedia() {
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split(".").pop();
      const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;

      const { error } = await supabase.storage
        .from("help-media")
        .upload(path, file, { contentType: file.type });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from("help-media")
        .getPublicUrl(path);

      return urlData.publicUrl;
    },
  });
}
