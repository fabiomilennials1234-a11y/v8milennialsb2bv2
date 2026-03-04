import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrganization } from "./useOrganization";

export type ProductType = "mrr" | "projeto" | "unitario";

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  sku: string | null;
  description: string | null;
  has_variants: boolean;
  base_unit: string | null;
  ticket: number | null;
  ticket_minimo: number | null;
  entregaveis: string | null;
  materiais: string | null;
  links: string[] | null;
  logo_url: string | null;
  contrato_padrao_url: string | null;
  contrato_minimo_url: string | null;
  is_active: boolean;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
  variants?: ProductVariant[];
}

export interface ProductVariant {
  id: string;
  product_id: string;
  sku: string | null;
  name: string;
  ticket: number | null;
  ticket_minimo: number | null;
  weight: number | null;
  grammage: number | null;
  dimensions: string | null;
  color: string | null;
  size: string | null;
  custom_attributes: Record<string, unknown>;
  sort_order: number;
  is_active: boolean;
  organization_id: string;
  created_at: string;
  updated_at: string;
}

export type ProductInsert = Omit<Product, "id" | "created_at" | "updated_at" | "variants">;
export type ProductUpdate = Partial<ProductInsert> & { id: string };

export type ProductVariantInsert = Omit<ProductVariant, "id" | "created_at" | "updated_at">;
export type ProductVariantUpdate = Partial<ProductVariantInsert> & { id: string };

export function useProducts() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["products", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name");

      if (error) throw error;
      return data as Product[];
    },
    enabled: isReady,
  });
}

export function useProductsWithVariants() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["products-with-variants", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("products")
        .select("*, product_variants(*)")
        .eq("organization_id", organizationId)
        .order("name");

      if (error) throw error;
      return (data as (Product & { product_variants: ProductVariant[] })[]).map((p) => ({
        ...p,
        variants: p.product_variants || [],
      }));
    },
    enabled: isReady,
  });
}

export function useActiveProducts() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["products", "active", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .eq("organization_id", organizationId)
        .order("name");

      if (error) throw error;
      return data as Product[];
    },
    enabled: isReady,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (product: ProductInsert) => {
      const { data, error } = await supabase
        .from("products")
        .insert(product)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto criado com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao criar produto: ${error.message}`);
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: ProductUpdate) => {
      const { data, error } = await supabase
        .from("products")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto atualizado com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar produto: ${error.message}`);
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("products")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Produto excluído com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao excluir produto: ${error.message}`);
    },
  });
}
