/**
 * LeadDistributionToggle — controle compacto na barra do funil WhatsApp.
 *
 * Liga/desliga `organizations.auto_distribute_new_leads` (vale pra CONTA
 * INTEIRA). Quando ON, lead novo sem posicionamento em pipe é distribuído
 * round-robin ao pré-venda pelo pool do funil WhatsApp
 * (pipe_distribution_members) no ingest.
 *
 * Visibilidade: só admin/owner + master. Membro (vendedor) NÃO vê.
 * Resiliência: se a coluna ainda não foi aplicada no DB, renderiza OFF sem
 * quebrar a página.
 */
import { Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  useUserRole,
  useMasterAuth,
  useAutoDistributeSetting,
} from "@/modules/identity";

export function LeadDistributionToggle() {
  const { data: userRole } = useUserRole();
  const { isMaster } = useMasterAuth();
  const isAdmin = isMaster || userRole?.role === "admin";

  const { autoDistribute, setAutoDistribute, isUpdating, isLoading, isUnavailable } =
    useAutoDistributeSetting();

  // Vendedor (membro) não vê o controle. Só admin/owner + master.
  if (!isAdmin) return null;

  const handleChange = async (value: boolean) => {
    try {
      await setAutoDistribute(value);
      toast.success(
        value
          ? "Distribuição automática de leads ativada para a conta"
          : "Distribuição automática de leads desativada",
      );
    } catch {
      toast.error("Não foi possível salvar a configuração");
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 h-9 shrink-0">
      <Switch
        id="auto-distribute-leads"
        checked={autoDistribute}
        onCheckedChange={handleChange}
        disabled={isUpdating || isLoading || isUnavailable}
        className="scale-90"
      />
      <Label
        htmlFor="auto-distribute-leads"
        className="text-xs cursor-pointer whitespace-nowrap"
      >
        Distribuir leads (round-robin)
      </Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Sobre distribuição automática de leads"
            className="text-muted-foreground hover:text-foreground"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Quando ligado, todo lead novo é distribuído automaticamente e em rodízio
          (round-robin) entre os vendedores do pool de distribuição do funil
          WhatsApp — o pré-venda vira o dono. Configure o pool nas regras de
          distribuição do funil. Vale para a conta inteira.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
