import { useState } from "react";
import { Target, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateAcaoDoDia } from "@/hooks/useAcoesDoDia";
import { cn } from "@/lib/utils";

interface QuickAddDailyActionProps {
  propostaId: string;
  leadName: string;
  onSuccess?: () => void;
}

export function QuickAddDailyAction({
  propostaId,
  leadName,
  onSuccess,
}: QuickAddDailyActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const createAcao = useCreateAcaoDoDia();

  const handleAdd = async () => {
    if (!title.trim()) return;

    await createAcao.mutateAsync({
      title: title.trim(),
      proposta_id: propostaId,
    });

    setTitle("");
    setIsOpen(false);
    onSuccess?.();
  };

  const handleQuickAdd = async (actionTitle: string) => {
    await createAcao.mutateAsync({
      title: actionTitle,
      proposta_id: propostaId,
    });

    setIsOpen(false);
    onSuccess?.();
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            "h-7 px-2 gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity",
            "hover:bg-primary/10 hover:text-primary"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Target className="w-3.5 h-3.5" />
          <span>Ação</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Target className="w-4 h-4 text-primary" />
            Ação do Dia para {leadName}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => handleQuickAdd(`Ligar para ${leadName}`)}
              disabled={createAcao.isPending}
            >
              📞 Ligar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => handleQuickAdd(`Enviar proposta para ${leadName}`)}
              disabled={createAcao.isPending}
            >
              📄 Proposta
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => handleQuickAdd(`Follow-up com ${leadName}`)}
              disabled={createAcao.isPending}
            >
              💬 Follow-up
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => handleQuickAdd(`Agendar reunião com ${leadName}`)}
              disabled={createAcao.isPending}
            >
              📅 Reunião
            </Button>
          </div>

          <div className="border-t pt-3">
            <Label className="text-xs">Ou crie uma ação personalizada</Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                placeholder="Descreva a ação..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!title.trim() || createAcao.isPending}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
