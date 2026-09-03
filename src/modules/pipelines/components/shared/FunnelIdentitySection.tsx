import { useId, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/modules/identity";
import { PIPELINE_COLORS, PIPELINE_ICONS } from "../custom/CreatePipelineModal";
import { useUpdatePipelineIdentity } from "../../hooks/config/usePipelineIdentity";
import { DeletePipelineDialog } from "./DeletePipelineDialog";

export interface FunnelIdentitySectionProps {
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
   * Nome que o usuário VÊ hoje (funil de sistema: `display_name` do registro,
   * que vence onde existir — ver precedência em `usePipelineIdentity`).
   * Ausente, cai em `pipeline.name`.
   */
  displayName?: string;
  /** Fecha o diálogo hospedeiro após a exclusão do funil. */
  onDeleted?: () => void;
  /** Chamado após um salvamento bem-sucedido (fechar o diálogo hospedeiro). */
  onSaved?: () => void;
  /**
   * Zona de Perigo embutida. Default `true` — as duas abas "Geral" seguem
   * exatamente como estavam. Hospedeiro que JÁ oferece "Excluir" como ação
   * própria (o menu do cartão no hub) passa `false`: a mesma superfície não
   * pode oferecer o delete duas vezes.
   */
  mostrarZonaDePerigo?: boolean;
}

/**
 * Identidade do funil — nome, ícone e cor — PARA TODOS (SCRUM-636, D4).
 *
 * Antes só o funil custom tinha esta seção (GeneralTab do
 * CustomPipeSettingsDialog); os semeados eram imutáveis. Uma seção, as duas
 * espécies: escreve em `pipelines.name/icon/color` e, no sistema, sincroniza
 * `display_name` do registro (navegação/hub leem de lá).
 *
 * Carrega também a Zona de Perigo (exclusão do funil via
 * `DeletePipelineDialog`, o diálogo definitivo da D3), atrás do MESMO portão
 * `pipeline.custom_delete` das duas telas antigas.
 */
export function FunnelIdentitySection({
  pipeline,
  displayName,
  onDeleted,
  onSaved,
  mostrarZonaDePerigo = true,
}: FunnelIdentitySectionProps) {
  const nomeAtual = displayName ?? pipeline.name;
  const [name, setName] = useState(nomeAtual);
  const [icon, setIcon] = useState(pipeline.icon);
  const [color, setColor] = useState(pipeline.color);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  const nomeId = useId();
  const updateIdentity = useUpdatePipelineIdentity();
  const { allowed: podeExcluir } = useFeaturePermission("pipeline.custom_delete");

  const hasChanges =
    name !== nomeAtual || icon !== pipeline.icon || color !== pipeline.color;

  const handleSave = async () => {
    try {
      await updateIdentity.mutateAsync({
        id: pipeline.id,
        slug: pipeline.slug,
        type: pipeline.type,
        name,
        icon,
        color,
      });
      toast.success("Funil atualizado");
      onSaved?.();
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={nomeId}>Nome do Funil</Label>
        <Input id={nomeId} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label>Ícone</Label>
        <div className="flex flex-wrap gap-2">
          {PIPELINE_ICONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => setIcon(item.name)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all",
                  icon === item.name
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Cor</Label>
        <div className="flex gap-2">
          {PIPELINE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                "w-8 h-8 rounded-full border-2 transition-all",
                color === c
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {hasChanges && (
        <Button onClick={handleSave} disabled={!name.trim() || updateIdentity.isPending}>
          {updateIdentity.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Salvar Alterações
        </Button>
      )}

      {mostrarZonaDePerigo && podeExcluir && (
        <div className="pt-6 mt-2 border-t border-destructive/20 space-y-2">
          <p className="text-sm font-semibold text-destructive">Zona de Perigo</p>
          <p className="text-xs text-muted-foreground">
            Excluir apaga o funil, suas etapas e todos os cards em definitivo — junto com
            o histórico de etapas que alimenta as métricas deste funil. Os leads
            permanecem no sistema.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmandoExclusao(true)}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Excluir Funil
          </Button>
        </div>
      )}

      {mostrarZonaDePerigo && (
        <DeletePipelineDialog
          open={confirmandoExclusao}
          onOpenChange={setConfirmandoExclusao}
          pipeline={{ id: pipeline.id, name: nomeAtual, type: pipeline.type }}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
