import { useState, memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Users,
  Plus,
  Phone,
  Mail,
  Building2,
  Briefcase,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useCreateContact, useDeleteContact, type Contact } from "@/hooks/useContacts";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function useLeadContacts(leadId: string | null) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["contacts", "lead", leadId],
    queryFn: async (): Promise<Contact[]> => {
      if (!leadId || !organizationId) return [];

      const { data, error } = await (supabase.from as any)("contacts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("source_lead_id", leadId)
        .is("deleted_at", null)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []) as Contact[];
    },
    enabled: !!leadId && !!organizationId,
    staleTime: 30_000,
  });
}

const ContactCard = memo(function ContactCard({
  contact,
  compact,
}: {
  contact: Contact;
  compact?: boolean;
}) {
  const deleteContact = useDeleteContact();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-2.5 group">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{contact.name}</span>
            {contact.is_primary && (
              <span className="text-[9px] bg-primary/15 text-primary px-1 py-0.5 rounded font-medium">
                Principal
              </span>
            )}
          </div>
          {contact.job_title && (
            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
              <Briefcase className="w-2.5 h-2.5 shrink-0" />
              {contact.job_title}
            </p>
          )}
        </div>
        {!compact && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => {
                    deleteContact.mutate(contact.id);
                    setConfirmDelete(false);
                  }}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => setConfirmDelete(false)}
                >
                  <X className="w-2.5 h-2.5" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="w-2.5 h-2.5" />
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
          >
            <Phone className="w-2.5 h-2.5" />
            {contact.phone}
          </a>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
          >
            <Mail className="w-2.5 h-2.5" />
            {contact.email}
          </a>
        )}
      </div>
    </div>
  );
});

interface CreateContactFormData {
  name: string;
  phone: string;
  email: string;
  job_title: string;
}

const EMPTY_FORM: CreateContactFormData = { name: "", phone: "", email: "", job_title: "" };

interface LeadContactsSectionProps {
  leadId: string;
  compact?: boolean;
}

export const LeadContactsSection = memo(function LeadContactsSection({
  leadId,
  compact,
}: LeadContactsSectionProps) {
  const { data: contacts = [], isLoading } = useLeadContacts(leadId);
  const createContact = useCreateContact();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateContactFormData>(EMPTY_FORM);

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error("Nome obrigatório");
      return;
    }

    try {
      await createContact.mutateAsync({
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        job_title: form.job_title.trim() || null,
        source_lead_id: leadId,
        is_primary: contacts.length === 0,
        normalized_phone: null,
        linkedin_url: null,
        avatar_url: null,
        source: "manual",
        tags: [],
        metadata: {},
        created_by: null,
        company_id: null,
      });
      toast.success("Contato adicionado");
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao criar contato");
    }
  }

  if (isLoading) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          Contatos
        </h3>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Plus className="w-3 h-3" /> Novo
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden mb-2"
          >
            <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-2.5 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Nome *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Nome completo"
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Cargo</Label>
                  <Input
                    value={form.job_title}
                    onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                    placeholder="Ex: Diretor Comercial"
                    className="h-7 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Telefone</Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="(11) 99999-0000"
                    className="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="email@empresa.com"
                    className="h-7 text-xs"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-6 text-[10px]"
                  disabled={createContact.isPending}
                  onClick={handleCreate}
                >
                  {createContact.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {contacts.length === 0 && !showForm ? (
        <p className="text-xs text-muted-foreground">Nenhum contato vinculado</p>
      ) : (
        <div className="space-y-1.5">
          {contacts.map((c) => (
            <ContactCard key={c.id} contact={c} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
});
