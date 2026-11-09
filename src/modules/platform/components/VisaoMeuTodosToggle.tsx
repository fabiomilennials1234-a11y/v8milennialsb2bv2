import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import { OPCOES_DE_VISAO, normalizarVisao, type Visao } from "../lib/visao-meu-todos";

export interface VisaoMeuTodosToggleProps {
  visao: Visao;
  onChange: (v: Visao) => void;
  /** O que a escolha recorta — vai para o leitor de tela ("Visão dos leads"). */
  rotulo: string;
  className?: string;
}

/**
 * O controle Meus · Todos. Só desenha — quem decide se aparece é
 * `useVisaoMeuTodos().disponivel`, no host.
 */
export function VisaoMeuTodosToggle({ visao, onChange, rotulo, className }: VisaoMeuTodosToggleProps) {
  return (
    <SegmentedControl
      label={rotulo}
      options={[...OPCOES_DE_VISAO]}
      value={visao}
      onValueChange={(v) => onChange(normalizarVisao(v))}
      className={cn("shrink-0", className)}
    />
  );
}
