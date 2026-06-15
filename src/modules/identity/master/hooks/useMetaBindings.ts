/**
 * useMetaBindings — master-only data for the Meta Asset Binding tab (ADR-0009).
 * Talks to the meta-asset-admin edge function (JWT + master gate server-side).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MetaAsset {
  type: "page" | "ad_account";
  id: string;
  name: string;
  boundOrgId: string | null;
  datasetId: string | null;
  status: string | null;
  lastPolledAt: string | null;
  lastError: string | null;
  instagram?: boolean;
  accountStatus?: number;
}

export interface MetaOrg {
  id: string;
  name: string;
}

interface AdminResponse {
  assets: MetaAsset[];
  orgs: MetaOrg[];
}

const KEY = ["meta-asset-admin"];

export function useMetaAssetAdmin() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AdminResponse> => {
      const { data, error } = await supabase.functions.invoke("meta-asset-admin", { method: "GET" });
      if (error) throw error;
      return data as AdminResponse;
    },
    staleTime: 60_000,
  });
}

export function useBindAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      asset_type: "page" | "ad_account";
      asset_id: string;
      asset_name: string;
      organization_id: string;
      dataset_id?: string | null;
    }) => {
      const { error } = await supabase.functions.invoke("meta-asset-admin", { method: "POST", body: input });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUnbindAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { asset_id: string; asset_type: "page" | "ad_account" }) => {
      const { error } = await supabase.functions.invoke("meta-asset-admin", { method: "DELETE", body: input });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSetDataset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { asset_id: string; dataset_id: string | null }) => {
      const { error } = await supabase.functions.invoke("meta-asset-admin", { method: "PATCH", body: input });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
