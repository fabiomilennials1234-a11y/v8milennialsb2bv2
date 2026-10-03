/**
 * Pitstop — V5: página-hub (antes, painel aberto ao lado da lateral).
 *
 * Mostra os mesmos grupos e itens do painel antigo, já filtrados por
 * permissão, plano e tipo de org em `useNavigationModel` — esta página não
 * decide visibilidade. Só títulos, ícones e destino: os números que o mockup
 * punha em cada atalho não são calculados por ninguém e não entram.
 */

import { Link } from "react-router-dom";
import { ChevronRight, Lock } from "lucide-react";

import { IconChip } from "@/components/ui/bento";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { useNavigationModel } from "@/modules/platform/hooks/useNavigationModel";

export default function Pitstop() {
  const model = useNavigationModel();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pitstop"
        subtitle="Gestão, rotas, administração e ajustes da operação — o que não é tela de turno."
      />

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))]">
        {model.pitstopGroups.map((group) => (
          <section
            key={group.id}
            aria-labelledby={`pitstop-${group.id}`}
            className="flex flex-col gap-2 rounded-card border border-card-border bg-card p-4 shadow-relevo"
          >
            <header className="px-1 pb-1">
              <h2 id={`pitstop-${group.id}`} className="text-base font-bold tracking-tight">
                {group.title}
              </h2>
              <p className="text-xs text-muted-foreground">{group.hint}</p>
            </header>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const locked = model.isLocked(item.path);
                const active = model.isActive(item.path);
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-2xl px-2 py-2 text-sm font-semibold transition-colors",
                        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active && "bg-primary-soft text-primary-soft-foreground",
                      )}
                    >
                      <IconChip icon={item.icon} tone={active ? "gold" : "neutral"} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {locked ? (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Bloqueado no plano" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
