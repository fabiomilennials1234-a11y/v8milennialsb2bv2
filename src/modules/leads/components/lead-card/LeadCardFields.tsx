import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useInlineEdit } from "../lead-detail/hooks/useInlineEdit";
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

function Linha({
  campo,
  onSave,
}: {
  campo: LeadCardField;
  onSave?: (chave: string, valor: string) => Promise<void>;
}) {
  const [erro, setErro] = useState(false);
  const vazio = campo.valor === null || campo.valor === "";

  // `somenteLeitura` marca o campo que ainda não tem coluna em `leads` (CNPJ,
  // site, nascimento, endereço). Ele APARECE, por decisão do CTO — sumir é o
  // que faz ninguém preencher — mas não finge que grava.
  const editavel = !!onSave && !campo.somenteLeitura;

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
    });

  return (
    <div
      className={cn(
        // Rótulo com teto fixo: em `fr` ele acompanhava a largura do painel e
        // abria um vão de 250px entre o nome do campo e o valor, quebrando a
        // leitura em par.
        "group grid grid-cols-[minmax(104px,180px)_1fr] items-baseline gap-4 rounded-md px-2 py-[7px] -mx-2",
        "transition-colors hover:bg-muted/40",
      )}
    >
      <span className="flex items-center gap-1.5 truncate text-[12.5px] text-muted-foreground">
        {campo.rotulo}
        {campo.somenteLeitura && (
          <Lock
            className="size-3 shrink-0 opacity-45"
            aria-label="Campo ainda sem coluna no banco"
          />
        )}
      </span>

      {isEditing ? (
        <input
          autoFocus
          type={INPUT_TYPE[campo.tipo ?? "texto"] ?? "text"}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          className={cn(
            "min-w-0 rounded border border-primary/50 bg-background px-1.5 py-0.5 text-[13.5px]",
            "focus:outline-none focus:ring-1 focus:ring-primary/30",
          )}
        />
      ) : (
        <button
          type="button"
          disabled={!editavel}
          onClick={startEditing}
          title={campo.somenteLeitura ? "Este campo ainda não existe no banco" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-1.5 break-words rounded text-left text-[13.5px]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            vazio ? "text-muted-foreground/45" : "text-foreground",
            campo.tipo === "documento" || campo.tipo === "moeda" ? "tabular-nums" : undefined,
            editavel && "cursor-text hover:text-foreground",
            !editavel && "cursor-default",
            erro && "text-destructive",
          )}
        >
          <span className="min-w-0 break-words">
            {vazio ? (campo.vazio ?? "—") : campo.valor}
          </span>
          {isSaving && <Loader2 className="size-3 shrink-0 animate-spin opacity-60" />}
        </button>
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
    <div className="flex flex-col gap-7 pb-2">
      {grupos.map((grupo) => {
        const preenchidos = grupo.campos.filter((c) => c.valor !== null && c.valor !== "").length;

        return (
          <section key={grupo.titulo} className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2.5 pb-1">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
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
