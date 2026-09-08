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
  busy?: boolean;
  onSelecionar: (id: string) => void;
  onCriar: () => void;
  onRenomear: (id: string, nome: string) => void;
  onRemover: (id: string) => void;
  onReordenar: (ids: string[]) => void;
}

export function StudioTabs({ paineis, ativoId, editavel, busy, onSelecionar, onCriar, onRenomear, onRemover, onReordenar }: StudioTabsProps) {
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
    <div className="flex min-w-0 flex-col gap-2">
      <Tabs value={ativoId ?? ""} onValueChange={onSelecionar} className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <TabsList aria-label="Painéis de métricas" className="h-auto justify-start">
            {paineis.map((panel) => (
              <TabsTrigger key={panel.id} value={panel.id} id={`studio-tab-${panel.id}`}
                aria-controls="studio-panel" className="min-h-11">
                {panel.nome}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {editavel && active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="size-11 shrink-0" disabled={busy} aria-label={`Opções da aba ${active.nome}`}>
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
                <DropdownMenuItem onSelect={() => onRemover(active.id)}>
                  <Trash2 className="mr-2 size-4" />Excluir aba
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {editavel && <Button variant="outline" onClick={onCriar} disabled={busy} className="min-h-11 shrink-0"><Plus className="mr-2 size-4" />Nova aba</Button>}
      </Tabs>
      {editavel && renomeando && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!renomeando.nome.trim()) return;
          onRenomear(renomeando.id, renomeando.nome.trim());
          setRenomeando(null);
        }}>
          <label htmlFor="studio-tab-name" className="text-sm">Nome da aba</label>
          <Input id="studio-tab-name" autoFocus value={renomeando.nome} maxLength={60} className="h-11 max-w-xs"
            onChange={(event) => setRenomeando({ ...renomeando, nome: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Escape") setRenomeando(null); }} />
          <Button type="submit" disabled={busy || !renomeando.nome.trim()} className="min-h-11">Salvar nome</Button>
          <Button type="button" variant="ghost" onClick={() => setRenomeando(null)} className="min-h-11">Cancelar</Button>
        </form>
      )}
    </div>
  );
}
