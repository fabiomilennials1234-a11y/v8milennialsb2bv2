import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Plus,
  Search,
  Globe,
  Phone,
  Mail,
  MapPin,
  Users,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useCompanies,
  useCreateCompany,
  useUpdateCompany,
  useDeleteCompany,
  type Company,
  type CompanyInsert,
} from "@/hooks/useCompanies";

// ── Constants ─────────────────────────────────────────────────────────

const SIZE_RANGES = [
  { value: "1-10", label: "1-10 funcionarios" },
  { value: "11-50", label: "11-50 funcionarios" },
  { value: "51-200", label: "51-200 funcionarios" },
  { value: "201-500", label: "201-500 funcionarios" },
  { value: "501-1000", label: "501-1.000 funcionarios" },
  { value: "1000+", label: "1.000+ funcionarios" },
] as const;

const companySchema = z.object({
  name: z.string().min(1, "Nome obrigatorio"),
  industry: z.string().optional(),
  size_range: z.string().optional(),
  website: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  notes: z.string().optional(),
});

type CompanyFormData = z.infer<typeof companySchema>;

// ── Page ──────────────────────────────────────────────────────────────

export default function Companies() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);

  const { data: companies, isLoading } = useCompanies(debouncedSearch);
  const createCompany = useCreateCompany();
  const updateCompany = useUpdateCompany();
  const deleteCompany = useDeleteCompany();

  // Debounce search 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setSheetOpen(true);
  }, []);

  const openEdit = useCallback((company: Company) => {
    setEditing(company);
    setSheetOpen(true);
  }, []);

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteCompany.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Empresa removida");
        setDeleteTarget(null);
      },
      onError: () => toast.error("Erro ao remover empresa"),
    });
  }, [deleteTarget, deleteCompany]);

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
            {companies && (
              <Badge variant="secondary" className="text-xs tabular-nums">
                {companies.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar empresa..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={openCreate} size="sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Nova empresa
            </Button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !companies?.length ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
            <Building2 className="mb-3 h-10 w-10 opacity-40" />
            <p className="text-sm">Nenhuma empresa cadastrada</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Porte</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead className="text-center">Contatos</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => (
                  <TableRow
                    key={company.id}
                    className="cursor-pointer"
                    onClick={() => openEdit(company)}
                  >
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.industry || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.size_range
                        ? SIZE_RANGES.find((s) => s.value === company.size_range)?.label ??
                          company.size_range
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {company.website ? (
                        <a
                          href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Globe className="h-3.5 w-3.5" />
                          <span className="max-w-[160px] truncate text-xs">
                            {company.website.replace(/^https?:\/\//, "")}
                          </span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="tabular-nums text-xs">
                        <Users className="mr-1 h-3 w-3" />0
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {new Date(company.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(company);
                            }}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(company);
                            }}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Excluir
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
      <CompanySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        company={editing}
        onSubmit={(data) => {
          if (editing) {
            updateCompany.mutate(
              { id: editing.id, ...data },
              {
                onSuccess: () => {
                  toast.success("Empresa atualizada");
                  setSheetOpen(false);
                },
                onError: () => toast.error("Erro ao atualizar empresa"),
              },
            );
          } else {
            createCompany.mutate(data as CompanyInsert, {
              onSuccess: () => {
                toast.success("Empresa criada");
                setSheetOpen(false);
              },
              onError: () => toast.error("Erro ao criar empresa"),
            });
          }
        }}
        loading={createCompany.isPending || updateCompany.isPending}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteTarget?.name}</strong>? Esta
              acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCompany.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Sheet Form ────────────────────────────────────────────────────────

function CompanySheet({
  open,
  onOpenChange,
  company,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
  onSubmit: (data: CompanyFormData) => void;
  loading: boolean;
}) {
  const form = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: "",
      industry: "",
      size_range: "",
      website: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      state: "",
      notes: "",
    },
  });

  // Reset form when sheet opens/closes or company changes
  useEffect(() => {
    if (open && company) {
      form.reset({
        name: company.name,
        industry: company.industry ?? "",
        size_range: company.size_range ?? "",
        website: company.website ?? "",
        phone: company.phone ?? "",
        email: company.email ?? "",
        address: company.address ?? "",
        city: company.city ?? "",
        state: company.state ?? "",
        notes: company.notes ?? "",
      });
    } else if (open) {
      form.reset();
    }
  }, [open, company, form]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{company ? "Editar empresa" : "Nova empresa"}</SheetTitle>
        </SheetHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="mt-6 space-y-4"
        >
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome *</Label>
            <Input id="name" {...form.register("name")} placeholder="Nome da empresa" />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          {/* Industry */}
          <div className="space-y-1.5">
            <Label htmlFor="industry">Setor</Label>
            <Input id="industry" {...form.register("industry")} placeholder="Ex: Industria, Tecnologia" />
          </div>

          {/* Size range */}
          <div className="space-y-1.5">
            <Label>Porte</Label>
            <Select
              value={form.watch("size_range") || ""}
              onValueChange={(v) => form.setValue("size_range", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar porte" />
              </SelectTrigger>
              <SelectContent>
                {SIZE_RANGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Website */}
          <div className="space-y-1.5">
            <Label htmlFor="website">
              <Globe className="mr-1 inline h-3.5 w-3.5" />
              Website
            </Label>
            <Input id="website" {...form.register("website")} placeholder="https://..." />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="phone">
              <Phone className="mr-1 inline h-3.5 w-3.5" />
              Telefone
            </Label>
            <Input id="phone" {...form.register("phone")} placeholder="(00) 0000-0000" />
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">
              <Mail className="mr-1 inline h-3.5 w-3.5" />
              Email
            </Label>
            <Input id="email" type="email" {...form.register("email")} placeholder="contato@empresa.com" />
            {form.formState.errors.email && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <Label htmlFor="address">
              <MapPin className="mr-1 inline h-3.5 w-3.5" />
              Endereco
            </Label>
            <Input id="address" {...form.register("address")} placeholder="Rua, numero" />
          </div>

          {/* City + State */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="city">Cidade</Label>
              <Input id="city" {...form.register("city")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">Estado</Label>
              <Input id="state" {...form.register("state")} placeholder="SP" />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Observacoes</Label>
            <textarea
              id="notes"
              {...form.register("notes")}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Notas internas..."
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {company ? "Salvar" : "Criar empresa"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
