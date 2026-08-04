import { cn } from "@/lib/utils";
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

function Linha({ campo }: { campo: LeadCardField }) {
  const vazio = campo.valor === null || campo.valor === "";

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
      <span className="truncate text-[12.5px] text-muted-foreground">{campo.rotulo}</span>
      <span
        className={cn(
          "min-w-0 break-words text-[13.5px]",
          vazio ? "text-muted-foreground/45" : "text-foreground",
          campo.tipo === "documento" || campo.tipo === "moeda" ? "tabular-nums" : undefined,
        )}
      >
        {vazio ? (campo.vazio ?? "—") : campo.valor}
      </span>
    </div>
  );
}

export function LeadCardFields({ grupos }: { grupos: LeadCardFieldGroup[] }) {
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
                <Linha key={campo.chave} campo={campo} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
