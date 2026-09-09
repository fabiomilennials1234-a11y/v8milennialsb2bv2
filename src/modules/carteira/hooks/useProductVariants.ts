import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrganization } from "@/modules/identity";
import {
  invalidateProductQueries,
  type ProductVariant,
  type ProductVariantInsert,
  type ProductVariantUpdate,
} from "./useProducts";

export function useProductVariants(productId: string | undefined) {
  return useQuery({
    queryKey: ["product-variants", productId],
    queryFn: async () => {
      if (!productId) return [];
      const { data, error } = await supabase
        .from("product_variants")
        .select("*")
        .eq("product_id", productId)
        .order("sort_order")
        .order("name");

      if (error) throw error;
      return data as ProductVariant[];
    },
    enabled: !!productId,
  });
}

export function useCreateProductVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variant: ProductVariantInsert) => {
      const { data, error } = await supabase
        .from("product_variants")
        .insert(variant)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["product-variants", variables.product_id] });
      invalidateProductQueries(queryClient);
      toast.success("Variação criada com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao criar variação: ${error.message}`);
    },
  });
}

export function useUpdateProductVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: ProductVariantUpdate) => {
      const { data, error } = await supabase
        .from("product_variants")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["product-variants", data.product_id] });
      invalidateProductQueries(queryClient);
      toast.success("Variação atualizada com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar variação: ${error.message}`);
    },
  });
}

export function useDeleteProductVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, productId }: { id: string; productId: string }) => {
      const { error } = await supabase
        .from("product_variants")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return { productId };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["product-variants", variables.productId] });
      invalidateProductQueries(queryClient);
      toast.success("Variação excluída com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao excluir variação: ${error.message}`);
    },
  });
}

export function useBulkCreateProductVariants() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variants: ProductVariantInsert[]) => {
      const { data, error } = await supabase
        .from("product_variants")
        .insert(variants)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      const productId = variables[0]?.product_id;
      if (productId) {
        queryClient.invalidateQueries({ queryKey: ["product-variants", productId] });
      }
      invalidateProductQueries(queryClient);
      toast.success(`${variables.length} variações criadas com sucesso!`);
    },
    onError: (error) => {
      toast.error(`Erro ao criar variações: ${error.message}`);
    },
  });
}
