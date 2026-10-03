/**
 * Central de Ajuda (rota /faq).
 *
 * V5 (onda "mais perto do mockup", 02/10): página com três abas —
 *  · Artigos: os artigos do CMS (vídeo, feedback), que antes só apareciam no
 *    painel de suporte;
 *  · Perguntas frequentes: o FAQ estático de `faq-data.ts` (busca em tempo real
 *    sobre pergunta + resposta + keywords, com filtro por categoria) — igual;
 *  · Meus chamados: a lista de chamados do painel, agora numa página.
 * "Abrir chamado" abre o MESMO formulário do painel de suporte.
 */

import { useMemo, useState } from "react";
import {
  HelpCircle,
  Search,
  LifeBuoy,
  Users,
  Smartphone,
  MessageSquare,
  UserPlus,
  Filter,
  Bot,
  Zap,
  Megaphone,
  Wallet,
  CalendarDays,
  BarChart2,
  CreditCard,
  BookOpen,
  Headset,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrentTeamMember } from "@/modules/identity";
import { useHelpArticles } from "@/modules/platform/hooks/useHelpCenter";
import { useSupportTickets } from "@/modules/platform/hooks/useSupportTickets";
import { useSupportPanel } from "@/modules/platform/components/support/SupportPanelContext";
import { AjudaArtigos } from "@/modules/platform/components/support/AjudaArtigos";
import { AjudaChamados } from "@/modules/platform/components/support/AjudaChamados";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { FAQ_CATEGORIES, type FaqItem } from "@/modules/platform/lib/faq-data";

