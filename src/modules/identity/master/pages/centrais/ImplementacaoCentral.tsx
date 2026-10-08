/**
 * Implementação — do contrato à primeira venda, um card por cliente (regras
 * IM-1…IM-7). Absorve Onboarding (templates) e Etapas Won/Lost, que viram
 * abas desta central: são as ferramentas da Construção de Org.
 *
 * O cartão mostra o que FALTA para a próxima etapa — o mesmo gate que o banco
 * cobra em `master_advance_implementation`. Ninguém descobre a regra pelo erro.
 */

import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  Check,
  Circle,
  Clock,
  Loader2,
  Rocket,
  RotateCw,
  Timer,
  Trophy,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { notifyError } from "@/shared/errors";
import { MasterPageHeader } from "../../components/MasterPageHeader";
import { MasterKanban, type KanbanColumnDef } from "../../components/MasterKanban";
import { usePlanCatalog } from "../../hooks/usePlanCatalog";
import { planLabel } from "../../lib/plan-label";
import {
  useAdvanceImplementation,
  useMasterImplementations,
  useMasterStaff,
  useUpdateImplementation,
  type MasterImplementation,
} from "../../hooks/useMasterImplementations";
import {
  CHECKLIST_STEPS,
  IMPLEMENTACAO_STAGES,
  IMPLEMENTACAO_STAGE_HINTS,
  IMPLEMENTACAO_STAGE_LABELS,
  STALE_STAGE_DAYS,
  canAdvance,
  checklistDone,
  daysInStage,
  isStale,
  nextStage,
  requirementsFor,
  type ImplementacaoStage,
} from "../../lib/implementacao-kanban";

const NONE = "__none__";

const COLUMNS: KanbanColumnDef<ImplementacaoStage>[] = IMPLEMENTACAO_STAGES.map((id) => ({
  id,
  label: IMPLEMENTACAO_STAGE_LABELS[id],
  hint: IMPLEMENTACAO_STAGE_HINTS[id],
}));

