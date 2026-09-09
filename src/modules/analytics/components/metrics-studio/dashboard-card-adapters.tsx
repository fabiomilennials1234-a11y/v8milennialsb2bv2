import { lazy, Suspense, useState, type ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentTeamMember, useFeaturePermission } from "@/modules/identity";
import { useOraculoChat } from "@/modules/copilot";
import { useOrgFeaturesOptional } from "@/contexts/OrgFeaturesContext";
import type { FixedCardContext } from "@/modules/analytics/lib/metrics-studio-fixed-card-contract";

const Overview = lazy(() => import("../dashboard/v2/TabVisaoGeralV2").then((m) => ({ default: m.TabVisaoGeralV2 })));
const Performance = lazy(() => import("../dashboard/v2/TabPerformanceV2").then((m) => ({ default: m.TabPerformanceV2 })));
const Health = lazy(() => import("../dashboard/TabSaude").then((m) => ({ default: m.TabSaude })));
const Map = lazy(() => import("../dashboard/v2/TabMapa").then((m) => ({ default: m.TabMapa })));
const Chat = lazy(() => import("../dashboard/OraculoChat").then((m) => ({ default: m.OraculoChat })));

type OverviewSection = ComponentProps<typeof Overview>["section"];
type PerformanceSection = ComponentProps<typeof Performance>["section"];

function OverviewCard(props: FixedCardContext & { section: OverviewSection }) {
  const { data: member } = useCurrentTeamMember();
  return <Suspense fallback={<Skeleton className="h-40 w-full" />}><Overview {...props} isAdmin={member?.role === "admin"} onAskOraculo={() => { /* O briefing tem adaptador próprio abaixo. */ }} /></Suspense>;
}
function PerformanceCard(props: FixedCardContext & { section: PerformanceSection }) {
  const { allowed, isLoading } = useFeaturePermission("performance.view");
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (!allowed) return <p className="p-4 text-sm text-muted-foreground">Você não tem permissão para ver a performance da equipe.</p>;
  return <Suspense fallback={<Skeleton className="h-40 w-full" />}><Performance {...props} /></Suspense>;
}
export function MetaMensalCard(props: FixedCardContext) { return <OverviewCard {...props} section="meta" />; }
export function IndicadoresCard(props: FixedCardContext) { return <OverviewCard {...props} section="kpis" />; }
export function ReceitaAcumuladaCard(props: FixedCardContext) { return <OverviewCard {...props} section="receita" />; }
export function FunilCard(props: FixedCardContext) { return <OverviewCard {...props} section="funil" />; }
export function OperacaoCard(props: FixedCardContext) { return <OverviewCard {...props} section="feed" />; }
export function AtividadeEquipeCard(props: FixedCardContext) { return <PerformanceCard {...props} section="atividade" />; }
export function JornadaCard(props: FixedCardContext) { return <PerformanceCard {...props} section="jornada" />; }
export function MetasEquipeCard(props: FixedCardContext) { return <PerformanceCard {...props} section="metas-equipe" />; }
export function MetasIndividuaisCard(props: FixedCardContext) { return <PerformanceCard {...props} section="metas-individuais" />; }
export function PerdasCard(props: FixedCardContext) { return <PerformanceCard {...props} section="perdas" />; }
export function RealEsperadoCard(props: FixedCardContext) { return <PerformanceCard {...props} section="real-esperado" />; }
export function SaudeCard({ range }: FixedCardContext) { return <Suspense fallback={<Skeleton className="h-64 w-full" />}><Health range={range} /></Suspense>; }
export function MapaCard() { return <Suspense fallback={<Skeleton className="h-64 w-full" />}><Map /></Suspense>; }

export function BriefingCard(props: FixedCardContext) {
  const features = useOrgFeaturesOptional();
  const enabled = features ? features.hasFeature("oraculo") : true;
  const { data: member } = useCurrentTeamMember();
  const oraculo = useOraculoChat({ month: props.month, year: props.year });
  // O chat fica dentro deste card só quando solicitado; fechar não altera o painel.
  const [open, setOpen] = useState(false);
  if (!enabled) return <p className="p-4 text-sm text-muted-foreground">O Oráculo não está incluído no plano desta organização.</p>;
  return <Suspense fallback={<Skeleton className="h-40 w-full" />}>
    <Overview {...props} section="oraculo" isAdmin={member?.role === "admin"} onAskOraculo={() => setOpen(true)} />
    {open && <Chat messages={oraculo.messages} isLoading={oraculo.isLoading} rateLimit={oraculo.rateLimit} onSend={oraculo.sendMessage} onClose={() => setOpen(false)} />}
  </Suspense>;
}
