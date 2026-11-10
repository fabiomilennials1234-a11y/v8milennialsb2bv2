import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { normalizePhone } from "@/lib/normalizePhone";

/** Flag por org (`organizations.feature_flags`). */
export const FLAG_CADASTROS_DO_NUMERO = "chat_cadastros_do_numero";

export interface NegocioAberto {
  pipeline_name: string | null;
  stage_name: string | null;
}

export interface CadastroNaConversa {
  id: string;
  name: string | null;
  company: string | null;
  erp_code: string | null;
  /** Negócios abertos do cadastro (sem `closed_at` e fora de etapa final). */
  negociosAbertos: NegocioAberto[];
}

/** Com negócio aberto primeiro; depois nome, código do ERP e id (ordem estável). */
export function ordenarCadastros(a: CadastroNaConversa, b: CadastroNaConversa): number {
  const aberto = Number(b.negociosAbertos.length > 0) - Number(a.negociosAbertos.length > 0);
  return (
    aberto ||
    (a.name ?? "").localeCompare(b.name ?? "", "pt-BR", { sensitivity: "base" }) ||
    (a.erp_code ?? "").localeCompare(b.erp_code ?? "", "pt-BR", { numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Todos os cadastros VIVOS que têm o número da conversa — no telefone principal
 * (`leads.normalized_phone`) ou em `lead_phones` — com os negócios abertos de
 * cada um. A RLS recorta o que o usuário enxerga.
 *
 * Existe para a faixa automática da conversa (Café Jurerê, 10/11): o número
 * chama o vendedor sem negócio aberto, a conversa não sabe a qual cadastro se
 * ligar, e o vendedor precisa saber — sem clicar — com quem está falando.
 */
export function useCadastrosNaConversa(phone: string | null | undefined, enabled: boolean) {
  const { organizationId } = useOrganization();
  const normalized = phone ? normalizePhone(phone) : null;

  return useQuery({
    queryKey: ["cadastros_na_conversa", organizationId, normalized],
    enabled: enabled && !!organizationId && !!normalized,
    staleTime: 60_000,
    queryFn: async (): Promise<CadastroNaConversa[]> => {
      if (!organizationId || !normalized) return [];

      const [principal, extras] = await Promise.all([
        supabase
          .from("leads")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("normalized_phone", normalized)
          .is("deleted_at", null)
          .limit(50),
        supabase
          .from("lead_phones")
          .select("lead_id")
          .eq("organization_id", organizationId)
          .eq("normalized_phone", normalized)
          .is("deleted_at", null)
          .limit(50),
      ]);
      if (principal.error) throw principal.error;
      if (extras.error) throw extras.error;

      const ids = [
        ...new Set([
          ...((principal.data ?? []) as Array<{ id: string }>).map((r) => r.id),
          ...((extras.data ?? []) as Array<{ lead_id: string }>).map((r) => r.lead_id),
        ]),
      ];
      if (ids.length === 0) return [];

      const [leads, negocios] = await Promise.all([
        supabase
          .from("leads")
          .select("id, name, company, erp_code")
          .eq("organization_id", organizationId)
          .in("id", ids)
          .is("deleted_at", null),
        supabase
          .from("negocio_projetado")
          .select("lead_id, pipeline_name, stage_name, stage_is_final_positive, stage_is_final_negative")
          .eq("organization_id", organizationId)
          .in("lead_id", ids)
          .is("closed_at", null),
      ]);
      if (leads.error) throw leads.error;
      if (negocios.error) throw negocios.error;

      const abertosPorLead = new Map<string, NegocioAberto[]>();
      for (const n of (negocios.data ?? []) as Array<{
        lead_id: string;
        pipeline_name: string | null;
        stage_name: string | null;
        stage_is_final_positive: boolean | null;
        stage_is_final_negative: boolean | null;
      }>) {
        if (n.stage_is_final_positive || n.stage_is_final_negative) continue;
        const lista = abertosPorLead.get(n.lead_id) ?? [];
        lista.push({ pipeline_name: n.pipeline_name, stage_name: n.stage_name });
        abertosPorLead.set(n.lead_id, lista);
      }

      return ((leads.data ?? []) as Array<Omit<CadastroNaConversa, "negociosAbertos">>)
        .map((l) => ({ ...l, negociosAbertos: abertosPorLead.get(l.id) ?? [] }))
        .sort(ordenarCadastros);
    },
  });
}

/**
 * A faixa aparece? Número em 2+ cadastros sempre (a conversa não tem como saber
 * de quem é); 1 cadastro só quando a conversa está sem lead (o vínculo falhou,
 * mas o número é de alguém). Grupo nunca.
 */
export function deveMostrarFaixa(input: {
  cadastros: number;
  conversaTemLead: boolean;
  isGroup: boolean;
}): boolean {
  if (input.isGroup) return false;
  if (input.cadastros >= 2) return true;
  return input.cadastros === 1 && !input.conversaTemLead;
}
