/**
 * EditMessageInline — inline textarea pra editar mensagem.
 *
 * Enter (sem shift) = save. Esc = cancel. Shift+Enter = nova linha.
 */
import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Check, X, Loader2 } from "lucide-react";

interface Props {
  initialText: string;
  onSave: (newText: string) => Promise<void>;
  onCancel: () => void;
  isPending?: boolean;
}

export function EditMessageInline({ initialText, onSave, onCancel, isPending }: Props) {
  const [value, setValue] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(value.length, value.length);
  }, []);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initialText) {
      onCancel();
      return;
    }
    await onSave(trimmed);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        disabled={isPending}
        rows={Math.min(value.split("\n").length, 6)}
        className="text-sm resize-none"
        aria-label="Editar mensagem"
      />
      <div className="flex justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isPending}
          aria-label="Cancelar edição"
          className="h-7 px-2"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={isPending || !value.trim()}
          aria-label="Salvar edição"
          className="h-7 px-2"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
