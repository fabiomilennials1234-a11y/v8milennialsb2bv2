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

  const commit = useCallback(() => {
    if (localValue === originalRef.current) {
      setIsEditing(false);
      return;
    }
    const savedValue = localValue;
    const originalValue = originalRef.current;
    setIsSaving(true);
    onSave(savedValue).then(() => {
      originalRef.current = savedValue;
      setIsEditing(false);
      setIsSaving(false);
    }).catch((err: any) => {
      setLocalValue(originalValue);
      setIsEditing(false);
      setIsSaving(false);
      toast.error(err?.message || "Erro ao salvar");
    });
  }, [localValue, onSave]);

  return { localValue, setLocalValue, isEditing, isSaving, startEditing, commit, cancel };
}
