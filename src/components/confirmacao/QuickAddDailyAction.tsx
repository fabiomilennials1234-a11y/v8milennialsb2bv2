import { useState } from "react";
import { Target, Phone, FileText, Send, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCreateAcaoDoDia } from "@/hooks/useAcoesDoDia";

interface QuickAddDailyActionProps {
  confirmacaoId: string;
  leadName: string;
  onSuccess?: () => void;
}

export function QuickAddDailyAction({ 
  confirmacaoId, 
  leadName,
  onSuccess 
}: QuickAddDailyActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const createAcao = useCreateAcaoDoDia();

  const handleAdd = async (title: string) => {
    await createAcao.mutateAsync({
      title,
      confirmacao_id: confirmacaoId,
    });
    setIsOpen(false);
    setCustomTitle("");
    onSuccess?.();
  };

  const quickActions = [
    { label: "Ligar", icon: Phone },
    { label: "Confirmar", icon: CheckCircle2 },
    { label: "Enviar msg", icon: Send },
    { label: "Remarcar", icon: FileText },
  ];

  const handleQuickAdd = (action: string) => {
    handleAdd(`${action} - ${leadName}`);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <Target className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-64 p-3" 
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-medium mb-2 text-muted-foreground">
          Ação rápida: {leadName}
        </p>
        
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {quickActions.map((action) => (
            <Button
              key={action.label}
              size="sm"
              variant="outline"
              className="justify-start gap-1.5 text-xs h-8"
              onClick={() => handleQuickAdd(action.label)}
              disabled={createAcao.isPending}
            >
              <action.icon className="w-3 h-3" />
              {action.label}
            </Button>
          ))}
        </div>

        <div className="flex gap-1.5">
          <Input
            placeholder="Ação personalizada..."
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            className="h-8 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && customTitle.trim()) {
                handleAdd(`${customTitle} - ${leadName}`);
              }
            }}
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={!customTitle.trim() || createAcao.isPending}
            onClick={() => handleAdd(`${customTitle} - ${leadName}`)}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
