import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScheduleFollowUpModal } from "./ScheduleFollowUpModal";

interface ScheduleFollowUpButtonProps {
  leadId: string;
  leadName: string;
  sourcePipe?: "whatsapp" | "confirmacao" | "propostas";
  sourcePipeId?: string;
  defaultAssignedTo?: string;
  variant?: "icon" | "button";
  size?: "sm" | "default";
}

export function ScheduleFollowUpButton({
  leadId,
  leadName,
  sourcePipe,
  sourcePipeId,
  defaultAssignedTo,
  variant = "icon",
  size = "sm",
}: ScheduleFollowUpButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "icon" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 rounded-lg text-muted-foreground hover:bg-primary-soft hover:text-primary-soft-foreground"
              aria-label="Agendar Follow Up"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
              }}
            >
              <Clock className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Agendar Follow Up</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button
          size={size}
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Clock className="w-4 h-4" />
          Agendar FUP
        </Button>
      )}

      <ScheduleFollowUpModal
        open={open}
        onOpenChange={setOpen}
        leadId={leadId}
        leadName={leadName}
        sourcePipe={sourcePipe}
        sourcePipeId={sourcePipeId}
        defaultAssignedTo={defaultAssignedTo}
      />
    </>
  );
}
