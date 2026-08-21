/**
 * O que o ERP sabe sobre este cliente.
 *
 * A sincronização traz 56 campos de `/clientes`; a carteira guardava 6. Este
 * bloco expõe o que passou a ser gravado — vendedor dono da conta, segmento,
 * praça, antiguidade — porque dado que ninguém vê não muda atendimento nenhum.
 *
 * Só aparece para cliente que veio de ERP. Cliente cadastrado à mão não tem
 * nada aqui, e um card vazio prometendo integração é pior que card nenhum.
 */

import { useQuery } from "@tanstack/react-query";
import { Building2, MapPin, User, Tag, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ErpRow {
  external_source: string | null;
  erp_company: string | null;
  erp_owner_name: string | null;
  erp_status: string | null;
  erp_segment: string | null;
  erp_registered_at: string | null;
  erp_city: string | null;
  erp_uf: string | null;
  erp_metadata: Record<string, unknown> | null;
}

/** Rótulos dos campos que moram no metadata, na ordem em que interessam. */
const META_LABELS: Array<[string, string]> = [
  ["logradouro", "Logradouro"],
  ["numero", "Número"],
  ["complemento", "Complemento"],
  ["bairro", "Bairro"],
  ["cep", "CEP"],
  ["numeroInscricaoEstadual", "Inscrição estadual"],
  ["contribuinteIcms", "Contribuinte ICMS"],
  ["site", "Site"],
];

const PESSOA: Record<string, string> = { J: "Pessoa jurídica", F: "Pessoa física" };

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : null;
}

export function ClienteDadosErp({ clientId }: { clientId: string | undefined }) {
  const { organizationId } = useOrganization();

  const { data } = useQuery({
    queryKey: ["client-erp-data", organizationId, clientId],
    queryFn: async (): Promise<ErpRow | null> => {
      if (!organizationId || !clientId) return null;
      const { data, error } = await supabase
        .from("upsell_clients")
        .select(
          "external_source, erp_company, erp_owner_name, erp_status, erp_segment, " +
            "erp_registered_at, erp_city, erp_uf, erp_metadata",
        )
        .eq("organization_id", organizationId)
        .eq("id", clientId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ErpRow | null;
    },
    enabled: !!organizationId && !!clientId,
    staleTime: 60_000,
  });

  if (!data?.external_source) return null;

  const meta = (data.erp_metadata ?? {}) as Record<string, unknown>;
  const cadastro = formatDate(data.erp_registered_at);
  const praca = [data.erp_city, data.erp_uf].filter(Boolean).join(" · ");
  const pessoa = typeof meta.tipoPessoa === "string" ? PESSOA[meta.tipoPessoa] : null;

  const detalhes = META_LABELS.map(([key, label]) => {
    const value = meta[key];
    return value === undefined || value === null || value === ""
      ? null
      : { label, value: String(value) };
  }).filter(Boolean) as Array<{ label: string; value: string }>;

  const destaques = [
    data.erp_owner_name && { Icon: User, label: "Representante", value: data.erp_owner_name },
    data.erp_company && { Icon: Building2, label: "Empresa", value: data.erp_company },
    data.erp_segment && { Icon: Tag, label: "Segmento", value: data.erp_segment },
    praca && { Icon: MapPin, label: "Praça", value: praca },
    cadastro && { Icon: CalendarDays, label: "Cliente desde", value: cadastro },
  ].filter(Boolean) as Array<{ Icon: typeof User; label: string; value: string }>;

  if (destaques.length === 0 && detalhes.length === 0) return null;

  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold text-card-foreground">Dados do ERP</CardTitle>
        <div className="flex items-center gap-1">
          {pessoa && (
            <Badge variant="outline" className="text-[10px] font-normal">
              {pessoa}
            </Badge>
          )}
          {/* Situação vem CRUA do ERP — 0/1/2/3 sem legenda do fornecedor.
              Mostrar o código sem inventar tradução é mais honesto que chamar
              de "ativo" o que ninguém confirmou que é. */}
          {data.erp_status && (
            <Badge variant="outline" className="text-[10px] font-normal">
              situação {data.erp_status}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {destaques.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {destaques.map(({ Icon, label, value }) => (
              <li key={label} className="flex items-start gap-2">
                <Icon size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground leading-none mb-0.5">{label}</p>
                  <p className="text-xs text-card-foreground break-words">{value}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {detalhes.length > 0 && (
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2 pt-2 border-t border-border">
            {detalhes.map(({ label, value }) => (
              <div key={label} className="flex items-baseline justify-between gap-2 min-w-0">
                <dt className="text-[11px] text-muted-foreground shrink-0">{label}</dt>
                <dd className="text-[11px] text-card-foreground truncate">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
