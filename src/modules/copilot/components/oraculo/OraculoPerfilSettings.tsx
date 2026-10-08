import { useMemo, useState } from "react";
import { AlertCircle, BrainCircuit, Loader2, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useIdentity, useOrganization } from "@/modules/identity";
import { useOraculoPerfil, type OraculoPerfilRow } from "../../hooks/useOraculoPerfil";
import type { OraculoPerfilChave } from "../../hooks/useOraculoTurno";

const LABELS: Record<OraculoPerfilChave, string> = {
  sales_outside_crm: "Vendas fora do CRM",
  meeting_definition: "O que conta como reunião",
  seasonality: "Sazonalidade",
  perceived_bottleneck: "Gargalo percebido",
  personal_practice: "Prática pessoal",
};

export function OraculoPerfilSettings() {
  const { organizationId } = useOrganization();
  const { teamMemberId, isAdmin } = useIdentity();
  const profile = useOraculoPerfil(organizationId);
  const groups = useMemo(() => groupByMember(profile.data ?? []), [profile.data]);

  if (profile.isLoading) {
    return <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }
  if (profile.isError) {
    return (
      <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/[.06] p-4 text-sm text-destructive">
        Não consegui carregar o perfil da operação.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <BrainCircuit className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-lg font-bold tracking-tight">Perfil da operação</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Contexto confirmado por quem executa a venda. O Oráculo usa estas respostas nas próximas análises.
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-sunken px-6 py-10 text-center">
          <p className="text-sm font-semibold">Perfil ainda sem respostas</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            O Oráculo fará perguntas curtas depois de medir sua operação. Todas são opcionais.
          </p>
        </div>
      ) : groups.map(([memberId, rows]) => (
        <section key={memberId} className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
          <header className="border-b border-border/60 px-5 py-3.5">
            <h4 className="text-sm font-bold">{rows[0].team_member_name}</h4>
          </header>
          <div className="divide-y divide-border/60">
            {rows.map((row) => (
              <ProfileItem
                key={row.question_key}
                row={row}
                canAdjust={isAdmin}
                isOwn={row.team_member_id === teamMemberId}
                busy={profile.isSaving}
                onSave={(answer) => {
                  if (row.team_member_id === teamMemberId) profile.saveOwn(row.question_key, answer);
                  else profile.adjust(row.team_member_id, row.question_key, answer);
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProfileItem({ row, canAdjust, isOwn, busy, onSave }: {
  row: OraculoPerfilRow;
  canAdjust: boolean;
  isOwn: boolean;
  busy: boolean;
  onSave: (answer: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const initial = canAdjust && !isOwn ? row.admin_answer ?? row.member_answer : row.member_answer;
  const [draft, setDraft] = useState(initial);
  const canEdit = canAdjust || isOwn;

  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          {LABELS[row.question_key]}
        </p>
        {row.divergent && (
          <Badge variant="warning" className="gap-1">
            <AlertCircle className="h-3 w-3" /> Divergência registrada
          </Badge>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-sunken p-3">
          <p className="text-[11px] text-muted-foreground">{isOwn ? "Sua resposta" : `${row.team_member_name} descreveu`}</p>
          <p className="mt-1 text-sm leading-relaxed">{row.member_answer}</p>
        </div>
        {row.admin_answer && (
          <div className="rounded-xl border border-primary/25 bg-primary-soft/50 p-3">
            <p className="text-[11px] text-muted-foreground">Ajuste administrativo</p>
            <p className="mt-1 text-sm leading-relaxed">{row.admin_answer}</p>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            aria-label={`${canAdjust && !isOwn ? "Ajuste" : "Resposta"} para ${LABELS[row.question_key]}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={2000}
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancelar</Button>
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => { onSave(draft.trim()); setEditing(false); }}>
              {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Salvar
            </Button>
          </div>
        </div>
      ) : canEdit ? (
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
          <PencilLine className="h-3.5 w-3.5" /> {canAdjust && !isOwn ? "Ajustar leitura" : "Editar minha resposta"}
        </Button>
      ) : null}
    </div>
  );
}

function groupByMember(rows: OraculoPerfilRow[]): Array<[string, OraculoPerfilRow[]]> {
  const groups = new Map<string, OraculoPerfilRow[]>();
  for (const row of rows) groups.set(row.team_member_id, [...(groups.get(row.team_member_id) ?? []), row]);
  return [...groups.entries()];
}
