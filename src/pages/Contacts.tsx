import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  Building2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Linkedin,
  ExternalLink,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  useContacts, useCreateContact, useUpdateContact, useDeleteContact,
  type Contact, type ContactInsert,
} from "@/hooks/useContacts";
import { useCompanies, type Company } from "@/hooks/useCompanies";

// ── Schema ────────────────────────────────────────────────────────────

const contactSchema = z.object({
  name: z.string().min(1, "Nome obrigatorio"),
  email: z.string().email("Email invalido").nullable().or(z.literal("")),
  phone: z.string().nullable().or(z.literal("")),
  job_title: z.string().nullable().or(z.literal("")),
  linkedin_url: z.string().url("URL invalida").nullable().or(z.literal("")),
  company_id: z.string().nullable().or(z.literal("")),
});

type ContactFormValues = z.infer<typeof contactSchema>;

const EMPTY_FORM: ContactFormValues = {
  name: "",
  email: "",
  phone: "",
  job_title: "",
  linkedin_url: "",
  company_id: "",
};

// ── Page ──────────────────────────────────────────────────────────────

export default function Contacts() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: contacts, isLoading } = useContacts(debouncedSearch);
  const { data: companies } = useCompanies();
  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();

  const companyMap = useMemo(() => {
    const map = new Map<string, string>();
    companies?.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [companies]);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: EMPTY_FORM,
  });

  const openCreate = useCallback(() => {
    setEditing(null);
    form.reset(EMPTY_FORM);
    setSheetOpen(true);
  }, [form]);

  const openEdit = useCallback((c: Contact) => {
    setEditing(c);
    form.reset({
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      job_title: c.job_title ?? "",
      linkedin_url: c.linkedin_url ?? "",
      company_id: c.company_id ?? "",
    });
    setSheetOpen(true);
  }, [form]);

  const onSubmit = useCallback(async (values: ContactFormValues) => {
    const payload: any = {
      name: values.name,
      email: values.email || null,
      phone: values.phone || null,
      job_title: values.job_title || null,
      linkedin_url: values.linkedin_url || null,
      company_id: values.company_id || null,
    };

    try {
      if (editing) {
        await updateContact.mutateAsync({ id: editing.id, ...payload });
        toast.success("Contato atualizado");
      } else {
        await createContact.mutateAsync(payload as ContactInsert);
        toast.success("Contato criado");
      }
      setSheetOpen(false);
    } catch {
      toast.error("Erro ao salvar contato");
    }
  }, [editing, createContact, updateContact]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteContact.mutateAsync(deleteTarget.id);
      toast.success("Contato removido");
    } catch {
      toast.error("Erro ao remover contato");
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteContact]);

  const isSaving = createContact.isPending || updateContact.isPending;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Contatos</h1>
          {contacts && (
            <Badge variant="secondary" className="tabular-nums">
              {contacts.length}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar contatos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Novo contato
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !contacts?.length ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <Users className="h-10 w-10" />
          <p className="text-sm">Nenhum contato cadastrado</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead className="text-right">Criado em</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id} className="group">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    {c.email ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        {c.email}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.phone ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        {c.phone}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.company_id && companyMap.has(c.company_id) ? (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {companyMap.get(c.company_id)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell>{c.job_title || <span className="text-muted-foreground">--</span>}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(c)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Editar
                        </DropdownMenuItem>
                        {c.linkedin_url && (
                          <DropdownMenuItem asChild>
                            <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer">
                              <Linkedin className="mr-2 h-4 w-4" />
                              LinkedIn
                              <ExternalLink className="ml-auto h-3.5 w-3.5" />
                            </a>
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(c)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Editar contato" : "Novo contato"}</SheetTitle>
            <SheetDescription>
              {editing
                ? "Atualize os dados do contato."
                : "Preencha os dados para criar um novo contato."}
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nome *</Label>
              <Input id="name" {...form.register("name")} placeholder="Nome completo" />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...form.register("email")} placeholder="email@empresa.com" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">Telefone</Label>
              <Input id="phone" {...form.register("phone")} placeholder="+55 11 99999-9999" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="job_title">Cargo</Label>
              <Input id="job_title" {...form.register("job_title")} placeholder="Diretor Comercial" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="linkedin_url">LinkedIn</Label>
              <Input id="linkedin_url" {...form.register("linkedin_url")} placeholder="https://linkedin.com/in/..." />
            </div>

            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <Select
                value={form.watch("company_id") || "none"}
                onValueChange={(v) => form.setValue("company_id", v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar empresa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {companies?.map((co) => (
                    <SelectItem key={co.id} value={co.id}>
                      {co.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="submit" disabled={isSaving} className="mt-2">
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Salvar" : "Criar contato"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      {/* Delete AlertDialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover contato</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover <strong>{deleteTarget?.name}</strong>? Esta acao pode ser revertida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteContact.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
