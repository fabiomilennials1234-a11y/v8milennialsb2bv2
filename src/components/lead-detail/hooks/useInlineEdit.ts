import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

interface UseInlineEditOptions {
  value: string;
  onSave: (newValue: string) => Promise<void>;
}

export function useInlineEdit({ value, onSave }: UseInlineEditOptions) {
  const [localValue, setLocalValue] = useState(value);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const originalRef = useRef(value);

  useEffect(() => {
    if (!isEditing) {
      setLocalValue(value);
      originalRef.current = value;
    }
  }, [value, isEditing]);

  const startEditing = useCallback(() => {
    originalRef.current = localValue;
    setIsEditing(true);
  }, [localValue]);

  const cancel = useCallback(() => {
    setLocalValue(originalRef.current);
    setIsEditing(false);
  }, []);

  const commit = useCallback(async () => {
    if (localValue === originalRef.current) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(localValue);
      originalRef.current = localValue;
      setIsEditing(false);
    } catch (err: any) {
      setLocalValue(originalRef.current);
      setIsEditing(false);
      toast.error(err?.message || "Erro ao salvar");
    } finally {
      setIsSaving(false);
    }
  }, [localValue, onSave]);

  return { localValue, setLocalValue, isEditing, isSaving, startEditing, commit, cancel };
}
