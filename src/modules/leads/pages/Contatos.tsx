import { useEffect, useMemo, useState } from "react";
import { BookUser, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/shared/components/EmptyState";
import { notifyError } from "@/shared/errors";
import { useOrganization } from "@/modules/identity";
import { ContactFormDialog } from "../components/contacts/ContactFormDialog";
import { useContacts, useDeleteContact } from "../hooks/useContacts";
import { CONTACT_PAGE_SIZE, recusaDeContato, type Contact } from "../lib/contacts";

/**
 * Contatos — agenda própria da organização (Chamado 33c5fd52 · PR6).
 *
 * Contato não depende de lead nem de empresa: lista, busca, cria, edita e
 * exclui sozinho, e se vincula a 0..N leads. A visibilidade é do banco (RLS):
 * contato ligado só a lead que o usuário não enxerga não aparece.
 */

const BUSCA_ATRASO_MS = 300;

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function Contatos() {
  const { organizationId } = useOrganization();
  const [search, setSearch] = useState("");
  const busca = useDebounced(search, BUSCA_ATRASO_MS);
  const [page, setPage] = useState(0);
  const { data, isLoading, isError, isFetching, refetch } = useContacts({ organizationId, search: busca, page });
  const del = useDeleteContact();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  // Nova busca volta para a primeira página.
  useEffect(() => setPage(0), [busca]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const total = data?.total ?? 0;
  const editing = useMemo(() => rows.find((c) => c.id === editingId) ?? null, [rows, editingId]);
  const lastPage = Math.max(0, Math.ceil(total / CONTACT_PAGE_SIZE) - 1);

  const openNew = () => {
    setEditingId(null);
    setFormOpen(true);
  };
  const openEdit = (c: Contact) => {
    setEditingId(c.id);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await del.mutateAsync(deleting.id);
      toast.success("Contato excluído");
      setDeleting(null);
    } catch (caught) {
      notifyError(caught, {
        fallback: "Não foi possível excluir o contato.",
        message: recusaDeContato(caught as { code?: string; message?: string }),
      });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contatos"
        subtitle="Pessoas da sua organização, com ou sem lead e empresa. Edite à vontade e vincule a quantos leads quiser."
        actions={
          <Button onClick={openNew} disabled={!organizationId}>
            <Plus />
            Novo contato
          </Button>
        }
      />

      <div className="flex justify-end">
        <div className="relative w-full sm:w-[320px]">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone ou e-mail…"
            aria-label="Buscar contatos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-[38px] rounded-full pl-10 shadow-relevo"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-card border border-card-border bg-card py-24 shadow-relevo">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Carregando contatos" />
        </div>
      ) : isError ? (
        <div className="rounded-card border border-card-border bg-card shadow-relevo">
          <EmptyState
            icon={BookUser}
            title="Não foi possível carregar os contatos"
            description="Confira a conexão e tente de novo."
            action={<Button variant="outline" onClick={() => refetch()}>Tentar de novo</Button>}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-card border border-card-border bg-card shadow-relevo">
          <EmptyState
            icon={BookUser}
            title={busca ? "Nenhum contato com essa busca" : "Nenhum contato ainda"}
            description={
              busca
                ? "Tente outro nome, telefone ou e-mail."
                : "Crie o primeiro contato — ele não precisa de lead nem de empresa."
            }
            action={!busca ? <Button onClick={openNew}><Plus />Novo contato</Button> : undefined}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Contato</TableHead>
                  <TableHead>Telefones</TableHead>
                  <TableHead className="max-md:hidden">E-mail</TableHead>
                  <TableHead className="max-lg:hidden">Leads</TableHead>
                  <TableHead className="pr-4 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-4">
                      <p className="max-w-[220px] truncate text-[13px] font-bold">{c.name}</p>
                      {c.jobTitle && (
                        <p className="max-w-[220px] truncate text-[11px] text-muted-foreground">{c.jobTitle}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px] tabular-nums">
                      {c.phones.length === 0 ? (
                        <span className="text-muted-foreground/60">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {c.phones.map((p) => (
                            <li key={p.id} className="whitespace-nowrap">
                              {p.phone}
                              {p.label && <span className="ml-1.5 text-[11px] text-muted-foreground">{p.label}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="max-md:hidden">
                      {c.email ? (
                        <span className="block max-w-[220px] truncate text-[13px]">{c.email}</span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-lg:hidden">
                      {c.leads.length === 0 ? (
                        <span className="text-[13px] text-muted-foreground">Sem lead</span>
                      ) : (
                        <span className="block max-w-[240px] truncate text-[13px]" title={c.leads.map((l) => l.name).join(", ")}>
                          {c.leads.length === 1
                            ? c.leads[0].name
                            : `${c.leads[0].name} +${c.leads.length - 1}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={`Editar ${c.name}`}
                          title="Editar"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Excluir ${c.name}`}
                          title="Excluir"
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
            <span className="tabular-nums">
              {total.toLocaleString("pt-BR")} {total === 1 ? "contato" : "contatos"}
              {isFetching && " · atualizando…"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Anterior
              </Button>
              <span className="tabular-nums">
                {page + 1} / {lastPage + 1}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage}
              >
                Próxima
              </Button>
            </div>
          </div>
        </div>
      )}

      {organizationId && (
        <ContactFormDialog
          open={formOpen}
          organizationId={organizationId}
          contact={editing}
          onOpenChange={setFormOpen}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name} some da agenda e é desvinculado de {deleting?.leads.length ?? 0}{" "}
              {(deleting?.leads.length ?? 0) === 1 ? "lead" : "leads"}. Os leads em si não são alterados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={del.isPending}
            >
              {del.isPending && <Loader2 className="animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
