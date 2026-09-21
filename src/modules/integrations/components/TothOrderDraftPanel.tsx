import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Check, LockKeyhole, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TothOrderDraftError, useTothOrderDraft } from "../hooks/useTothOrderDraft";
import { TothPreorderStatusPanel } from "./TothPreorderStatusPanel";
import {
  getTothOrderBlockerLabel, getTothOrderReviewAvailability, getTothOrderSendAvailability,
  isTothOrderReviewCurrent, TOTH_ORDER_DRAFT_LIMITS, validateTothOrderDraftInput,
  type TothOrderDraftInput, type TothOrderWorkspace,
} from "../lib/toth-order-domain";

type DraftController = ReturnType<typeof useTothOrderDraft>;

function formValues(workspace: TothOrderWorkspace): TothOrderDraftInput {
  return { items: workspace.draft?.items.map((item) => ({ ...item })) ?? [], notes: workspace.draft?.notes ?? "" };
}

function errorMessage(error: unknown) {
  return error instanceof TothOrderDraftError
    ? error.message
    : "Não foi possível concluir a ação. Suas alterações locais foram preservadas.";
}

function PreparerAccess({ controller }: { controller: DraftController }) {
  const { preparers, setPreparer } = controller;
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">Quem pode preparar rascunhos</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          A permissão vale para os negócios aos quais a pessoa já tem acesso. Administradores já podem preparar e revisar.
        </p>
        {preparers.isLoading && <Skeleton className="h-10 w-full" />}
        {preparers.error && <Alert variant="destructive"><AlertDescription>{errorMessage(preparers.error)}</AlertDescription></Alert>}
        {setPreparer.error && <Alert variant="destructive"><AlertDescription>{errorMessage(setPreparer.error)}</AlertDescription></Alert>}
        {preparers.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum membro disponível.</p>}
        {preparers.data?.map((member) => (
          <div key={member.team_member_id} className="flex items-center justify-between gap-3">
            <Label htmlFor={`toth-preparer-${member.team_member_id}`}>{member.name}</Label>
            <Switch
              id={`toth-preparer-${member.team_member_id}`}
              checked={member.can_prepare}
              disabled={setPreparer.isPending}
              onCheckedChange={(enabled) => setPreparer.mutate({ teamMemberId: member.team_member_id, enabled })}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

function DraftEditor({ controller, workspace, dealId }: { controller: DraftController; workspace: TothOrderWorkspace; dealId: string }) {
  const { save, review } = controller;
  const form = useForm<TothOrderDraftInput>({ defaultValues: formValues(workspace) });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const { isDirty } = form.formState;
  const input = form.watch();
  const { reset } = form;
  const [baseRevision, setBaseRevision] = useState(workspace.draft?.revision ?? 0);
  const [failure, setFailure] = useState<unknown>(null);
  const [reloading, setReloading] = useState(false);
  const serverRevision = workspace.draft?.revision ?? 0;
  const conflict = (isDirty && serverRevision !== baseRevision)
    || (failure instanceof TothOrderDraftError && failure.kind === "conflict");
  const busy = save.isPending || review.isPending || reloading;
  const readUnavailable = controller.workspace.isError;
  const revisionPending = !isDirty && serverRevision !== baseRevision;
  const canEdit = workspace.can_prepare && !busy;
  const validation = validateTothOrderDraftInput(input);
  const reviewAvailability = getTothOrderReviewAvailability(workspace);
  const sendAvailability = getTothOrderSendAvailability(workspace);
  const reviewed = !isDirty && !conflict && isTothOrderReviewCurrent(workspace.draft);
  const availableProduct = workspace.catalog.find((product) => !input.items.some((item) => item.product_external_id === product.product_external_id));

  // Background refreshes may update permissions/catalog, but never replace an
  // unsaved form or silently move its optimistic concurrency baseline.
  useEffect(() => {
    if (!isDirty && serverRevision > baseRevision) {
      reset(formValues(workspace));
      setBaseRevision(serverRevision);
    }
  }, [isDirty, serverRevision, baseRevision, reset, workspace]);

  const adopt = (next: TothOrderWorkspace) => {
    reset(formValues(next));
    setBaseRevision(next.draft?.revision ?? 0);
    setFailure(null);
  };
  const saveDraft = async () => {
    if (!validation.success || !workspace.can_prepare || busy || conflict || readUnavailable || revisionPending) return;
    setFailure(null);
    try {
      adopt(await save.mutateAsync({ expectedRevision: baseRevision, input: validation.data }));
      toast.success("Rascunho salvo no CRM");
    } catch (error) { setFailure(error); }
  };
  const reviewDraft = async () => {
    if (isDirty || conflict || busy || readUnavailable || revisionPending || !reviewAvailability.allowed || reviewed) return;
    setFailure(null);
    try {
      adopt(await review.mutateAsync(baseRevision));
      toast.success("Revisão preparatória registrada");
    } catch (error) { setFailure(error); }
  };
  const reloadDraft = async () => {
    setReloading(true);
    try {
      const result = await controller.workspace.refetch();
      if (result.error) throw result.error;
      if (result.data) adopt(result.data);
    } catch (error) { setFailure(error); }
    finally { setReloading(false); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Pedido Toth</CardTitle>
          <Badge variant="secondary">{isDirty ? "Alterações não salvas" : reviewed ? "Revisão preparatória registrada" : "Rascunho no CRM"}</Badge>
        </div>
        <CardDescription>
          Prepare o pedido deste negócio. Salvar e revisar aqui não cria um pedido no ERP.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TothPreorderStatusPanel dealId={dealId} />
        <Alert>
          <LockKeyhole aria-hidden="true" />
          <AlertTitle>Envio ao ERP indisponível</AlertTitle>
          <AlertDescription>
            Preços, descontos, condições de pagamento, entrega e frete aguardam validação com a Toth.
            A revisão desta etapa confere somente os produtos, quantidades e observações do rascunho.
          </AlertDescription>
        </Alert>
        {!workspace.can_prepare && <Alert><AlertDescription>Você pode consultar este rascunho, mas a preparação não está disponível para este negócio ou usuário.</AlertDescription></Alert>}
        {!workspace.catalog.length && (
          <Alert>
            <AlertTitle>Catálogo do ERP indisponível</AlertTitle>
            <AlertDescription>Você pode salvar observações. A seleção de produtos e a revisão serão liberadas quando houver um catálogo validado.</AlertDescription>
          </Alert>
        )}
        {conflict && (
          <Alert variant="destructive">
            <AlertTitle>O rascunho mudou</AlertTitle>
            <AlertDescription>Suas alterações locais continuam na tela. Confira-as antes de descartá-las e carregar a versão atual.</AlertDescription>
            <Button type="button" variant="outline" className="mt-3" disabled={busy} onClick={() => void reloadDraft()}>
              Descartar alterações locais e carregar versão atual
            </Button>
          </Alert>
        )}
        {failure != null && !conflict && <Alert variant="destructive"><AlertDescription>{errorMessage(failure)}</AlertDescription></Alert>}
        {controller.workspace.error && <Alert variant="destructive">
          <AlertDescription>{errorMessage(controller.workspace.error)} Atualize os dados antes de salvar ou revisar.</AlertDescription>
          <Button type="button" variant="outline" className="mt-3" disabled={controller.workspace.isFetching}
            onClick={() => void controller.workspace.refetch()}>Atualizar dados</Button>
        </Alert>}
        <Form {...form}>
          <fieldset className="flex min-w-0 flex-col gap-4" disabled={!canEdit}>
            <legend className="sr-only">Itens do rascunho</legend>
            {fields.map((item, index) => (
              <div key={item.id} className="flex flex-wrap items-end gap-2">
                <FormField control={form.control} name={`items.${index}.product_external_id`} render={({ field }) => (
                  <FormItem className="min-w-0 flex-1 basis-48">
                    <FormLabel>Produto {index + 1}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Selecione um produto" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectGroup>
                          {!workspace.catalog.some((product) => product.product_external_id === field.value) && (
                            <SelectItem value={field.value} disabled>Produto {field.value} indisponível</SelectItem>
                          )}
                          {workspace.catalog.map((product) => (
                            <SelectItem key={product.product_external_id} value={product.product_external_id}
                              disabled={input.items.some((other, otherIndex) => otherIndex !== index && other.product_external_id === product.product_external_id)}>
                              {product.description} · {product.product_external_id}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (
                  <FormItem className="w-28" data-invalid={!validation.success && validation.issues.some((issue) => issue.path === `items.${index}.quantity`)}>
                    <FormLabel>Quantidade {index + 1}</FormLabel>
                    <FormControl><Input {...field} type="number" min="0" max={TOTH_ORDER_DRAFT_LIMITS.quantity} step="any"
                      aria-invalid={!validation.success && validation.issues.some((issue) => issue.path === `items.${index}.quantity`)}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} />
                    </FormControl>
                  </FormItem>
                )} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remover produto ${index + 1}`} disabled={!canEdit} onClick={() => remove(index)}>
                  <Trash2 data-icon="inline-start" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" className="self-start"
              disabled={!canEdit || !availableProduct || fields.length >= TOTH_ORDER_DRAFT_LIMITS.items}
              onClick={() => { if (availableProduct) append({ product_external_id: availableProduct.product_external_id, quantity: 1 }); }}>
              <Plus data-icon="inline-start" />Adicionar produto
            </Button>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Observações do rascunho</FormLabel>
                <FormControl><Textarea {...field} maxLength={TOTH_ORDER_DRAFT_LIMITS.notes} rows={3} /></FormControl>
              </FormItem>
            )} />
          </fieldset>
        </Form>
        {!validation.success && <Alert variant="destructive"><AlertDescription>{validation.issues[0].message}</AlertDescription></Alert>}
        {isDirty && <p className="text-sm text-muted-foreground">Salve as alterações antes de registrar uma nova revisão.</p>}
        <details>
          <summary className="cursor-pointer text-sm font-medium">Pendências para envio</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {sendAvailability.blockers.map((blocker) => <li key={blocker}>{getTothOrderBlockerLabel(blocker)}</li>)}
          </ul>
        </details>
        {workspace.can_review && <><Separator /><PreparerAccess controller={controller} /></>}
        {!!workspace.audit.length && <>
          <Separator />
          <details>
            <summary className="cursor-pointer text-sm font-medium">Histórico do rascunho</summary>
            <ul className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
              {workspace.audit.map((entry) => (
                <li key={entry.id}>
                  {entry.action === "draft_reviewed_locally" ? "Revisão preparatória" : entry.action === "draft_created" ? "Rascunho criado" : "Rascunho atualizado"}
                  {` · versão ${entry.revision} · ${new Date(entry.created_at).toLocaleString("pt-BR")}`}
                  {entry.actor_name && ` · ${entry.actor_name}`}
                </li>
              ))}
            </ul>
          </details>
        </>}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {workspace.can_prepare && <Button type="button" disabled={busy || conflict || readUnavailable || revisionPending || !validation.success || (!isDirty && !!workspace.draft)} onClick={() => void saveDraft()}>
          <Save data-icon="inline-start" />{save.isPending ? "Salvando…" : "Salvar rascunho"}
        </Button>}
        {workspace.can_review && <Button type="button" variant="outline"
          disabled={busy || isDirty || conflict || readUnavailable || revisionPending || reviewed || !reviewAvailability.allowed} onClick={() => void reviewDraft()}>
          <Check data-icon="inline-start" />{review.isPending ? "Registrando…" : "Registrar revisão preparatória"}
        </Button>}
        <Button type="button" variant="outline" disabled><LockKeyhole data-icon="inline-start" />Enviar ao ERP</Button>
      </CardFooter>
    </Card>
  );
}

export function TothOrderDraftPanel({ dealId }: { dealId: string }) {
  const controller = useTothOrderDraft(dealId);
  const { workspace } = controller;
  if (workspace.data?.enabled === false) return null;
  if (!workspace.data) {
    if (workspace.error) return <Alert><AlertTitle>Pedido Toth</AlertTitle><AlertDescription>{errorMessage(workspace.error)}</AlertDescription></Alert>;
    if (workspace.isLoading) return <Skeleton className="h-32 w-full" aria-label="Carregando rascunho do pedido" />;
    return null;
  }
  return <DraftEditor key={controller.scopeKey} controller={controller} workspace={workspace.data} dealId={dealId} />;
}
