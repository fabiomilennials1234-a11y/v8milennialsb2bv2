import { useState } from "react";
import { ArrowLeft, ArrowRight, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { StudioPanel } from "@/modules/analytics/hooks/useMetricsStudioPanels";

interface StudioTabsProps {
  paineis: StudioPanel[];
  ativoId: string | null;
  editavel: boolean;
  podeCriar?: boolean;
  podeGerenciar?: boolean;
  busy?: boolean;
  onSelecionar: (id: string) => void;
  onCriar: () => void;
  onRenomear: (id: string, nome: string) => void;
  onRemover: (id: string) => void;
  onReordenar: (ids: string[]) => void;
}

export function StudioTabs({ paineis, ativoId, editavel, podeCriar = editavel, podeGerenciar = editavel, busy, onSelecionar, onCriar, onRenomear, onRemover, onReordenar }: StudioTabsProps) {
  const [renomeando, setRenomeando] = useState<{ id: string; nome: string } | null>(null);
  const activeIndex = paineis.findIndex((p) => p.id === ativoId);
  const active = paineis[activeIndex];
  const move = (delta: number) => {
    const ids = paineis.map((p) => p.id);
    const target = activeIndex + delta;
    if (activeIndex < 0 || target < 0 || target >= ids.length) return;
    [ids[activeIndex], ids[target]] = [ids[target], ids[activeIndex]];
    onReordenar(ids);
  };
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2">
      {/* V5: navegação de página — pílula escura com a aba ativa em ouro. As
          ações de aba ficam ao lado, fora da lista (não são abas selecionáveis).
          Sem quebra: no celular o "⋯" caía sozinho numa linha; a pílula é que
          encolhe e rola. */}
      <Tabs value={ativoId ?? ""} onValueChange={onSelecionar} className="flex min-w-0 max-w-full items-center gap-2">
        <TabsList variant="pill" aria-label="Painéis de métricas" className="min-w-0">
          {paineis.map((panel) => (
            <TabsTrigger key={panel.id} value={panel.id} id={`studio-tab-${panel.id}`} aria-controls="studio-panel">
              {panel.nome}
            </TabsTrigger>
          ))}
          {/* "Nova aba" mora dentro da pílula, como último item (o mockup). Não
              é um gatilho de aba: botão comum, fora do roving focus do Radix. */}
          {podeCriar && (
            <button
              type="button"
              onClick={onCriar}
              disabled={busy}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-semibold text-tinta-muted transition-colors hover:text-tinta-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />Nova Aba
            </button>
          )}
        </TabsList>
        {podeGerenciar && active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="outline" className="h-9 w-9 shrink-0 rounded-full" disabled={busy} aria-label={`Opções da aba ${active.nome}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setRenomeando({ id: active.id, nome: active.nome })}>
                  <Pencil className="mr-2 size-4" />Renomear
                </DropdownMenuItem>
                <DropdownMenuItem disabled={activeIndex === 0} onSelect={() => move(-1)}>
                  <ArrowLeft className="mr-2 size-4" />Mover para a esquerda
                </DropdownMenuItem>
                <DropdownMenuItem disabled={activeIndex === paineis.length - 1} onSelect={() => move(1)}>
                  <ArrowRight className="mr-2 size-4" />Mover para a direita
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onRemover(active.id)} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 size-4" />Excluir aba
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Tabs>
      {podeGerenciar && renomeando && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!renomeando.nome.trim()) return;
          onRenomear(renomeando.id, renomeando.nome.trim());
          setRenomeando(null);
        }}>
          <label htmlFor="studio-tab-name" className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Nome da aba</label>
          <Input id="studio-tab-name" autoFocus value={renomeando.nome} maxLength={60} className="h-9 max-w-xs"
            onChange={(event) => setRenomeando({ ...renomeando, nome: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Escape") setRenomeando(null); }} />
          <Button type="submit" size="sm" disabled={busy || !renomeando.nome.trim()}>Salvar nome</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenomeando(null)}>Cancelar</Button>
        </form>
      )}
    </div>
  );
}
