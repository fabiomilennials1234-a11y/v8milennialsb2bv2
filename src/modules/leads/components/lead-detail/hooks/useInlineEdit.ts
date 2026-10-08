import { useState, useCallback, useEffect, useRef } from "react";
import { notifyError } from "@/shared/errors";

interface UseInlineEditOptions {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  /**
   * Na recusa, mantém o texto digitado na linha em vez de voltar ao valor
   * salvo — para quem errou um dígito do CPF/CNPJ corrigir sem redigitar.
   */
  keepOnError?: boolean;
}

export function useInlineEdit({ value, onSave, keepOnError = false }: UseInlineEditOptions) {
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
      setLocalValue(keepOnError ? savedValue : originalValue);
      notifyError(err, { fallback: "Não foi possível salvar." });
    } finally {
      editingRef.current = false;
      savingRef.current = false;
      setIsEditing(false);
      setIsSaving(false);
    }
  }, [localValue, onSave, keepOnError]);

  return { localValue, setLocalValue, isEditing, isSaving, startEditing, commit, cancel };
}
