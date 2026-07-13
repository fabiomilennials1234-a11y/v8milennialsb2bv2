/**
 * AutoCreateLeadToggle — controle compacto na barra do funil (kanban).
 *
 * Liga/desliga `organizations.auto_create_lead_on_inbound` (vale pra CONTA
 * INTEIRA, não por-aba/por-funil). Aparece em TODAS as abas de pipe
 * (whatsapp/confirmacao/propostas) porque é dropado no header de cada page.
 *
 * Visibilidade: só admin/owner + master. Membro (vendedor) NÃO vê.
 * Resiliência: se a coluna ainda não foi aplicada no DB, o toggle renderiza
 * como OFF e não quebra a página (permite verificação visual no localhost).
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
  useAutoCreateLeadSetting,
} from "@/modules/identity";

export function AutoCreateLeadToggle() {
  const { data: userRole } = useUserRole();
  const { isMaster } = useMasterAuth();
  const isAdmin = isMaster || userRole?.role === "admin";

  const { autoCreateLead, setAutoCreateLead, isUpdating } =
    useAutoCreateLeadSetting();

  // Vendedor (membro) não vê o controle. Só admin/owner + master.
  if (!isAdmin) return null;

  const handleChange = async (value: boolean) => {
    try {
      await setAutoCreateLead(value);
      toast.success(
        value
          ? "Criação automática de lead ativada para a conta"
          : "Criação automática de lead desativada",
      );
    } catch {
      toast.error("Não foi possível salvar a configuração");
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 h-9 shrink-0">
      <Switch
        id="auto-create-lead"
        checked={autoCreateLead}
        onCheckedChange={handleChange}
        disabled={isUpdating}
        className="scale-90"
      />
      <Label
        htmlFor="auto-create-lead"
        className="text-xs cursor-pointer whitespace-nowrap"
      >
        Criar lead automático (WhatsApp)
      </Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Sobre criar lead automático"
            className="text-muted-foreground hover:text-foreground"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          Quando ligado, uma mensagem recebida no WhatsApp de um número
          desconhecido cria o lead automaticamente (funil WhatsApp, etapa Novo,
          sem dono) — mesmo sem IA ativa. Vale para a conta inteira, não por aba
          ou funil.
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
