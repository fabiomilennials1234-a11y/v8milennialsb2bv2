import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { AlarmClock, CalendarCheck, CalendarClock, MessageSquareDot, Target } from "lucide-react";
import { ComandoCard } from "../ComandoCard";
import type { VisaoAgenda } from "@/modules/analytics/hooks/useEscopoAgenda";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { TooltipProvider } from "@/components/ui/tooltip";
import { paraDia, type AgendaContato, type FiltroAgenda, type ResumoAgendaLinha } from "@/modules/analytics/lib/agenda-contatos";
import { AgendaContatosView } from "./CardAgendaContatos";
import { ResumoAgendaView } from "./CardResumoAgenda";

const HOJE = "2026-11-10";
const somar = (n: number) => {
  const d = new Date(2026, 10, 10);
  d.setDate(d.getDate() + n);
  return paraDia(d);
};
const situacao = (dia: string) => (dia < HOJE ? "atrasada" : dia === HOJE ? "hoje" : "futura") as AgendaContato["situacao"];

// Clientes fictícios — nenhum é cliente real.
const BASE: Array<[string, string | null, string | null, string, number, string | null, string]> = [
  ["Padaria Sol Nascente", "Sol Nascente Alimentos", "10432", "5548991230001", -6, "Cobrar retorno da degustação", "Carol"],
  ["Mercado Bom Preço", "Bom Preço Supermercados", "10877", "5548991230002", -2, null, "Tatiane"],
  ["Café do Porto", null, "11204", "5548991230003", -1, "Pediu tabela nova", "Carol"],
  ["Empório Lagoa", "Lagoa Empório LTDA", "10988", "5548991230004", 0, "Fechar pedido de dezembro", "Carol"],
  ["Hotel Costa Azul", "Costa Azul Hotelaria", "12001", "5548991230005", 0, null, "Tatiane"],
  ["Restaurante Maré", "Maré Gastronomia", null, "5548991230006", 0, null, "Carol"],
  ["Loja Grão Fino", "Grão Fino Comércio", "11555", "5548991230007", 2, null, "Carol"],
  ["Bistrô Jardim", null, "12345", "5548991230008", 3, "Retornar após férias do comprador", "Tatiane"],
  ["Conveniência 24h Centro", "Centro Conveniência", "10111", "5548991230009", 7, null, "Carol"],
  ["Doceria Flor de Sal", "Flor de Sal Doces", "11876", "5548991230010", 12, null, "Tatiane"],
];

const CIDADES = ["FLORIANOPOLIS", "ITAPEMA", "BALNEARIO CAMBORIU", "TIJUCAS", "CHAPECO", "JOINVILLE"];

const ITENS: AgendaContato[] = BASE.map(([nome, empresa, erp, fone, dias, obs, dono], i) => {
  const dia = somar(dias);
  return {
    id: `a${i}`,
    lead_id: `l${i}`,
    lead_name: nome,
    lead_company: empresa,
    lead_phone: fone,
    lead_phones: i % 3 === 1 ? [fone, `554733${String(1000 + i).slice(-4)}000`.slice(0, 12)] : [fone],
    lead_erp_code: erp,
    lead_uf: "SC",
    lead_cidade: CIDADES[i % CIDADES.length],
    erp_representante: dono === "Carol" ? "CAROLINI POLI SILVA" : "TATIANE SILVEIRA DE OLIVEIRA",
    owner_id: dono === "Carol" ? "tm-carol" : "tm-tati",
    owner_name: dono,
    data_agenda: dia,
    observacao: obs,
    situacao: situacao(dia),
    created_at: "2026-11-01T12:00:00Z",
  };
});

function resumoDe(itens: AgendaContato[]): ResumoAgendaLinha[] {
  const m = new Map<string, ResumoAgendaLinha>();
  for (const a of itens) {
    const chave = a.situacao === "atrasada" ? "atrasada" : a.data_agenda;
    const atual = m.get(chave) ?? { dia: a.situacao === "atrasada" ? null : a.data_agenda, situacao: a.situacao, total: 0 };
    atual.total += 1;
    m.set(chave, atual);
  }
  return [...m.values()];
}

function TelaDoComando({ isAdmin, itens: iniciais }: { isAdmin: boolean; itens: AgendaContato[] }) {
  const [filtro, setFiltro] = useState<FiltroAgenda>("todas");
  // Estado local: na story o X tira a linha e remarcar troca a data e a cor,
  // como no app — sem banco.
  const [todas, setItens] = useState(iniciais);
  // Admin alterna Meu/Todos; na prévia "eu" sou a Carol.
  const [visao, setVisao] = useState<VisaoAgenda>("todos");
  const itens = isAdmin && visao === "meu" ? todas.filter((a) => a.owner_name === "Carol") : todas;
  const linhas = resumoDe(itens);
  const n = (s: AgendaContato["situacao"]) => itens.filter((a) => a.situacao === s).length;
  return (
    <TooltipProvider>
      <div className="flex max-w-[1240px] flex-col gap-4 bg-background p-6">
        <KpiRow cols={4}>
          <KpiTile label="Clientes esperando" value="4" icon={MessageSquareDot} tone="gold" note="mais antigo há 2 h" />
          <KpiTile label="Agendas de hoje" value={String(n("hoje"))} icon={CalendarClock} tone={n("hoje") ? "warn" : "neutral"} note="Clientes para contatar hoje" />
          <KpiTile label="Agendas atrasadas" value={String(n("atrasada"))} icon={AlarmClock} tone={n("atrasada") ? "bad" : "good"} note="Passaram da data, ainda abertas" />
          <KpiTile label="Reuniões hoje" value="2" icon={CalendarCheck} tone="info" note="0 realizadas" />
        </KpiRow>
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            {/* Metas do mês: bloco inalterado, só ocupa o lugar dele aqui. */}
            <ComandoCard icon={Target} title="Metas do mês" isEmpty emptyTitle="Metas do mês" emptyHint="Bloco inalterado — fica como está hoje." className="min-h-[318px]" />
          </div>
          <div className="min-w-0">
            <ResumoAgendaView linhas={linhas} hoje={HOJE} isAdmin={isAdmin && visao === "todos"} filtro={filtro} onFiltro={setFiltro} />
          </div>
        </div>
        <AgendaContatosView
          itens={itens}
          hoje={HOJE}
          isAdmin={isAdmin && visao === "todos"}
          visao={isAdmin ? visao : undefined}
          onVisao={setVisao}
          filtro={filtro}
          onFiltro={setFiltro}
          onNova={() => {}}
          onAbrirLead={() => {}}
          onRemarcar={(a, dia) =>
            setItens((xs) =>
              xs
                .map((x) => (x.id === a.id ? { ...x, data_agenda: dia, situacao: situacao(dia) } : x))
                .sort((p, q) => p.data_agenda.localeCompare(q.data_agenda)),
            )
          }
          onConcluir={(a) => setItens((xs) => xs.filter((x) => x.id !== a.id))}
        />
      </div>
    </TooltipProvider>
  );
}

const meta: Meta<typeof TelaDoComando> = {
  title: "Comando/Agenda de contatos",
  component: TelaDoComando,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof TelaDoComando>;

export const Vendedor: Story = { args: { isAdmin: false, itens: ITENS.filter((a) => a.owner_name === "Carol") } };
export const AdminEquipe: Story = { args: { isAdmin: true, itens: ITENS } };
export const Vazia: Story = { args: { isAdmin: false, itens: [] } };
