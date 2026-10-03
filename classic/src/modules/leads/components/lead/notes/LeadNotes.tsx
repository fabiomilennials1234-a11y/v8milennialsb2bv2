/**
 * LeadNotes — textarea de notas do lead com dirty-state e save.
 *
 * Extraído de LeadDetailContent (Onda 3.1, C6).
 * Controlado: valor e onChange passados pelo pai; botão Salvar via onSave.
 */

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LeadContactFormData } from "../info/LeadContactInfo";

interface LeadNotesProps {
  formData: LeadContactFormData;
  onChange: (data: LeadContactFormData) => void;
}

export function LeadNotes({ formData, onChange }: LeadNotesProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor="edit-notes">Notas</Label>
      <Textarea
        id="edit-notes"
        value={formData.notes}
        onChange={(e) => onChange({ ...formData, notes: e.target.value })}
        placeholder="Observações sobre o lead..."
        rows={3}
      />
    </div>
  );
}
