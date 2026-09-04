import { Building, Mail, Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LeadStanding } from "../../lib/lead-relacao-situacao";
import type { CicloDeRecompra } from "../../lib/reorder-cycle";
import { erpLabel } from "@/shared/format/erp-code";

/**
 * O cartão de lead do celular — a lista abaixo de 768px.
 *
 * ── POR QUE ISTO SAIU DE DENTRO DA PÁGINA ─────────────────────────────────
 * O bloco vivia inline em `Leads.tsx`, entre as 1.239 linhas do arquivo, e
 * era a única entrega da fatia 1 sem nenhuma prova: montar a página inteira
 * num teste exige mockar quarenta hooks, então na prática ninguém testava
 * (`inv:H8-33`). Extrair não muda pixel nenhum — cria a costura que faltava
 * para o celular ter teste, e é onde a ordenação da lista no celular
 * (`inv:H5-22`) vai entrar sem tocar na página de novo.
 *
 * ── O QUE ESTE CARD NÃO TEM, E É DE PROPÓSITO SABER ───────────────────────
 * Medido em 2026-08-06, comparando com `LeadListRow` do desktop, o celular
 * NÃO recebe:
 *   - `deals` — a coluna de Negócios da `inv:H1-04`, entrega central da fatia
 *     1, não existe aqui. O que sobra é a linha de Situação, que diz o funil
 *     mais avançado e nada sobre valor, etapa ou tempo parado;
 *   - `metrics` — as métricas de compra da lista;
 *   - checkbox de seleção. `selecionado` pinta a borda, mas não há como
 *     selecionar pelo card: o ato de seleção só existe no desktop.
 * Nenhum dos três é regressão desta extração; os três já faltavam. Ficam
 * escritos aqui porque "a fatia 1 não existe abaixo de 768px" é vago e cada
 * uma dessas linhas é um trabalho com dono.
 */

export interface LeadMobileCardLead {
  id: string;
  name: string;
  /** Código do cliente no ERP — prefixa o nome na exibição. */
  erp_code?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  origin: string;
  pre_sale_responsible?: { name?: string | null } | null;
  sale_responsible?: { name?: string | null } | null;
}

export function LeadMobileCard({
  lead,
  standing,
  ciclo,
  selecionado = false,
  onOpen,
  originLabel,
  originClassName,
  createdLabel,
}: {
  lead: LeadMobileCardLead;
  standing?: LeadStanding;
  /**
   * Ciclo de recompra. O celular NÃO ganha o anel — 52px de gráfico num card de
   * 3 linhas custa mais do que informa. Ganha o que decide a ação: o cartão
   * esverdeia na época de recomprar e um chip diz de quanto é o ciclo. Os
   * estados "Sem compra" e "Sem informações" ficam de fora daqui de propósito:
   * seriam ruído em quase todo card, e a ficha do lead conta a história inteira.
   */
  ciclo?: CicloDeRecompra;
  selecionado?: boolean;
  onOpen: () => void;
  originLabel: string;
  originClassName?: string;
  createdLabel: string;
}) {
  return (
    <div
      onClick={onOpen}
      className={cn(
        "rounded-xl border border-border bg-card p-3.5 transition-colors active:bg-muted/50",
        ciclo?.emEpoca && "border-success/45 bg-success/[0.06]",
        selecionado && "border-primary/40 bg-primary/5",
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-semibold">{erpLabel(lead)}</p>
        {lead.company && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <Building className="h-3 w-3 shrink-0" />
            {lead.company}
          </p>
        )}
      </div>

      {/* Relação + Situação — a §6 vale para a página, e o card do celular é a
          mesma página. Ficam numa linha própria, antes das etiquetas, para não
          se perderem entre badges. */}
      <div className="mt-2 flex items-center gap-2 text-[12.5px]">
        {standing?.relacao === "cliente" ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 font-semibold text-primary">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            Cliente
          </span>
        ) : (
          <span className="text-muted-foreground">Lead</span>
        )}
        <span className="text-border">·</span>
        {standing?.emNegociacao ? (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: standing.maisAvancado?.funnelColor ?? "hsl(var(--muted-foreground))",
              }}
            />
            <span className="shrink-0 text-foreground/80">Em negociação</span>
            {standing.maisAvancado && (
              <span className="truncate">· {standing.maisAvancado.funnelName}</span>
            )}
          </span>
        ) : (
          <span className="rounded-md border border-dashed border-border px-2 py-0.5 text-muted-foreground">
            Sem negócio aberto
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={originClassName}>
          {originLabel}
        </Badge>
        {lead.pre_sale_responsible?.name && (
          <Badge variant="outline" className="border-blue-500/30 text-xs text-blue-400">
            {lead.pre_sale_responsible.name}
          </Badge>
        )}
        {lead.sale_responsible?.name && (
          <Badge variant="outline" className="border-emerald-500/30 text-xs text-emerald-400">
            {lead.sale_responsible.name}
          </Badge>
        )}
        {ciclo?.estado === "com-ciclo" && (
          <Badge
            variant="outline"
            className={cn(
              "gap-1.5 text-xs",
              ciclo.emEpoca
                ? "border-success/45 text-success"
                : "border-border text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                ciclo.emEpoca ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
            Recompra {ciclo.rotulo}
          </Badge>
        )}
      </div>

      {(lead.phone || lead.email) && (
        <div className="mt-2 flex flex-col gap-0.5">
          {lead.phone && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="h-3 w-3 shrink-0" />
              {lead.phone}
            </span>
          )}
          {lead.email && (
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{lead.email}</span>
            </span>
          )}
        </div>
      )}

      <div className="mt-2 border-t border-border/60 pt-2">
        <span className="text-[11px] text-muted-foreground">{createdLabel}</span>
      </div>
    </div>
  );
}
