import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Merge,
  Loader2,
  CheckCircle2,
  Search,
  AlertTriangle,
  RefreshCw,
  Copy,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FocusCard, FocusTile, InkRow, InkSplit, KpiTile } from "@/components/ui/bento";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  useDuplicateLeads,
  useMergeLeads,
  useDuplicatePairDetail,
  type DuplicateGroup,
  type DuplicatePairLead,
} from "../hooks/useDuplicateLeads";
import { useLeadsDeals } from "../hooks/useLeadsDeals";
import { deriveLeadStanding } from "../lib/lead-relacao-situacao";
import { QUALIFICATION_TIER_CONFIG } from "../components/lead-detail/modal/qualification-config";
import type { QualificationTier } from "../components/lead-detail/modal/types";
import { notifyError } from "@/shared/errors";

/**
 * Duplicatas — fila em tinta + o par em ouro (mockup V5).
 *
 * As ações são as duas que existiam ("Manter A" / "Manter B" → `merge_leads`).
 * Entra a comparação campo a campo do par em foco (decisão do líder): uma
 * leitura dos dois leads + os negócios deles, só para o par selecionado.
 * "Mensagens", regras de detecção e "Não é duplicata" ficam fora — não existem.
 */

type Criterio = "all" | "name" | "email" | "phone";

const MATCH: Record<string, { label: string; frase: string }> = {
  phone: { label: "Telefone", frase: "Mesmo telefone" },
  email: { label: "E-mail", frase: "Mesmo e-mail" },
  name: { label: "Nome", frase: "Nome parecido" },
};

const ORIGIN_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  outro: "Outros",
  site: "Site",
  remarketing: "Remarketing",
  google_ads: "Google Ads",
  cal: "Cal.com",
  indicacao: "Indicação",
};

