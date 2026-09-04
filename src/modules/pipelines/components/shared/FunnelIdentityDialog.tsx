import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Palette } from "lucide-react";
import {
  FunnelIdentitySection,
  type FunnelIdentitySectionProps,
} from "./FunnelIdentitySection";

export interface FunnelIdentityDialogProps
  extends Pick<
    FunnelIdentitySectionProps,
    "pipeline" | "displayName" | "onDeleted" | "mostrarZonaDePerigo"
  > {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Renomear/repintar um funil SEM entrar em Configurações.
 *
 * Mesma seção da aba "Geral" dos dois diálogos de configuração — nenhuma
 * lógica nova: `FunnelIdentitySection` continua sendo o único lugar que
 * escreve identidade de funil (`useUpdatePipelineIdentity`, com a precedência
 * `display_name` vs `pipelines.name` documentada lá).
 *
 * O que muda é só ONDE se chega nela: o menu do cartão no hub `/funis` e o
 * nome do funil no cabeçalho do quadro. A capacidade existia e estava
 * enterrada na sétima aba de um diálogo de configuração.
 *
 * A Zona de Perigo fica FORA por padrão: quem abre este diálogo veio de uma
 * superfície que já oferece "Excluir" como item próprio, e repetir o botão
 * destrutivo a um clique do nome é convite a acidente.
 */
export function FunnelIdentityDialog({
  open,
  onOpenChange,
  pipeline,
  displayName,
  onDeleted,
  mostrarZonaDePerigo = false,
}: FunnelIdentityDialogProps) {
  const nomeAtual = displayName ?? pipeline.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-primary" />
            Renomear funil
          </DialogTitle>
          <DialogDescription>
            Nome, ícone e cor de "{nomeAtual}". O que mudar aqui vale na navegação
            lateral, no hub de funis e no cabeçalho do quadro.
          </DialogDescription>
        </DialogHeader>

        {/* Radix desmonta o conteúdo ao fechar — o estado local da seção
            (nome/ícone/cor em edição) nasce limpo a cada abertura, inclusive
            quando o mesmo hospedeiro reabre o diálogo para outro funil. */}
        <FunnelIdentitySection
          pipeline={pipeline}
          displayName={displayName}
          mostrarZonaDePerigo={mostrarZonaDePerigo}
          onDeleted={() => {
            onOpenChange(false);
            onDeleted?.();
          }}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
