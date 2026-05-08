import { useState, useCallback } from "react";
import {
  Copy,
  Merge,
  Loader2,
  Phone,
  Mail,
  Building2,
  ArrowRight,
  CheckCircle2,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useDuplicateLeads,
  useMergeLeads,
  type DuplicateGroup,
} from "@/hooks/useDuplicateLeads";
import { cn } from "@/lib/utils";

export default function Duplicates() {
  const { data: duplicates, isLoading, refetch } = useDuplicateLeads();
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

  const matchLabel = (type: string) => {
    switch (type) {
      case "phone": return { label: "Telefone", cls: "bg-blue-500/10 text-blue-500" };
      case "email": return { label: "Email", cls: "bg-purple-500/10 text-purple-500" };
      case "name": return { label: "Nome", cls: "bg-amber-500/10 text-amber-500" };
      default: return { label: type, cls: "bg-muted text-muted-foreground" };
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Copy className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Duplicatas</h1>
          {duplicates && (
            <Badge variant="secondary" className="tabular-nums">{duplicates.length}</Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar duplicata..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Reescanear
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !filtered.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <CheckCircle2 className="mb-3 h-10 w-10 opacity-40" />
          <p className="text-sm">Nenhuma duplicata encontrada</p>
        </div>
      ) : (
        <div className="space-y-3">
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
              O lead <strong>{mergeTarget?.mergeName}</strong> sera mesclado em{" "}
              <strong>{mergeTarget?.keepName}</strong>. Tags, historico e dados de pipe serao consolidados.
              Esta acao nao pode ser desfeita.
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
  matchLabel: (type: string) => { label: string; cls: string };
  onMerge: (keepId: string, mergeId: string, keepName: string, mergeName: string) => void;
}) {
  const match = matchLabel(dup.match_type);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Badge variant="outline" className={cn("text-xs", match.cls)}>
            Match: {match.label}
          </Badge>
          {dup.similarity > 0 && (
            <Badge variant="outline" className="text-xs tabular-nums">
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

        <div className="flex gap-2 mt-4 pt-3 border-t">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onMerge(dup.lead_a_id, dup.lead_b_id, dup.lead_a_name, dup.lead_b_name)}
          >
            <Merge className="mr-1.5 h-3.5 w-3.5" />
            Manter "{dup.lead_a_name.split(" ")[0]}"
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onMerge(dup.lead_b_id, dup.lead_a_id, dup.lead_b_name, dup.lead_a_name)}
          >
            <Merge className="mr-1.5 h-3.5 w-3.5" />
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
    <div className="space-y-1">
      <p className="text-sm font-medium">{name}</p>
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
