/**
 * Faq — Central de Ajuda / Perguntas Frequentes do Torque CRM.
 *
 * Página estática (sem backend) alimentada por `faq-data.ts`. Busca em tempo
 * real sobre pergunta + resposta + keywords, com filtro por categoria.
 * Acessível via botão amarelo "FAQ" na top bar (rota /faq).
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
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
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
    <div className="mx-auto w-full max-w-4xl">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-yellow-400/10 ring-1 ring-yellow-400/30">
            <HelpCircle className="h-6 w-6 text-yellow-500" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Central de Ajuda</h1>
            <p className="text-sm text-muted-foreground">
              Respostas rápidas para as dúvidas mais comuns do Torque
              {totalQuestions > 0 && ` · ${totalQuestions} perguntas`}
            </p>
          </div>
        </div>

        {/* Busca */}
        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar uma dúvida... (ex.: conectar WhatsApp, importar leads)"
            className="h-11 rounded-xl pl-10 text-sm"
            autoFocus
          />
        </div>

        {/* Filtro de categorias */}
        {FAQ_CATEGORIES.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
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
      </header>

      {/* Conteúdo */}
      {!hasResults ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 py-16 text-center">
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
                <div className="mb-3 flex items-center gap-2.5">
                  <Icon className="h-5 w-5 text-yellow-500" />
                  <div>
                    <h2 className="text-base font-semibold leading-tight">
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
                  className="rounded-2xl border border-border/60 bg-card/40 px-4"
                >
                  {cat.items.map((item, idx) => (
                    <AccordionItem
                      key={idx}
                      value={`${cat.id}-${idx}`}
                      className="border-border/50 last:border-b-0"
                    >
                      <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-yellow-400/50 bg-yellow-400/10 text-yellow-600 dark:text-yellow-400"
          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
