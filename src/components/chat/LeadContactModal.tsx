import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { LeadDetailContent } from "./LeadDetailContent";

interface LeadContactModalProps {
  phoneNumber: string;
  pushName?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function LeadContactModal({
  phoneNumber,
  pushName,
  isOpen,
  onClose,
}: LeadContactModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
        {isOpen && phoneNumber ? (
          <LeadDetailContent
            phoneNumber={phoneNumber}
            pushName={pushName}
            onClose={onClose}
            showHeader={true}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