function initials(text: string): string {
  return (
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function pairKey(d: DuplicateGroup) {
  return `${d.lead_a_id}-${d.lead_b_id}`;
}

export default function Duplicates() {
  const navigate = useNavigate();
  const { data: duplicates, isLoading, isError, error, refetch, isFetching } = useDuplicateLeads();
  const mergeMutation = useMergeLeads();

  const [search, setSearch] = useState("");
  const [criterio, setCriterio] = useState<Criterio>("all");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<{ keep: string; merge: string; keepName: string; mergeName: string } | null>(null);

  const filtered = useMemo(
    () =>
      (duplicates ?? []).filter((d) => {
        if (criterio !== "all" && d.match_type !== criterio) return false;
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          d.lead_a_name.toLowerCase().includes(q) ||
          d.lead_b_name.toLowerCase().includes(q) ||
          d.lead_a_phone?.includes(q) ||
          d.lead_b_phone?.includes(q) ||
          d.lead_a_company?.toLowerCase().includes(q) ||
          d.lead_b_company?.toLowerCase().includes(q)
        );
      }),
    [duplicates, criterio, search],
  );

  const focused = filtered.find((d) => pairKey(d) === focusKey) ?? filtered[0] ?? null;
  useEffect(() => {
    if (focusKey && !filtered.some((d) => pairKey(d) === focusKey)) setFocusKey(null);
  }, [filtered, focusKey]);

  const confirmMerge = useCallback(async () => {
    if (!mergeTarget) return;
    try {
      await mergeMutation.mutateAsync({ keep_id: mergeTarget.keep, merge_id: mergeTarget.merge });
      toast.success("Leads mesclados com sucesso");
      setMergeTarget(null);
    } catch (caught) {
      notifyError(caught, { fallback: "Não foi possível mesclar leads." });
    }
  }, [mergeTarget, mergeMutation]);

  const total = duplicates?.length ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Duplicatas"
        subtitle="Leads que parecem a mesma pessoa. Revise, mescle e mantenha o histórico inteiro."
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading || isFetching}>
            {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Reanalisar base
          </Button>
        }
      />

      <KpiTile
        className="sm:max-w-[320px]"
        label="Pares para revisar"
        value={isLoading ? "·" : total.toLocaleString("pt-BR")}
        loading={isLoading}
        icon={Copy}
        tone={total > 0 ? "warn" : "good"}
        note={total > 0 ? "leads que parecem a mesma pessoa" : "nenhum par encontrado"}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-[13px] font-bold">Critério</span>
        <Tabs value={criterio} onValueChange={(v) => setCriterio(v as Criterio)}>
          <TabsList variant="segmented" aria-label="Critério da duplicata">
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="name">Nome</TabsTrigger>
            <TabsTrigger value="email">E-mail</TabsTrigger>
            <TabsTrigger value="phone">Telefone</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="hidden flex-1 sm:block" />
        <div className="relative w-full sm:w-[240px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar duplicata…"
            aria-label="Buscar duplicata"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[38px] rounded-full pl-10 shadow-relevo"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-card-border bg-card py-24 text-center shadow-relevo">
          <AlertTriangle className="mb-3 h-10 w-10 text-destructive/70" />
          <p className="text-sm font-medium">Não foi possível carregar as duplicatas</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            {(error as Error)?.message ?? "Erro inesperado ao buscar duplicatas."}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-card-border bg-card py-24 text-muted-foreground shadow-relevo">
          <CheckCircle2 className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">Nenhuma duplicata encontrada</p>
        </div>
      ) : (
        <InkSplit
          title="Possíveis duplicatas"
          count={`${filtered.length} ${filtered.length === 1 ? "par" : "pares"}`}
          listClassName="max-h-[640px] overflow-y-auto"
          list={filtered.map((dup) => {
            const selected = focused ? pairKey(focused) === pairKey(dup) : false;
            const match = MATCH[dup.match_type];
            return (
              <InkRow key={pairKey(dup)} selected={selected} onClick={() => setFocusKey(pairKey(dup))}>
                <span className="flex shrink-0 -space-x-2">
                  {[dup.lead_a_name, dup.lead_b_name].map((n, i) => (
                    <span
                      key={i}
                      className={cn(
                        "grid size-8 place-items-center rounded-full border-2 text-[10.5px] font-extrabold",
                        selected ? "border-primary bg-primary-foreground/10" : "border-tinta bg-white/10 text-tinta-foreground",
                      )}
                    >
                      {initials(n)}
                    </span>
                  ))}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-bold">{dup.lead_a_name}</span>
                  <span className={cn("block truncate text-[11px]", selected ? "text-primary-foreground/70" : "text-tinta-muted")}>
                    {[match?.frase.toLowerCase() ?? dup.match_type, dup.lead_a_company ?? dup.lead_b_company].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {dup.similarity > 0 && (
                  <span className="shrink-0 text-[12px] font-extrabold tabular-nums">{Math.round(dup.similarity * 100)}%</span>
                )}
              </InkRow>
            );
          })}
          detail={
            focused && (
              <PairCard
                dup={focused}
                onOpenLead={(id) => navigate(`/leads?lead=${id}`)}
                onMerge={(keepId, mergeId, keepName, mergeName) =>
                  setMergeTarget({ keep: keepId, merge: mergeId, keepName, mergeName })
                }
              />
            )
          }
        />
      )}

      <AlertDialog open={!!mergeTarget} onOpenChange={(o) => !o && setMergeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mesclar leads</AlertDialogTitle>
            <AlertDialogDescription>
              O lead <strong>{mergeTarget?.mergeName}</strong> será mesclado em{" "}
              <strong>{mergeTarget?.keepName}</strong>. Tags, histórico e dados de funil serão consolidados.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmMerge}>
              {mergeMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Mesclar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PairCard({
  dup,
  onMerge,
  onOpenLead,
}: {
  dup: DuplicateGroup;
  onMerge: (keepId: string, mergeId: string, keepName: string, mergeName: string) => void;
  onOpenLead: (id: string) => void;
}) {
  const ids = useMemo<[string, string]>(() => [dup.lead_a_id, dup.lead_b_id], [dup.lead_a_id, dup.lead_b_id]);
  const { data: detail, isLoading } = useDuplicatePairDetail(ids);
  const { data: deals } = useLeadsDeals(ids);
  const match = MATCH[dup.match_type];
  const sim = Math.round((dup.similarity ?? 0) * 100);
  const c = 2 * Math.PI * 16;

  const etapa = (id: string) => {
    const s = deriveLeadStanding({ deals: deals?.[id] });
    return s.maisAvancado?.stageName ?? (deals?.[id]?.length ? "sem negócio aberto" : "sem negócio");
  };
  const tier = (l?: DuplicatePairLead) =>
    l?.qualification_tier ? QUALIFICATION_TIER_CONFIG[l.qualification_tier as QualificationTier]?.label ?? l.qualification_tier : "—";

  const a = detail?.[dup.lead_a_id];
  const b = detail?.[dup.lead_b_id];
  const rows: { label: string; a: string; b: string }[] = [
    { label: "Empresa", a: dup.lead_a_company ?? "—", b: dup.lead_b_company ?? "—" },
    { label: "Estado", a: a?.uf ?? "—", b: b?.uf ?? "—" },
    { label: "Origem", a: a?.origin ? ORIGIN_LABEL[a.origin] ?? a.origin : "—", b: b?.origin ? ORIGIN_LABEL[b.origin] ?? b.origin : "—" },
    { label: "Etapa", a: etapa(dup.lead_a_id), b: etapa(dup.lead_b_id) },
    { label: "Qualificação", a: tier(a), b: tier(b) },
    { label: "Responsável", a: a?.responsible ?? "—", b: b?.responsible ?? "—" },
    { label: "Tags", a: a?.tags.length ? a.tags.join(", ") : "—", b: b?.tags.length ? b.tags.join(", ") : "—" },
    {
      label: "Criado em",
      a: a ? new Date(a.created_at).toLocaleDateString("pt-BR") : "—",
      b: b ? new Date(b.created_at).toLocaleDateString("pt-BR") : "—",
    },
  ];

  const side = (name: string, company: string | null, phone: string | null, email: string | null, tag: string) => (
    <FocusTile className="min-w-0 px-3.5 py-3">
      <p className="text-[11px] font-bold text-primary-foreground/70">{tag}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-foreground/10 text-[12px] font-extrabold">
          {initials(name)}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[14px] font-extrabold">{name}</p>
          {company && <p className="truncate text-[11px] font-semibold text-primary-foreground/70">{company}</p>}
        </div>
      </div>
      <p className="mt-2 truncate font-mono text-[12px] font-semibold">{phone ?? "—"}</p>
      <p className="truncate text-[12px] font-semibold text-primary-foreground/80">{email ?? "—"}</p>
    </FocusTile>
  );

  return (
    <FocusCard className="min-h-[340px] gap-4 p-[18px]" aria-label={`Par: ${dup.lead_a_name} e ${dup.lead_b_name}`}>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-2.5 py-1 text-[11px] font-bold text-primary">
          <Copy className="size-3" aria-hidden />
          {match?.frase ?? `Coincide: ${dup.match_type}`}
        </span>
        <span className="flex-1" />
        {sim > 0 && (
          <span className="relative grid size-12 place-items-center" role="img" aria-label={`${sim}% de similaridade`}>
            <svg className="absolute inset-0 size-12 -rotate-90" viewBox="0 0 40 40" aria-hidden>
              <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-primary-foreground/15" />
              <circle
                cx="20"
                cy="20"
                r="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={`${(sim / 100) * c} ${c}`}
                className="text-primary-foreground"
              />
            </svg>
            <span className="text-[10px] font-extrabold tabular-nums tracking-[-0.02em]">{sim}%</span>
          </span>
        )}
      </div>

      <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {side(dup.lead_a_name, dup.lead_a_company, dup.lead_a_phone, dup.lead_a_email, "Lead A")}
        <span className="mx-auto grid size-8 place-items-center rounded-full bg-primary-foreground text-primary" aria-hidden>
          <Merge className="size-4" />
        </span>
        {side(dup.lead_b_name, dup.lead_b_company, dup.lead_b_phone, dup.lead_b_email, "Lead B")}
      </div>

      {/* Campo a campo — o que difere fica em negrito */}
      <FocusTile className="overflow-hidden p-0">
        <table className="w-full table-fixed text-[12px]">
          <colgroup>
            <col className="w-[104px]" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr className="text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-primary-foreground/70">
              <th className="px-3 py-2 font-bold">Campo</th>
              <th className="px-3 py-2 font-bold">Lead A</th>
              <th className="px-3 py-2 font-bold">Lead B</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const difere = r.a !== r.b;
              return (
                <tr key={r.label} className="border-t border-primary-foreground/10">
                  <td className="px-3 py-1.5 font-semibold text-primary-foreground/70">{r.label}</td>
                  <td className={cn("max-w-0 truncate px-3 py-1.5", difere ? "font-extrabold" : "font-medium")} title={r.a}>
                    {isLoading ? "…" : r.a}
                  </td>
                  <td className={cn("max-w-0 truncate px-3 py-1.5", difere ? "font-extrabold" : "font-medium")} title={r.b}>
                    {isLoading ? "…" : r.b}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </FocusTile>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-primary-foreground/15 pt-3.5">
        <Button
          variant="on-gold"
          onClick={() => onMerge(dup.lead_a_id, dup.lead_b_id, dup.lead_a_name, dup.lead_b_name)}
        >
          <Merge className="h-3.5 w-3.5" />
          Manter "{dup.lead_a_name.split(" ")[0]}"
        </Button>
        <Button
          variant="outline"
          className="border-primary-foreground/20 bg-primary-foreground/[.07] text-primary-foreground shadow-none hover:-translate-y-0 hover:border-primary-foreground/30 hover:bg-primary-foreground/15 hover:text-primary-foreground"
          onClick={() => onMerge(dup.lead_b_id, dup.lead_a_id, dup.lead_b_name, dup.lead_a_name)}
        >
          <Merge className="h-3.5 w-3.5" />
          Manter "{dup.lead_b_name.split(" ")[0]}"
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          onClick={() => onOpenLead(dup.lead_a_id)}
        >
          Abrir lead A
          <ArrowUpRight />
        </Button>
      </div>
    </FocusCard>
  );
}
