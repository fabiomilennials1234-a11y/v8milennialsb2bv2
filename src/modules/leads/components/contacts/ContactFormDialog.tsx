import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { notifyError } from "@/shared/errors";
import {
  useCreateContact,
  useLeadPicker,
  useLinkLeadContact,
  useUnlinkLeadContact,
  useUpdateContact,
} from "../../hooks/useContacts";
import {
  CONTACT_MAX_PHONES,
  recusaDeContato,
  validateContactForm,
  type Contact,
  type ContactFormErrors,
  type ContactLeadLink,
  type PhoneInput,
} from "../../lib/contacts";

/**
 * Criar/editar contato. Só o NOME é obrigatório: contato não pede lead nem
 * empresa. Os leads vinculados (0..N) ficam num bloco próprio — na criação
 * entram junto com o contato; na edição cada vínculo/desvínculo grava na hora.
 */

interface Props {
  open: boolean;
  organizationId: string;
  /** `null` = novo contato. */
  contact: Contact | null;
  onOpenChange: (open: boolean) => void;
}

const LINHA_VAZIA: PhoneInput = { phone: "", label: "", isPrimary: false };

function telefonesIniciais(contact: Contact | null): PhoneInput[] {
  if (!contact || contact.phones.length === 0) return [{ ...LINHA_VAZIA, isPrimary: true }];
  return contact.phones.map((p) => ({ phone: p.phone, label: p.label ?? "", isPrimary: p.isPrimary }));
}

