import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Users,
  Gauge,
  MessageCircle,
  Send,
  GitBranch,
  Zap,
  Settings,
  CalendarDays,
  ChartNoAxesCombined,
} from "lucide-react";
import "@/index.css";
import { ClientPortfolio } from "@/modules/leads/components/client-portfolio/ClientPortfolio";
import { calcularCicloDeRecompra } from "@/modules/leads/lib/reorder-cycle";
import {
  filterPortfolio,
  reorderStatus,
} from "@/modules/leads/components/client-portfolio/portfolio-model";
import type {
  PortfolioSegment,
  PortfolioReorder,
} from "@/modules/leads/lib/client-portfolio-contract";
import type { PortfolioClient } from "@/modules/leads/components/client-portfolio/portfolio-model";
import type { LeadDeal } from "@/modules/leads/hooks/useLeadsDeals";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
const now = Date.parse("2026-09-16T12:00:00Z");
const names = [
  "Aurora Distribuidora",
  "Norte Sul Alimentos",
  "Atlas Embalagens",
  "Vale Verde Atacado",
  "Horizonte Industrial",
  "Origem Comercial",
];
const dates = [
  ["2026-07-17", "2026-08-14"],
  ["2026-07-20", "2026-08-19"],
  ["2026-08-07", "2026-09-04"],
  ["2026-07-11", "2026-08-25"],
  ["2026-07-20"],
  ["2026-07-06", "2026-08-05"],
];
const clients: PortfolioClient[] = names.map((name, i) => ({
  id: `client-${i}`,
  name,
  company: name,
  firstPurchaseAt: dates[i][0],
  identity: `CNPJ ${12 + i}.345.678/0001-90`,
  cycle: calcularCicloDeRecompra(dates[i], now),
  metrics: {
    leadId: `client-${i}`,
    lifetimeValue: [184500, 82500, 42000, 18200, 7900, 24000][i],
    avgTicket: 10250,
    orderCount: [18, 12, 7, 4, 1, 6][i],
    reorderCycleDays: 28,
    daysSinceLastOrder: 33,
    segment: ["ouro", "prata", "ouro", "bronze", "prata", "bronze"][i],
  },
  deals:
    i === 3
      ? []
      : [
          {
            id: `deal-${i}`,
            leadId: `client-${i}`,
            title: "Reposição de estoque",
            funnelName: "Vendas",
            funnelColor: "",
            pipelineId: "pipeline",
            pipelineSlug: "vendas",
            isSystem: true,
            stageKey: "proposta",
            stageName: "Proposta enviada",
            stagePosition: 1,
            stageIndex: 1,
            stageCount: 4,
            stages: ["Contato", "Proposta", "Negociação", "Fechamento"].map((name, n) => ({ id: String(n), name })),
            outcome: "open",
            won: false,
            value: 12800,
            meetingDate: null,
            enteredAt: null,
            stageChangedAt: null,
            daysInStage: 2,
          } satisfies LeadDeal,
        ],
}));
export function Preview() {
  const [selected, setSelected] = useState("client-0");
  const [segment, setSegment] = useState<PortfolioSegment>("all");
  const [reorder, setReorder] = useState<PortfolioReorder>("all");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState("");
  const visible = filterPortfolio(
    clients.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())),
    segment,
    reorder,
  );
  const activeId = visible.some((c) => c.id === selected) ? selected : visible[0]?.id ?? null;
  const summary = {
    monthlyRevenue: visible.reduce(
      (sum, c) =>
        sum +
        (c.cycle?.diasDesdeUltima != null && c.cycle.diasDesdeUltima < 16
          ? 10250
          : 0),
      0,
    ),
    expectedCount: visible.filter((c) => reorderStatus(c.cycle) === "soon")
      .length,
    overdueCount: visible.filter((c) => reorderStatus(c.cycle) === "late")
      .length,
  };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-[190px] border-r border-border bg-card/30 px-3 py-6 lg:block">
        <div className="px-3 text-3xl font-black italic tracking-tight">
          TORQUE<span className="text-primary">.</span>
        </div>
        <p className="mb-10 mt-2 px-3 text-[9px] uppercase tracking-[0.25em] text-muted-foreground">
          CRM para vendas reais
        </p>
        <nav className="space-y-2">
          {[
            { label: "Comando", icon: Gauge },
            { label: "Métricas", icon: ChartNoAxesCombined },
            { label: "Chat", icon: MessageCircle },
            { label: "Disparos", icon: Send },
            { label: "Funis", icon: GitBranch },
            { label: "Leads", icon: Users },
            { label: "Turbo", icon: Zap },
          ].map(({ label, icon: Icon }) => (
            <div
              key={label}
              className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm ${label === "Leads" ? "border-l-2 border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground"}`}
            >
              <Icon className="size-5" />
              {label}
            </div>
          ))}
        </nav>
        <div className="absolute bottom-6 space-y-5 px-3 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <CalendarDays className="size-4" />
            Agenda
          </div>
          <div className="flex gap-3">
            <Settings className="size-4" />
            Pitstop
          </div>
        </div>
      </aside>
      <main className="px-4 py-6 sm:px-7 lg:ml-[190px]">
        <div className="mb-6 text-xs text-muted-foreground">
          Relacionamento / Leads
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">Leads</h1>
            <p className="mt-2 text-muted-foreground">
              Da primeira conversa à próxima compra.
            </p>
          </div>
          <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground md:block">
            Prévia · dados fictícios
          </span>
        </div>
        <div className="mb-5 mt-7 flex gap-8 border-b border-border text-sm">
          {["Todos", "Leads", "Clientes", "Inativos"].map((label) => (
            <span
              key={label}
              className={`pb-3 ${label === "Clientes" ? "border-b-2 border-primary font-semibold text-primary" : "text-muted-foreground"}`}
            >
              {label}
            </span>
          ))}
        </div>
        <ClientPortfolio
          clients={visible}
          total={visible.length}
          summary={summary}
          segment={segment}
          onSegment={setSegment}
          reorder={reorder}
          onReorder={setReorder}
          selectedId={activeId}
          onSelect={setSelected}
          search={search}
          onSearch={setSearch}
          canCreate
          onRetry={() => {}}
          onNewDeal={(id) =>
            setDialog(
              `Novo negócio · ${clients.find((c) => c.id === id)?.name}`,
            )
          }
          onOpenLead={(id) =>
            setDialog(`Cadastro · ${clients.find((c) => c.id === id)?.name}`)
          }
          onOpenDeal={(deal) => setDialog(deal.title)}
          purchases={(dates[Number(activeId?.split("-")[1])] ?? [])
            .slice()
            .reverse()
            .map((date, i) => ({
              id: `purchase-${i}`,
              date,
              value: i ? 9800 : 10250,
              source: "CRM" as const,
            }))}
          now={now}
          filters={
            <p className="text-xs text-muted-foreground">
              Dono da conta · Todos
            </p>
          }
          pagination={
            <div className="flex items-center justify-between px-5 py-4 text-xs text-muted-foreground">
              <span>Mostrando {visible.length} clientes</span>
              <Button variant="outline" size="sm" disabled>
                1
              </Button>
            </div>
          }
        />
        <Dialog
          open={!!dialog}
          onOpenChange={(v) => {
            if (!v) setDialog("");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog}</DialogTitle>
              <DialogDescription>
                Prévia visual. Na aplicação, esta ação abre o fluxo existente
                vinculado ao cliente. Nenhum dado é gravado aqui.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
