/**
 * useLeadOrigins — fonte única (dinâmica) de origens de lead.
 *
 * Lê a tabela registry `lead_origins` (built-ins globais org_id=NULL + custom
 * da org, gateados por RLS). Substitui as listas hardcoded espalhadas pelo
 * frontend (useMktOriginConfig, src/lib/lead/lead-origins, maps locais).
 *
 * Slice A: só existem built-ins. Custom por org vem no Slice B (o hook já
 * resolve org-override por slug — forward-compat).
 *
 * Fallback: enquanto a query carrega (ou se a tabela estiver vazia), usa os 13
 * built-ins locais — idênticos ao seed da migration — para nunca renderizar
 * uma lista vazia. labelOf/colorOf caem para o próprio slug + cor genérica
 * quando o slug é desconhecido.
 */

import { useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface LeadOriginOption {
  slug: string;
  label: string;
  color: string;
}

/** Cor genérica para slugs desconhecidos (mesma de `outro`). */
export const FALLBACK_ORIGIN_COLOR = "#64748B";

/**
 * Built-ins locais — espelham EXATAMENTE o seed de
 * `20270314000000_lead_origins_registry.sql` (que por sua vez espelha
 * useMktOriginConfig.ts). Usados só como fallback de carregamento/vazio.
 */
export const BUILTIN_LEAD_ORIGINS: LeadOriginOption[] = [
  { slug: "whatsapp", label: "WhatsApp", color: "#25D366" },
  { slug: "meta_ads", label: "Meta Ads", color: "#1877F2" },
  { slug: "instagram", label: "Instagram", color: "#E1306C" },
  { slug: "tiktok", label: "Tiktok", color: "#010101" },
  { slug: "google_ads", label: "Google Ads", color: "#EA4335" },
  { slug: "site", label: "Site", color: "#6366F1" },
  { slug: "landing_page", label: "Landing Page", color: "#0EA5E9" },
  { slug: "remarketing", label: "Remarketing", color: "#F59E0B" },
  { slug: "indicacao", label: "Indicação", color: "#10B981" },
  { slug: "evento", label: "Evento", color: "#8B5CF6" },
  { slug: "prospeccao_ativa", label: "Prospecção Ativa", color: "#F97316" },
  { slug: "cal", label: "Cal.com", color: "#292929" },
  { slug: "outro", label: "Outro", color: "#64748B" },
];

interface LeadOriginRow {
  slug: string;
  /** Coluna real no banco é `name`; mapeada para `label` na API pública do hook. */
  name: string;
  color: string;
  sort_order: number;
  organization_id: string | null;
}

export interface UseLeadOriginsResult {
  origins: LeadOriginOption[];
  labelOf: (slug: string | null | undefined) => string;
  colorOf: (slug: string | null | undefined) => string;
  isLoading: boolean;
}

export function useLeadOrigins(): UseLeadOriginsResult {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ["lead_origins", organizationId],
    queryFn: async () => {
      // RLS devolve built-ins (org_id NULL) + custom da própria org. Não
      // filtramos por org_id no client — a policy é o gate multi-tenant.
      const { data, error } = await supabase
        .from("lead_origins")
        .select("slug,name,color,sort_order,organization_id")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LeadOriginRow[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // origens mudam raramente
  });

  const origins = useMemo<LeadOriginOption[]>(() => {
    const rows = query.data;
    if (!rows || rows.length === 0) return BUILTIN_LEAD_ORIGINS;

    // Custom da org (org_id != null) sobrepõe built-in de mesmo slug.
    // `name` (coluna do banco) é exposto como `label` na API pública do hook.
    const bySlug = new Map<string, LeadOriginOption>();
    for (const r of rows) {
      const existing = bySlug.get(r.slug);
      if (!existing || (existing && r.organization_id !== null)) {
        bySlug.set(r.slug, { slug: r.slug, label: r.name, color: r.color });
      }
    }
    return Array.from(bySlug.values());
  }, [query.data]);

  const labelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of origins) m.set(o.slug, o.label);
    return m;
  }, [origins]);

  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of origins) m.set(o.slug, o.color);
    return m;
  }, [origins]);

  const labelOf = useCallback(
    (slug: string | null | undefined) => (slug ? labelMap.get(slug) ?? slug : ""),
    [labelMap],
  );

  const colorOf = useCallback(
    (slug: string | null | undefined) =>
      (slug && colorMap.get(slug)) || FALLBACK_ORIGIN_COLOR,
    [colorMap],
  );

  return { origins, labelOf, colorOf, isLoading: query.isLoading };
}