const FAQ_ICON_MAP: Record<string, LucideIcon> = {
  HelpCircle,
  LifeBuoy,
  Users,
  Smartphone,
  MessageSquare,
  UserPlus,
  Filter,
  Bot,
  Zap,
  Megaphone,
  Wallet,
  CalendarDays,
  BarChart2,
  CreditCard,
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const matchesQuery = (item: FaqItem, q: string) => {
  if (!q) return true;
  const haystack = normalize(
    [item.question, item.answer, ...(item.keywords ?? [])].join(" "),
  );
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
};

export default function Faq() {
  const { openNewTicket, openTicket } = useSupportPanel();
  const { data: membro } = useCurrentTeamMember();
  const { data: articles = [], isLoading: artigosCarregando } = useHelpArticles();
  const { data: tickets = [] } = useSupportTickets();
  const temArtigos = articles.some((a) => a.is_published);
  const abertos = tickets.filter((t) => t.status !== "resolvido" && t.status !== "fechado").length;
  // Sem artigo publicado a aba Artigos é um convite vazio: abre no FAQ.
  const [aba, setAba] = useState<string | null>(null);
  const abaAtiva = aba ?? (artigosCarregando || temArtigos ? "artigos" : "faq");
  const primeiroNome = membro?.name?.trim().split(/\s+/)[0] ?? null;

  return (
    <Tabs value={abaAtiva} onValueChange={setAba} className="space-y-5">
      <PageHeader
        title="Central de Ajuda"
        subtitle="Artigos, perguntas frequentes e os seus chamados com o suporte"
        actions={
          <Button onClick={openNewTicket}>
            <Plus />
            Abrir chamado
          </Button>
        }
        tabs={
          <TabsList variant="pill" aria-label="Seções da ajuda">
            <TabsTrigger value="artigos">
              <BookOpen className="h-3.5 w-3.5" />
              Artigos
            </TabsTrigger>
            <TabsTrigger value="faq">
              <HelpCircle className="h-3.5 w-3.5" />
              Perguntas frequentes
            </TabsTrigger>
            <TabsTrigger value="chamados">
              <Headset className="h-3.5 w-3.5" />
              Meus chamados
              {abertos > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 text-[11px] font-bold tabular-nums [[data-state=active]>&]:bg-primary-foreground/15">
                  {abertos}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        }
      />
      <TabsContent value="artigos" className="mt-0">
        <AjudaArtigos primeiroNome={primeiroNome} onAbrirChamado={openNewTicket} onVerFaq={() => setAba("faq")} />
      </TabsContent>
      <TabsContent value="faq" className="mt-0">
        <PerguntasFrequentes />
      </TabsContent>
      <TabsContent value="chamados" className="mt-0">
        <AjudaChamados onAbrir={openTicket} onNovo={openNewTicket} />
      </TabsContent>
    </Tabs>
  );
}

/** O FAQ estático de sempre (85 perguntas), agora numa aba. */
function PerguntasFrequentes() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const normalizedQuery = normalize(query.trim());

  // Filtra itens por busca + categoria ativa; descarta categorias vazias.
  const filtered = useMemo(() => {
    return FAQ_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter((it) => matchesQuery(it, normalizedQuery)),
    })).filter(
      (cat) =>
        cat.items.length > 0 &&
        (activeCategory === null || activeCategory === cat.id),
    );
  }, [normalizedQuery, activeCategory]);

  const totalQuestions = useMemo(
    () => FAQ_CATEGORIES.reduce((acc, c) => acc + c.items.length, 0),
    [],
  );

  const hasResults = filtered.length > 0;

  return (
    // Largura de leitura: perguntas e respostas são texto corrido.
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="space-y-5">
        <p className="text-[13px] text-muted-foreground">
          Respostas rápidas para as dúvidas mais comuns do Torque
          {totalQuestions > 0 && ` · ${totalQuestions} perguntas`}
        </p>

        {/* Busca */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar uma dúvida... (ex.: conectar WhatsApp, importar leads)"
            className="h-11 rounded-full pl-10 text-sm shadow-relevo"
          />
        </div>

        {/* Filtro de categorias */}
        {FAQ_CATEGORIES.length > 0 && (
          // No celular, 14 chips em várias linhas empurravam as perguntas para
          // fora da tela: lá a fileira rola na horizontal.
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <CategoryChip
              label="Todos"
              icon={LifeBuoy}
              active={activeCategory === null}
              onClick={() => setActiveCategory(null)}
            />
            {FAQ_CATEGORIES.map((cat) => (
              <CategoryChip
                key={cat.id}
                label={cat.title}
                icon={FAQ_ICON_MAP[cat.icon] ?? HelpCircle}
                active={activeCategory === cat.id}
                onClick={() =>
                  setActiveCategory((cur) => (cur === cat.id ? null : cat.id))
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Conteúdo */}
      {!hasResults ? (
        <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border py-16 text-center">
          <Search className="mb-3 h-7 w-7 text-muted-foreground/50" />
          <p className="text-sm font-medium">
            {FAQ_CATEGORIES.length === 0
              ? "O FAQ ainda está sendo preparado."
              : "Nenhuma pergunta encontrada"}
          </p>
          {FAQ_CATEGORIES.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Tente outros termos ou limpe a busca.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          {filtered.map((cat) => {
            const Icon = FAQ_ICON_MAP[cat.icon] ?? HelpCircle;
            return (
              <section key={cat.id} id={cat.id} className="scroll-mt-24">
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/70">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-base font-bold leading-tight tracking-tight">
                      {cat.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {cat.description}
                    </p>
                  </div>
                </div>
                <Accordion
                  type="single"
                  collapsible
                  className="rounded-card border border-card-border bg-card px-5 shadow-relevo"
                >
                  {cat.items.map((item, idx) => (
                    <AccordionItem
                      key={idx}
                      value={`${cat.id}-${idx}`}
                      className="border-border/60 last:border-b-0"
                    >
                      <AccordionTrigger className="text-left text-sm font-semibold hover:no-underline">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-tinta text-tinta-foreground shadow-relevo-tinta dark:bg-foreground dark:text-background [&>svg]:text-primary"
          : "border border-card-border bg-card text-muted-foreground shadow-relevo hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