export default function ImplementacaoCentral() {
  const { data: items = [], isLoading, refetch, isFetching, error } = useMasterImplementations();
  const advance = useAdvanceImplementation();
  const [openId, setOpenId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out = Object.fromEntries(IMPLEMENTACAO_STAGES.map((s) => [s, [] as MasterImplementation[]])) as Record<
      ImplementacaoStage,
      MasterImplementation[]
    >;
    for (const it of items) out[it.stage].push(it);
    return out;
  }, [items]);

  const ativos = items.filter((i) => i.stage !== "concluido");
  const parados = ativos.filter((i) => isStale(i));
  const semDono = ativos.filter((i) => !i.owner_master_user_id);
  const concluidos30 = grouped.concluido.length;
  const open = items.find((i) => i.id === openId) ?? null;

  function doMove(item: MasterImplementation, to: ImplementacaoStage) {
    const v = canAdvance(item, to);
    if (!v.ok) {
      toast.error(v.reason);
      return;
    }
    advance.mutate(
      { orgId: item.organization_id, to },
      {
        onSuccess: () => toast.success(`${item.org_name}: ${IMPLEMENTACAO_STAGE_LABELS[to]}.`),
        onError: (e: unknown) => notifyError(e, { fallback: "O banco recusou a mudança de etapa." }),
      },
    );
  }

  return (
    <div className="space-y-5">
      <MasterPageHeader
        title="Implementação"
        subtitle="Do contrato à primeira venda. Cada etapa só abre quando o básico da anterior está pronto."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RotateCw className={cn("h-4 w-4", isFetching && "animate-spin")} aria-hidden />
            Atualizar
          </Button>
        }
      />

      <KpiRow cols={4}>
        <KpiTile label="Em implantação" value={ativos.length} icon={Rocket} tone="info" loading={isLoading} note="orgs fora de Concluído" />
        <KpiTile
          label={`Parados há +${STALE_STAGE_DAYS} dias`}
          value={parados.length}
          icon={Timer}
          tone={parados.length > 0 ? "warn" : "good"}
          note={parados.length > 0 ? parados.slice(0, 2).map((p) => p.org_name).join(", ") : "ninguém travado"}
          loading={isLoading}
        />
        <KpiTile
          label="Sem responsável"
          value={semDono.length}
          icon={UserRound}
          tone={semDono.length > 0 ? "bad" : "good"}
          note="sem dono, a implantação não anda"
          loading={isLoading}
        />
        <KpiTile label="Concluídos em 30 dias" value={concluidos30} icon={Trophy} tone="gold" note="com a 1ª venda registrada" loading={isLoading} />
      </KpiRow>

      {error ? (
        <p role="alert" className="rounded-card border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Não deu para carregar as implantações. A migration 20271105000100 já foi aplicada neste ambiente?
        </p>
      ) : isLoading ? (
        <div className="grid place-items-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Carregando implantações" />
        </div>
      ) : (
        <MasterKanban
          label="Implantações por etapa"
          columns={COLUMNS}
          items={grouped}
          getId={(i) => i.id}
          canDrop={(i, to) => {
            const v = canAdvance(i, to);
            return v.ok ? { ok: true } : { ok: false, reason: v.reason };
          }}
          onMove={doMove}
          onOpen={(i) => setOpenId(i.id)}
          emptyLabel={(s) => (s === "cliente_novo" ? "Nenhum cliente novo." : "Nada aqui.")}
          renderCard={(i) => <ImplementationCard item={i} />}
        />
      )}

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
          {open && <ImplementationDrawer key={open.id} item={open} onMove={(to) => doMove(open, to)} moving={advance.isPending} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ImplementationCard({ item }: { item: MasterImplementation }) {
  // Mesma query em todos os cartões: o react-query busca uma vez só.
  const { data: planos } = usePlanCatalog();
  const stale = isStale(item);
  const dias = daysInStage(item);
  const feitos = checklistDone(item.gates);
  const next = nextStage(item.stage);
  const faltando = next ? requirementsFor(item, next).filter((r) => !r.done) : [];

  return (
    <article
      className={cn(
        "rounded-2xl border border-card-border bg-card p-3 shadow-relevo transition-[box-shadow,transform] duration-150 ease-standard hover:-translate-y-px hover:shadow-relevo-alto",
        stale && "border-warning/50",
      )}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{item.org_name}</p>
        {stale && (
          <Badge variant="warning" className="shrink-0 gap-1 text-[10px]">
            <Clock className="h-3 w-3" aria-hidden />
            {dias}d
          </Badge>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {planLabel(item.subscription_plan, planos)} · {item.owner_name ?? "sem responsável"}
      </p>

      {/* IM-6: o checklist do cliente, passo a passo. */}
      <div className="mt-2.5" aria-label={`Checklist do cliente: ${feitos} de 6`}>
        <div className="flex gap-1">
          {CHECKLIST_STEPS.map(([k, label]) => (
            <span
              key={k}
              title={label}
              className={cn("h-1.5 flex-1 rounded-full", item.gates.checklist?.[k] ? "bg-success" : "bg-muted")}
            />
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Checklist do cliente {feitos} de 6</p>
      </div>

      {item.stage === "call" && item.call_scheduled_at && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
          <CalendarClock className="h-3 w-3" aria-hidden />
          {format(new Date(item.call_scheduled_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
        </p>
      )}

      {faltando.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-border/60 pt-2">
          {faltando.map((r) => (
            <li key={r.label} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Circle className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden />
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ImplementationDrawer({
  item,
  onMove,
  moving,
}: {
  item: MasterImplementation;
  onMove: (to: ImplementacaoStage) => void;
  moving: boolean;
}) {
  const { data: staff = [] } = useMasterStaff();
  const update = useUpdateImplementation();
  const [owner, setOwner] = useState(item.owner_master_user_id ?? NONE);
  const [callAt, setCallAt] = useState(item.call_scheduled_at ? format(new Date(item.call_scheduled_at), "yyyy-MM-dd'T'HH:mm") : "");
  const [participants, setParticipants] = useState(item.call_participants ?? "");
  const next = nextStage(item.stage);
  const verdict = next ? canAdvance(item, next) : null;
  const dirty =
    owner !== (item.owner_master_user_id ?? NONE) ||
    participants !== (item.call_participants ?? "") ||
    callAt !== (item.call_scheduled_at ? format(new Date(item.call_scheduled_at), "yyyy-MM-dd'T'HH:mm") : "");

  function save() {
    update.mutate(
      {
        orgId: item.organization_id,
        ownerMasterUserId: owner === NONE ? null : owner,
        callScheduledAt: callAt ? new Date(callAt).toISOString() : null,
        callParticipants: participants || null,
      },
      {
        onSuccess: () => toast.success("Implantação atualizada."),
        onError: (e: unknown) => notifyError(e, { fallback: "Não deu para salvar." }),
      },
    );
  }

  return (
    <div className="space-y-6">
      <SheetHeader className="space-y-2 pr-8 text-left">
        <Badge variant="gold" className="w-fit text-[11px]">
          {IMPLEMENTACAO_STAGE_LABELS[item.stage]} · há {formatDistanceToNow(new Date(item.stage_entered_at), { locale: ptBR })}
        </Badge>
        <SheetTitle className="text-xl font-extrabold tracking-tight">{item.org_name}</SheetTitle>
        <SheetDescription>
          Cliente desde {format(new Date(item.org_created_at), "dd 'de' MMMM", { locale: ptBR })} ·{" "}
          <Link to={`/master/organizations?org=${item.organization_id}`} className="font-semibold text-foreground underline-offset-2 hover:underline">
            abrir ficha da org
          </Link>
        </SheetDescription>
      </SheetHeader>

      {next && (
        <section className="space-y-3 rounded-card border border-card-border bg-card p-4 shadow-relevo">
          <h3 className="text-sm font-bold">Para ir a {IMPLEMENTACAO_STAGE_LABELS[next]}</h3>
          <ul className="space-y-1.5">
            {requirementsFor(item, next).map((r) => (
              <li key={r.label} className="flex items-center gap-2 text-sm">
                {r.done ? (
                  <Check className="h-4 w-4 text-success-strong" aria-label="feito" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" aria-label="falta" />
                )}
                <span className={cn(!r.done && "text-muted-foreground")}>{r.label}</span>
              </li>
            ))}
          </ul>
          <Button className="w-full gap-1.5" disabled={!verdict?.ok || moving} onClick={() => onMove(next)}>
            {moving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
            Mover para {IMPLEMENTACAO_STAGE_LABELS[next]}
          </Button>
        </section>
      )}

      <section className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="impl-owner">Responsável</Label>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger id="impl-owner">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem responsável</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.master_user_id} value={s.master_user_id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="impl-call">Call de apresentação</Label>
            <Input id="impl-call" type="datetime-local" value={callAt} onChange={(e) => setCallAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="impl-part">Participantes</Label>
            <Input id="impl-part" value={participants} maxLength={500} onChange={(e) => setParticipants(e.target.value)} placeholder="Quem vai estar na call" />
          </div>
        </div>
        <Button variant="outline" className="w-full" disabled={!dirty || update.isPending} onClick={save}>
          Salvar
        </Button>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-bold">Checklist do cliente</h3>
        <ul className="grid grid-cols-2 gap-1.5">
          {CHECKLIST_STEPS.map(([k, label]) => (
            <li key={k} className="flex items-center gap-2 text-sm">
              {item.gates.checklist?.[k] ? (
                <Check className="h-4 w-4 text-success-strong" aria-label="feito" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground" aria-label="pendente" />
              )}
              <span className={cn(!item.gates.checklist?.[k] && "text-muted-foreground")}>{label}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          É o que o cliente vê na tela dele. A conclusão da implantação lê a venda registrada, não este passo.
        </p>
      </section>
    </div>
  );
}
