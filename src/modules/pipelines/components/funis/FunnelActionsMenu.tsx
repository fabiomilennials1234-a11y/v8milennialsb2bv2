import { useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/modules/identity";
import { FunnelIdentityDialog } from "../shared/FunnelIdentityDialog";
import { DeletePipelineDialog } from "../shared/DeletePipelineDialog";

export interface FunnelActionsMenuProps {
  /** Linha canônica do funil em `pipelines` — qualquer espécie. */
  pipeline: {
    id: string;
    slug: string;
    type: "system" | "custom";
    name: string;
    icon: string;
    color: string;
  };
  /**
   * Nome que o usuário VÊ (funil de sistema: `display_name` do registro, que
   * vence onde existir). Ausente, cai em `pipeline.name`.
   */
  displayName?: string;
  /** Chamado depois da exclusão — o hospedeiro decide se navega ou só recarrega. */
  onDeleted?: () => void;
  /**
   * Navegar para `/funis` após excluir. `false` para quem JÁ está no hub — a
   * lista se refaz sozinha pela invalidação, e navegar para a própria rota
   * piscaria a tela.
   */
  navigateOnDelete?: boolean;
  className?: string;
}

/**
 * O kebab aparece no hover do cartão (`group`), como o resto do hub — mas só
 * onde existe hover. Em toque não há estado intermediário: esconder atrás de
 * um hover que nunca acontece tornaria renomear/excluir inalcançável no
 * celular, que é exatamente o problema que este menu veio resolver.
 */
const REVELA_NO_HOVER = [
  "opacity-100",
  "[@media(hover:hover)]:opacity-0",
  "[@media(hover:hover)]:group-hover:opacity-100",
  "focus-visible:opacity-100",
  "data-[state=open]:opacity-100",
  "transition-opacity",
].join(" ");

/**
 * Menu de ações do funil — **renomear e excluir onde o funil aparece**.
 *
 * As duas capacidades existiam e funcionavam, mas só dentro de Configurações:
 * última aba de sete no funil de fábrica, última de quatro no personalizado.
 * A lista de funis, o lugar onde qualquer um procura, só listava e navegava.
 * Isso era coerente quando funil era estrutura fixa do sistema; deixou de ser
 * (ADR-0034 — funil é funil, e a pessoa faz o que quiser com ele).
 *
 * Nada de lógica nova aqui: "Renomear" abre a MESMA seção de identidade da aba
 * Geral e "Excluir" abre o MESMO `DeletePipelineDialog` (impacto medido,
 * substituto obrigatório quando o funil é o padrão da org). Este componente é
 * só a porta.
 *
 * Portão: "Excluir" respeita `pipeline.custom_delete` e **some** quando a
 * permissão não está dada — mesma escolha da Zona de Perigo, que nunca
 * mostrou um botão destrutivo desabilitado.
 */
export function FunnelActionsMenu({
  pipeline,
  displayName,
  onDeleted,
  navigateOnDelete = false,
  className,
}: FunnelActionsMenuProps) {
  const [renomeando, setRenomeando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const { allowed: podeExcluir } = useFeaturePermission("pipeline.custom_delete");

  const nomeAtual = displayName ?? pipeline.name;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label={`Ações do funil ${nomeAtual}`}
            data-testid="funnel-actions-menu"
            className={cn(
              "shrink-0 rounded-md p-1.5 text-muted-foreground",
              "hover:bg-muted hover:text-foreground transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              REVELA_NO_HOVER,
              className,
            )}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            data-testid="funnel-actions-renomear"
            onClick={(e) => {
              e.stopPropagation();
              setRenomeando(true);
            }}
          >
            <Pencil className="w-4 h-4 mr-2" />
            Renomear
          </DropdownMenuItem>
          {podeExcluir && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="funnel-actions-excluir"
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setExcluindo(true);
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Excluir
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <FunnelIdentityDialog
        open={renomeando}
        onOpenChange={setRenomeando}
        pipeline={pipeline}
        displayName={displayName}
      />

      <DeletePipelineDialog
        open={excluindo}
        onOpenChange={setExcluindo}
        pipeline={{ id: pipeline.id, name: nomeAtual, type: pipeline.type }}
        navigateOnDelete={navigateOnDelete}
        onDeleted={onDeleted}
      />
    </>
  );
}
