import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type MaterialType = "pdf_comercial" | "apresentacao" | "catalogo" | "imagem" | "flyer" | "documento";

export interface ProductMaterial {
  id: string;
  organization_id: string;
  product_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string;
  material_type: MaterialType;
  description: string | null;
  summary: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  pdf_comercial: "PDF Comercial",
  apresentacao: "Apresentação",
  catalogo: "Catálogo",
  imagem: "Imagem",
  flyer: "Flyer / Arte",
  documento: "Documento",
};

const STORAGE_BUCKET = "product-materials";

// ────────────────────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────────────────────

/** List materials for a product */
export function useProductMaterials(productId: string | undefined) {
  return useQuery({
    queryKey: ["product-materials", productId],
    queryFn: async (): Promise<ProductMaterial[]> => {
      if (!productId) return [];
      const { data, error } = await supabase
        .from("product_materials")
        .select("*")
        .eq("product_id", productId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProductMaterial[];
    },
    enabled: !!productId,
    staleTime: 60_000,
  });
}

/** Get material count per product (for product cards) */
export function useProductMaterialCounts() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["product-material-counts", organizationId],
    queryFn: async (): Promise<Map<string, number>> => {
      if (!organizationId) return new Map();
      const { data, error } = await supabase
        .from("product_materials")
        .select("product_id")
        .eq("organization_id", organizationId)
        .eq("is_active", true);
      if (error) throw error;

      const counts = new Map<string, number>();
      for (const row of data || []) {
        counts.set(row.product_id, (counts.get(row.product_id) || 0) + 1);
      }
      return counts;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}

// ────────────────────────────────────────────────────────────
// Mutations
// ────────────────────────────────────────────────────────────

/** Upload a material file and create the record */
export function useUploadProductMaterial() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      productId,
      file,
      materialType = "documento",
      description,
    }: {
      productId: string;
      file: File;
      materialType?: MaterialType;
      description?: string;
    }) => {
      if (!organizationId) throw new Error("Organização não encontrada");

      // 1. Upload to storage (sanitize filename to prevent path traversal)
      const safeName = file.name.replace(/\.\./g, "").replace(/[\/\\]/g, "_").replace(/^\./, "_");
      const filePath = `${organizationId}/${productId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, { contentType: file.type, upsert: false });

      if (uploadError) throw uploadError;

      // 2. Create record
      const { data, error } = await supabase
        .from("product_materials")
        .insert({
          organization_id: organizationId,
          product_id: productId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type,
          material_type: materialType,
          description: description || null,
        })
        .select()
        .single();

      if (error) {
        // Rollback: delete uploaded file
        await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);
        throw error;
      }

      return data as ProductMaterial;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["product-materials", variables.productId] });
      queryClient.invalidateQueries({ queryKey: ["product-material-counts"] });
    },
  });
}

/** Delete a material (soft delete + remove file) */
export function useDeleteProductMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, productId, filePath }: { id: string; productId: string; filePath: string }) => {
      // Delete from storage
      await supabase.storage.from(STORAGE_BUCKET).remove([filePath]);

      // Delete record
      const { error } = await supabase
        .from("product_materials")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["product-materials", variables.productId] });
      queryClient.invalidateQueries({ queryKey: ["product-material-counts"] });
    },
  });
}

/** Get signed URL for a material */
export async function getProductMaterialUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(filePath, 600); // 10min expiry
  if (error) throw error;
  return data.signedUrl;
}