export function ContactFormDialog({ open, organizationId, contact, onOpenChange }: Props) {
  const editing = contact !== null;
  const create = useCreateContact(organizationId);
  const update = useUpdateContact();
  const link = useLinkLeadContact();
  const unlink = useUnlinkLeadContact();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phones, setPhones] = useState<PhoneInput[]>([{ ...LINHA_VAZIA, isPrimary: true }]);
  const [pendingLeads, setPendingLeads] = useState<ContactLeadLink[]>([]);
  const [errors, setErrors] = useState<ContactFormErrors>({});

  // Reabre limpo (novo) ou com os dados do contato (edição).
  useEffect(() => {
    if (!open) return;
    setName(contact?.name ?? "");
    setEmail(contact?.email ?? "");
    setJobTitle(contact?.jobTitle ?? "");
    setPhones(telefonesIniciais(contact));
    setPendingLeads([]);
    setErrors({});
    // O contato é lido só na abertura: a lista de vínculos, que muda com a
    // tela aberta, vem direto de `contact` abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact?.id]);

  const saving = create.isPending || update.isPending;
  const links = editing ? contact.leads : pendingLeads;

  const setPhone = (i: number, patch: Partial<PhoneInput>) =>
    setPhones((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const setPrimary = (i: number) =>
    setPhones((prev) => prev.map((p, idx) => ({ ...p, isPrimary: idx === i })));
  const removePhone = (i: number) =>
    setPhones((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      if (next.length === 0) return [{ ...LINHA_VAZIA, isPrimary: true }];
      return next.some((p) => p.isPrimary) ? next : next.map((p, idx) => ({ ...p, isPrimary: idx === 0 }));
    });

  const addLead = async (lead: { id: string; name: string }) => {
    if (links.some((l) => l.leadId === lead.id)) return;
    if (!editing) {
      setPendingLeads((prev) => [...prev, { leadId: lead.id, name: lead.name, papel: null }]);
      return;
    }
    try {
      await link.mutateAsync({ contactId: contact.id, leadId: lead.id });
      toast.success("Lead vinculado");
    } catch (caught) {
      notifyError(caught, {
        fallback: "Não foi possível vincular o lead.",
        message: recusaDeContato(caught as { code?: string; message?: string }),
      });
    }
  };

  const removeLead = async (leadId: string) => {
    if (!editing) {
      setPendingLeads((prev) => prev.filter((l) => l.leadId !== leadId));
      return;
    }
    try {
      await unlink.mutateAsync({ contactId: contact.id, leadId });
      toast.success("Vínculo removido");
    } catch (caught) {
      notifyError(caught, {
        fallback: "Não foi possível remover o vínculo.",
        message: recusaDeContato(caught as { code?: string; message?: string }),
      });
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const values = { name, email, jobTitle, phones, leadIds: pendingLeads.map((l) => l.leadId) };
    const found = validateContactForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    try {
      if (editing) {
        await update.mutateAsync({ id: contact.id, values });
        toast.success("Contato atualizado");
      } else {
        await create.mutateAsync(values);
        toast.success("Contato criado");
      }
      onOpenChange(false);
    } catch (caught) {
      notifyError(caught, {
        fallback: editing ? "Não foi possível salvar o contato." : "Não foi possível criar o contato.",
        message: recusaDeContato(caught as { code?: string; message?: string }),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar contato" : "Novo contato"}</DialogTitle>
          <DialogDescription>
            Um contato existe por conta própria: não precisa de lead nem de empresa.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Nome</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "contact-name-erro" : undefined}
              autoFocus
            />
            {errors.name && <p id="contact-name-erro" className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">E-mail</Label>
              <Input
                id="contact-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "contact-email-erro" : undefined}
              />
              {errors.email && <p id="contact-email-erro" className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-cargo">Cargo</Label>
              <Input id="contact-cargo" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Telefones</legend>
            {phones.map((p, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Telefone ${i + 1}`}
                    inputMode="tel"
                    placeholder="(48) 99999-0000"
                    value={p.phone}
                    onChange={(e) => setPhone(i, { phone: e.target.value })}
                    aria-invalid={!!errors.phones?.[i]}
                    className="min-w-0 flex-1"
                  />
                  <Input
                    aria-label={`Rótulo do telefone ${i + 1}`}
                    placeholder="Celular, fixo…"
                    value={p.label}
                    onChange={(e) => setPhone(i, { label: e.target.value })}
                    className="w-28 shrink-0 max-sm:hidden"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={p.isPrimary ? `Telefone ${i + 1} é o principal` : `Tornar o telefone ${i + 1} principal`}
                    aria-pressed={p.isPrimary}
                    onClick={() => setPrimary(i)}
                    className={cn("shrink-0", p.isPrimary && "text-primary")}
                  >
                    <Star className={cn(p.isPrimary && "fill-current")} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover telefone ${i + 1}`}
                    onClick={() => removePhone(i)}
                    className="shrink-0"
                  >
                    <Trash2 />
                  </Button>
                </div>
                {errors.phones?.[i] && <p className="text-xs text-destructive">{errors.phones[i]}</p>}
              </div>
            ))}
            {phones.length < CONTACT_MAX_PHONES && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPhones((prev) => [...prev, { ...LINHA_VAZIA }])}>
                <Plus /> Adicionar telefone
              </Button>
            )}
          </fieldset>

          <LeadLinks
            organizationId={organizationId}
            links={links}
            busy={link.isPending || unlink.isPending}
            onAdd={addLead}
            onRemove={removeLead}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {editing ? "Salvar" : "Criar contato"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeadLinks({
  organizationId,
  links,
  busy,
  onAdd,
  onRemove,
}: {
  organizationId: string;
  links: ContactLeadLink[];
  busy: boolean;
  onAdd: (lead: { id: string; name: string }) => void;
  onRemove: (leadId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: options = [], isFetching } = useLeadPicker(organizationId, search);
  const linked = useMemo(() => new Set(links.map((l) => l.leadId)), [links]);
  const available = options.filter((o) => !linked.has(o.id));

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Leads vinculados</legend>
      {links.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nenhum lead vinculado. É opcional.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {links.map((l) => (
            <li
              key={l.leadId}
              className="inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-[13px]"
            >
              <span className="max-w-[200px] truncate">{l.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 rounded-full"
                aria-label={`Desvincular ${l.name}`}
                disabled={busy}
                onClick={() => onRemove(l.leadId)}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Buscar lead para vincular"
          placeholder="Buscar lead pelo nome para vincular…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      {search.trim().length >= 2 && (
        <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-card border border-card-border">
          {isFetching && available.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted-foreground">Buscando…</li>
          ) : available.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted-foreground">Nenhum lead encontrado.</li>
          ) : (
            available.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onAdd(o);
                    setSearch("");
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="truncate">{o.name}</span>
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </fieldset>
  );
}
