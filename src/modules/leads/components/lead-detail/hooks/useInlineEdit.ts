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
  const externalRef = useRef(value);
  const editingRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    // A refetch confirming the previous saved value may arrive during the next
    // edit. Consume that confirmation now so closing cannot replay it later.
    if (isEditing && value === originalRef.current) {
      externalRef.current = value;
    }
    // Closing the editor must not restore a stale prop while refetch is pending.
    // Only a new server value replaces the last successfully saved value.
    if (!isEditing && value !== externalRef.current) {
      externalRef.current = value;
      setLocalValue(value);
      originalRef.current = value;
    }
  }, [value, isEditing]);

  const startEditing = useCallback(() => {
    if (savingRef.current) return;
    editingRef.current = true;
    originalRef.current = localValue;
    setIsEditing(true);
  }, [localValue]);

  const cancel = useCallback(() => {
    if (savingRef.current) return;
    editingRef.current = false;
    setLocalValue(originalRef.current);
    setIsEditing(false);
  }, []);

  const commit = useCallback(async () => {
    if (!editingRef.current || savingRef.current) return;
    if (localValue === originalRef.current) {
      editingRef.current = false;
      setIsEditing(false);
      return;
    }
    const savedValue = localValue;
    const originalValue = originalRef.current;
    savingRef.current = true;
    setIsSaving(true);
    try {
      await onSave(savedValue);
      originalRef.current = savedValue;
      setLocalValue(savedValue);
    } catch (err: unknown) {
      setLocalValue(originalValue);
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      editingRef.current = false;
      savingRef.current = false;
      setIsEditing(false);
      setIsSaving(false);
    }
  }, [localValue, onSave]);

  return { localValue, setLocalValue, isEditing, isSaving, startEditing, commit, cancel };
}
