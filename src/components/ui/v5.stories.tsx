import type { Meta, StoryObj } from "@storybook/react";
import { AlarmClock, ArrowRight, CalendarCheck, ListChecks, MessageSquareDot, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { FocusCard, FocusTile, InkPanel, InkRow, KpiTile, ValueUnit } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Vitrine do V5 — tokens, primitivos e composição, com dado de exemplo.
 * Serve para revisar o sistema sem backend e nos dois temas (alterne a
 * classe `dark` no <html> pela barra do Storybook ou pelo DevTools).
 */
const meta: Meta = {
  title: "Sistema V5/Vitrine",
  parameters: { layout: "fullscreen" },
};
export default meta;

function Bancada({ children }: { children: React.ReactNode }) {
  return (
    <div data-layout="main" className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6">{children}</div>
    </div>
  );
}

export const Composicao: StoryObj = {
  render: () => {
    const fila = [
      ["Roberto Sato", "Pode mandar a proposta pro meu e-mail?", "14:26"],
      ["Diego Fontana", "Quero falar com alguém sobre implantação.", "14:21"],
      ["Marcos Tavares", "Faturamos uns 18 milhões por ano.", "13:52"],
    ] as const;
    return (
      <Bancada>
        <PageHeader
          title="Comando"
          subtitle="Próximos passos da operação."
          actions={
            <>
              <Button variant="outline">Ver métricas</Button>
              <Button>
                <Plus />
                Novo lead
              </Button>
            </>
          }
          tabs={
            <Tabs defaultValue="a">
              <TabsList variant="pill">
                <TabsTrigger value="a">Kanban</TabsTrigger>
                <TabsTrigger value="b">Lista</TabsTrigger>
                <TabsTrigger value="c">Analytics</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <KpiTile label="Clientes esperando" value="6" icon={MessageSquareDot} tone="gold" note="Fila de resposta da equipe" />
          <KpiTile label="Tarefas abertas" value="23" icon={ListChecks} tone="info" delta={12.4} deltaLabel="vs. ontem" />
          <KpiTile label="Atrasadas" value="5" icon={AlarmClock} tone="bad" delta={-28.6} deltaLabel="vs. ontem" invertDelta />
        </div>
        <InkPanel title="Aguardando resposta" count={6}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
            <div className="flex flex-col gap-0.5">
              {fila.map(([nome, msg, hora], i) => (
                <InkRow key={nome} selected={i === 0}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold">
                    {nome.split(" ").map((p) => p[0]).join("")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{nome}</span>
                    <span className="block truncate text-[11.5px] opacity-70">{msg}</span>
                  </span>
                  <span className="text-[11.5px] font-bold tabular-nums">{hora}</span>
                </InkRow>
              ))}
            </div>
            <FocusCard>
              <p className="text-[11px] font-bold opacity-70">Próximo a responder</p>
              <p className="text-[1.35rem] font-extrabold tracking-[-0.03em]">Roberto Sato</p>
              <FocusTile className="text-[14px] font-semibold">“Pode mandar a proposta pro meu e-mail?”</FocusTile>
              <Button variant="on-gold">
                Abrir conversa <ArrowRight />
              </Button>
            </FocusCard>
          </div>
        </InkPanel>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Metas do mês</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[1.65rem] font-extrabold tracking-[-0.04em] tabular-nums">
                R$ 212.400<ValueUnit>,00</ValueUnit>
              </p>
              <p className="text-xs text-muted-foreground">de R$ 300.000</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <CalendarCheck className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Próximas agendas</CardTitle>
              <Button variant="ink" size="sm" className="ml-auto">
                Ver agenda
              </Button>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="gold">Reunião marcada</Badge>
              <Badge variant="success">Compareceu</Badge>
              <Badge variant="warning">Atrasada</Badge>
              <Badge variant="info">Agendada</Badge>
              <Badge variant="soft">Sem dono</Badge>
              <Badge variant="ink">Equipe</Badge>
            </CardContent>
          </Card>
        </div>
      </Bancada>
    );
  },
};

export const Abas: StoryObj = {
  render: () => (
    <Bancada>
      {(["pill", "segmented", "underline"] as const).map((variant) => (
        <Tabs key={variant} defaultValue="a">
          <TabsList variant={variant}>
            <TabsTrigger value="a">Visão geral</TabsTrigger>
            <TabsTrigger value="b">Saúde</TabsTrigger>
            <TabsTrigger value="c">Mapa</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="text-xs text-muted-foreground">
            variante <code>{variant}</code>
          </TabsContent>
        </Tabs>
      ))}
    </Bancada>
  ),
};

export const Botoes: StoryObj = {
  render: () => (
    <Bancada>
      <div className="flex flex-wrap items-center gap-3">
        <Button>Primário (ouro)</Button>
        <Button variant="ink">Tinta</Button>
        <Button variant="outline">Contorno</Button>
        <Button variant="secondary">Secundário</Button>
        <Button variant="ghost">Fantasma</Button>
        <Button variant="destructive">Excluir</Button>
        <Button size="icon" variant="outline" aria-label="Adicionar">
          <Plus />
        </Button>
      </div>
    </Bancada>
  ),
};
