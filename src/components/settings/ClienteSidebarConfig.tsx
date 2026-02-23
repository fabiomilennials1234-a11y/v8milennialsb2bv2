import { Eye } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  useClientSidebarPermissions,
  useUpsertClientSidebarPermission,
  SIDEBAR_KEY_LABELS,
} from "@/hooks/useClientSidebarPermissions";

// Ordem canônica de exibição dos itens
const ALL_SIDEBAR_KEYS = Object.keys(SIDEBAR_KEY_LABELS);

export function ClienteSidebarConfig() {
  const { data: permissions = [], isLoading } = useClientSidebarPermissions();
  const upsertPermission = useUpsertClientSidebarPermission();

  // Mapa rápido sidebar_key → is_visible (do banco)
  const permMap = new Map(permissions.map((p) => [p.sidebar_key, p.is_visible]));

  const handleToggle = async (sidebarKey: string, newValue: boolean) => {
    try {
      await upsertPermission.mutateAsync({
        sidebar_key: sidebarKey,
        is_visible: newValue,
      });
      toast.success("Permissão atualizada");
    } catch {
      toast.error("Erro ao atualizar permissão");
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">Acesso do Cliente na Sidebar</h3>
        <p className="text-sm text-muted-foreground">
          Configure quais módulos o Cliente pode ver na sidebar. Se o módulo está
          visível, o Cliente pode operar por completo dentro dele.
        </p>
      </div>

      {/* Todos os módulos configuráveis */}
      <div className="space-y-3">
        {ALL_SIDEBAR_KEYS.map((key) => (
          <div
            key={key}
            className="flex items-center justify-between py-2 px-3 rounded-lg border"
          >
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {SIDEBAR_KEY_LABELS[key]}
              </span>
            </div>
            <Switch
              checked={permMap.get(key) ?? false}
              onCheckedChange={(checked) => handleToggle(key, checked)}
              disabled={upsertPermission.isPending}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
