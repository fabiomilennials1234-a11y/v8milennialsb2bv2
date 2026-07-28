/**
 * useDemoData — hooks para popular e remover dados de demonstração.
 *
 * Onda 3.2 — Sprint 3.2.4
 *
 * seed_demo_data(p_org_id) — cria 10 leads [DEMO], tag 'demo', pipeline 'Demo Pipeline'
 * remove_demo_data(p_org_id) — deleta somente entidades com watermark [DEMO]
 *
 * Ambas SECURITY DEFINER no banco — guard admin server-side.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
// ─── Check se demo data existe ────────────────────────────────────────────────

export function useHasDemoData() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["has-demo-data", organizationId],
    queryFn: async () => {
      if (!organizationId) return false;
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .like("name", "[DEMO]%");
      return (count ?? 0) > 0;
    },
    enabled: !!organizationId,
    staleTime: 10_000,
  });
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

export function useSeedDemoData() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("organizationId ausente");
      const { data, error } = await supabase.rpc("seed_demo_data", { p_org_id: organizationId });
      if (error) {
        if (error.code === "42501") throw new Error("Apenas administradores podem popular dados demo.");
        throw error;
      }
      return data;
    },
    onSuccess: (result) => {
      const r = result as { already_seeded?: boolean; leads?: number };
      if (r?.already_seeded) {
        toast.info("Dados demo já existem. Remova primeiro para popular novamente.");
      } else {
        toast.success(`${r?.leads ?? 10} leads demo criados com sucesso.`);
      }
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["has-demo-data", organizationId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao popular dados demo.");
    },
  });
}

// ─── Remove ───────────────────────────────────────────────────────────────────

export function useRemoveDemoData() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("organizationId ausente");
      const { data, error } = await supabase.rpc("remove_demo_data", { p_org_id: organizationId });
      if (error) {
        if (error.code === "42501") throw new Error("Apenas administradores podem remover dados demo.");
        throw error;
      }
      return data;
    },
    onSuccess: (result) => {
      const r = result as { removed?: number };
      toast.success(`${r?.removed ?? 0} leads demo removidos. Dados reais intactos.`);
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["has-demo-data", organizationId] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Erro ao remover dados demo.");
    },
  });
}
