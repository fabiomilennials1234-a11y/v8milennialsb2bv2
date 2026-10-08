import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInlineEdit } from "../lead-detail/hooks/useInlineEdit";
import { formatBrDocument } from "../../lib/document";
import type { LeadCardField, LeadCardFieldGroup } from "./types";

/**
 * Dados do lead — campos de sistema e campos da organização, sem separação de
 * casta. Para quem preenche não existe diferença entre "campo nativo" e "campo
 * personalizado"; existe campo com dado e campo sem.
 *
 * ── CAMPO VAZIO FICA VISÍVEL ──────────────────────────────────────────────
 * Decisão do CTO: o dado que o Torque ainda não carrega — CNPJ, site, data de
 * fundação, endereço — **aparece vazio até alguém preencher**. Some da tela é
 * exatamente o que faz ninguém nunca preencher.
 *
 * O vazio é convite, não acusação: o lugar do valor traz o exemplo do que se
 * espera ali ("Informe o CNPJ"), em tom apagado, e a linha inteira responde ao
 * hover como se já fosse editável — porque vai ser.
 *
 * Escala: 482 campos personalizados definidos em 47 orgs, média 10,3 por org e
 * **38 na maior**. Qualquer desenho que trate campo da organização como
 * apêndice quebra nessa org.
 */

/** `type` do input a partir do tipo do campo — só onde muda o teclado. */
const INPUT_TYPE: Partial<Record<NonNullable<LeadCardField["tipo"]>, string>> = {
  email: "email",
  telefone: "tel",
  data: "date",
  url: "url",
};

/**
 * O que o hover do valor explica. CPF/CNPJ tem regra própria (Chamado
 * 93027ffb): editar grava um override no Torque e o ERP não muda; a trava,
 * quando há, é de permissão (`leads.edit_document`), não de sincronização.
 */
function dicaDoCampo(campo: LeadCardField): string | undefined {
  if (campo.tipo === "documento") {
    if (campo.somenteLeitura) return "Sem permissão para alterar o documento";
    if (campo.alteradoLocalmente) {
      return campo.valorErp ? `No ERP: ${formatBrDocument(campo.valorErp)}` : "Sem documento no ERP";
    }
    return campo.origemErp ? "Valor do ERP. A alteração fica no Torque; o cadastro no Toth não muda." : undefined;
  }
  if (campo.origemErp) return "Sincronizado do ERP. Altere o cadastro no Toth.";
  return campo.somenteLeitura ? "Este campo ainda não existe no banco" : undefined;
}

function Linha({
  campo,
  onSave,
}: {
  campo: LeadCardField;
  onSave?: (chave: string, valor: string) => Promise<void>;
}) {
  const [erro, setErro] = useState(false);

  // `somenteLeitura` marca o campo que ainda não tem coluna em `leads` (site,
  // nascimento, endereço), o que vem travado do ERP e o CPF/CNPJ de quem não
  // tem `leads.edit_document`. Ele APARECE, por decisão do CTO — sumir é o que
  // faz ninguém preencher — mas não finge que grava.
  const editavel = !!onSave && !campo.somenteLeitura;
  const documento = campo.tipo === "documento";

  const { localValue, setLocalValue, isEditing, isSaving, startEditing, commit, cancel } =
    useInlineEdit({
      value: campo.valor ?? "",
      onSave: async (novo) => {
        setErro(false);
        try {
          await onSave!(campo.chave, novo);
        } catch (e) {
          setErro(true);
          throw e;
        }
      },
      // CPF/CNPJ recusado (DV, já em uso) fica na linha, em vermelho, para
      // corrigir o dígito em vez de redigitar.
      keepOnError: documento,
    });
  const valorExibido = editavel ? localValue : campo.valor;
  const vazio = valorExibido === null || valorExibido === "";
  const dica = dicaDoCampo(campo);

  return (
    <div
      className={cn(
        // O rótulo cede espaço na coluna do negócio e mantém o teto de 180px
        // na ficha inteira. O valor pode quebrar linha sem alargar a coluna.
        // V5 (o "Perfil" do mockup): chave à esquerda, valor à direita, em negrito.
        "group grid grid-cols-[minmax(104px,min(38%,180px))_minmax(0,1fr)] items-baseline gap-4 rounded-lg px-2 py-[6px] -mx-2",
        "transition-colors hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-1.5 truncate text-[12.5px] text-muted-foreground">
        {campo.rotulo}
        {campo.somenteLeitura && (
          <Lock
            className="size-3 shrink-0 opacity-45"
            aria-label={documento ? "Sem permissão para alterar" : campo.origemErp ? "Sincronizado do ERP, somente leitura" : "Campo ainda sem coluna no banco"}
          />
        )}
      </span>

      {isEditing ? (
        <input
          autoFocus
          type={INPUT_TYPE[campo.tipo ?? "texto"] ?? "text"}
          inputMode={documento ? "numeric" : undefined}
          value={localValue}
          disabled={isSaving}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className={cn(
            "min-w-0 rounded-md border border-primary/50 bg-card px-1.5 py-0.5 text-right text-[13.5px] font-semibold",
            "focus:outline-none focus:ring-1 focus:ring-primary/30",
          )}
        />
      ) : (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            disabled={!editavel}
            onClick={startEditing}
            title={dica}
            className={cn(
              "flex min-w-0 items-center justify-end gap-1.5 break-words rounded text-right text-[13.5px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              vazio ? "text-muted-foreground/45" : "font-semibold text-foreground",
              campo.tipo === "documento" || campo.tipo === "moeda" ? "tabular-nums" : undefined,
              editavel && "cursor-text hover:text-foreground",
              !editavel && "cursor-default",
              erro && "text-destructive",
            )}
          >
            <span className="min-w-0 break-words">
              {vazio ? (campo.vazio ?? "—") : documento && !erro ? formatBrDocument(valorExibido) : valorExibido}
            </span>
            {isSaving && <Loader2 className="size-3 shrink-0 animate-spin opacity-60" />}
          </button>
          {/* O valor exibido não é o do ERP: diz isso na linha, sem esconder no hover. */}
          {campo.alteradoLocalmente && (
            <span className="self-end text-[11px] text-muted-foreground" title={dica}>
              alterado no Torque
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function LeadCardFields({
  grupos,
  onSave,
}: {
  grupos: LeadCardFieldGroup[];
  /** Persiste o campo. Sem ela o bloco fica só de leitura (visualização). */
  onSave?: (chave: string, valor: string) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-5">
      {grupos.map((grupo) => {
        const preenchidos = grupo.campos.filter((c) => c.valor !== null && c.valor !== "").length;

        return (
          <section key={grupo.titulo} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2.5 pb-1">
              <h3 className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
                {grupo.titulo}
              </h3>
              {/* Contador discreto: dá noção de completude sem transformar o
                  card num medidor de progresso, que empurra preenchimento
                  por preenchimento. */}
              <span className="text-[11px] tabular-nums text-muted-foreground/55">
                {preenchidos}/{grupo.campos.length}
              </span>
              <span className="h-px flex-1 bg-border/60" />
            </div>

            <div className="flex flex-col">
              {grupo.campos.map((campo) => (
                <Linha key={campo.chave} campo={campo} onSave={onSave} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
