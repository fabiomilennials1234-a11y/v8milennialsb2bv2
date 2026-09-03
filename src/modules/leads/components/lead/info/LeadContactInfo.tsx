/**
 * LeadContactInfo — campos editáveis de contato do lead (nome, empresa, email).
 *
 * Extraído de LeadDetailContent (Onda 3.1, C2).
 * Props controladas: formData + setter passados pelo pai.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface LeadContactFormData {
  name: string;
  company: string;
  email: string;
  notes: string;
}

interface LeadContactInfoProps {
  formData: LeadContactFormData;
  onChange: (data: LeadContactFormData) => void;
}

export function LeadContactInfo({ formData, onChange }: LeadContactInfoProps) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="edit-name">Nome</Label>
        <Input
          id="edit-name"
          value={formData.name}
          onChange={(e) => onChange({ ...formData, name: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="edit-company">Empresa</Label>
        <Input
          id="edit-company"
          value={formData.company}
          onChange={(e) => onChange({ ...formData, company: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="edit-email">Email</Label>
        <Input
          id="edit-email"
          type="email"
          value={formData.email}
          onChange={(e) => onChange({ ...formData, email: e.target.value })}
        />
      </div>
    </div>
  );
}
