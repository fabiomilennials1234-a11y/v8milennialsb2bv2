import { useState, useCallback } from "react";
import {
  Merge,
  Loader2,
  Phone,
  Mail,
  Building2,
  ArrowRight,
  CheckCircle2,
  Search,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDuplicateLeads,
  useMergeLeads,
  type DuplicateGroup,
} from "../hooks/useDuplicateLeads";

interface MatchInfo {
  label: string;
  tone: NonNullable<BadgeProps["variant"]>;
}

export default function Duplicates() {
  const { data: duplicates, isLoading, isError, error, refetch } = useDuplicateLeads();
  const mergeMutation = useMergeLeads();

  const [search, setSearch] = useState("");
  const [mergeTarget, setMergeTarget] = useState<{ keep: string; merge: string; keepName: string; mergeName: string } | null>(null);

  const filtered = duplicates?.filter((d) => {
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
  }) ?? [];

  const confirmMerge = useCallback(async () => {
    if (!mergeTarget) return;
    try {
      await mergeMutation.mutateAsync({ keep_id: mergeTarget.keep, merge_id: mergeTarget.merge });
      toast.success("Leads mesclados com sucesso");
      setMergeTarget(null);
    } catch {
      toast.error("Erro ao mesclar leads");
    }
  }, [mergeTarget, mergeMutation]);

  // Tom por tipo de coincidência — tons do `Badge` (V5), só tokens.
  const matchLabel = (type: string): MatchInfo => {
    switch (type) {
      case "phone": return { label: "Telefone", tone: "info" };
      case "email": return { label: "E-mail", tone: "gold" };
      case "name": return { label: "Nome", tone: "warning" };
      default: return { label: type, tone: "soft" };
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Duplicatas"
        subtitle={
          duplicates
            ? `${duplicates.length.toLocaleString("pt-BR")} ${duplicates.length === 1 ? "par encontrado" : "pares encontrados"}`
            : "Leads que parecem ser a mesma pessoa"
        }
        actions={
          <>
            <div className="relative w-64 max-sm:w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar duplicata…"
                aria-label="Buscar duplicata"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
              {isLoading && <Loader2 className="animate-spin" />}
              Reescanear
            </Button>
          </>
        }
      />

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
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((dup, idx) => (
            <DuplicateCard
              key={`${dup.lead_a_id}-${dup.lead_b_id}-${idx}`}
              dup={dup}
              matchLabel={matchLabel}
              onMerge={(keepId, mergeId, keepName, mergeName) =>
                setMergeTarget({ keep: keepId, merge: mergeId, keepName, mergeName })
              }
            />
          ))}
        </div>
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

function DuplicateCard({
  dup,
  matchLabel,
  onMerge,
}: {
  dup: DuplicateGroup;
  matchLabel: (type: string) => MatchInfo;
  onMerge: (keepId: string, mergeId: string, keepName: string, mergeName: string) => void;
}) {
  const match = matchLabel(dup.match_type);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Badge variant={match.tone}>
            Coincide: {match.label}
          </Badge>
          {dup.similarity > 0 && (
            <Badge variant="soft" className="tabular-nums">
              {Math.round(dup.similarity * 100)}% similar
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-start">
          <LeadSide
            name={dup.lead_a_name}
            phone={dup.lead_a_phone}
            email={dup.lead_a_email}
            company={dup.lead_a_company}
          />

          <div className="flex flex-col items-center gap-1 pt-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>

          <LeadSide
            name={dup.lead_b_name}
            phone={dup.lead_b_phone}
            email={dup.lead_b_email}
            company={dup.lead_b_company}
          />
        </div>

        <div className="mt-4 flex gap-2 border-t border-border pt-4">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onMerge(dup.lead_a_id, dup.lead_b_id, dup.lead_a_name, dup.lead_b_name)}
          >
            <Merge className="h-3.5 w-3.5" />
            Manter "{dup.lead_a_name.split(" ")[0]}"
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onMerge(dup.lead_b_id, dup.lead_a_id, dup.lead_b_name, dup.lead_a_name)}
          >
            <Merge className="h-3.5 w-3.5" />
            Manter "{dup.lead_b_name.split(" ")[0]}"
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LeadSide({
  name,
  phone,
  email,
  company,
}: {
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
}) {
  return (
    <div className="min-w-0 space-y-1 rounded-2xl bg-sunken p-3">
      <p className="truncate text-sm font-bold">{name}</p>
      {company && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Building2 className="h-3 w-3" /> {company}
        </p>
      )}
      {phone && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Phone className="h-3 w-3" /> {phone}
        </p>
      )}
      {email && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Mail className="h-3 w-3" /> {email}
        </p>
      )}
    </div>
  );
}
