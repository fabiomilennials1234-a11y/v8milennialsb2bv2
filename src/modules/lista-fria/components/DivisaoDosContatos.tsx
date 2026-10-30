/**
 * Lista Fria · divisão dos contatos novos por tipo de contato (com @, com telefone, com e-mail).
 *
 * Fica na revisão, antes de importar: o cliente vê quantos contatos têm cada tipo e marca um ou mais. Marcar vários
 * vale como "E": só entra quem tem TODOS os tipos marcados. Os mesmos critérios filtram a lista e, no botão, decidem
 * o que será importado (a seleção é feita no banco, que é quem conta).
 */
import { AtSign, Loader2, Mail, Phone } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { fraseDosCriterios, type CriteriosDeContato, type DivisaoDosContatos } from "../lib/tipos";

const n = (v: number) => v.toLocaleString("pt-BR");

const TIPOS: ReadonlyArray<{
  chave: keyof CriteriosDeContato;
  contagem: keyof Pick<DivisaoDosContatos, "comInstagram" | "comTelefone" | "comEmail">;
  rotulo: string;
  icone: ReactNode;
}> = [
  { chave: "comInstagram", contagem: "comInstagram", rotulo: "Com @", icone: <AtSign className="size-4" aria-hidden /> },
  { chave: "comTelefone", contagem: "comTelefone", rotulo: "Com telefone", icone: <Phone className="size-4" aria-hidden /> },
  { chave: "comEmail", contagem: "comEmail", rotulo: "Com e-mail", icone: <Mail className="size-4" aria-hidden /> },
];

interface Props {
  divisao: DivisaoDosContatos | undefined;
  criterios: CriteriosDeContato;
  onCriterios: (c: CriteriosDeContato) => void;
  /** Marca no banco só quem tem todos os tipos marcados. */
  onSelecionar: () => void;
  selecionando: boolean;
  podeEditar: boolean;
}

export function DivisaoDosContatosPainel({ divisao, criterios, onCriterios, onSelecionar, selecionando, podeEditar }: Props) {
  const marcados = TIPOS.filter((t) => criterios[t.chave]).length;
  const novos = divisao?.novos ?? 0;
  const combinacao = divisao?.combinacao ?? 0;

  return (
    <section aria-label="Divisão dos contatos" className="space-y-3 rounded-[22px] border border-card-border bg-card p-4 shadow-relevo">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15px] font-extrabold tracking-tight">Divisão dos contatos novos</h2>
        <p className="text-xs text-muted-foreground">Marque mais de um tipo para exigir todos ao mesmo tempo (E).</p>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        {TIPOS.map((t) => {
          const total = divisao?.[t.contagem] ?? 0;
          const ativo = criterios[t.chave];
          return (
            <label
              key={t.chave}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 transition-colors",
                ativo ? "border-primary bg-primary-soft" : "border-border bg-muted/30 hover:bg-muted/50",
                total === 0 && !ativo && "cursor-not-allowed opacity-50",
              )}
            >
              <Checkbox
                checked={ativo}
                disabled={total === 0 && !ativo}
                onCheckedChange={(v) => onCriterios({ ...criterios, [t.chave]: v === true })}
                aria-label={t.rotulo}
              />
              <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
                {t.icone}
                <span className="truncate">{t.rotulo}</span>
              </span>
              <b className="text-[15px] tabular-nums" aria-label={`${n(total)} contatos`}>
                {divisao ? n(total) : "·"}
              </b>
            </label>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-sm" aria-live="polite">
          {marcados === 0 ? (
            <>
              <b className="tabular-nums">{n(novos)}</b> contatos novos no total.
            </>
          ) : (
            <>
              <b className="tabular-nums">{n(combinacao)}</b> de {n(novos)} têm <b>{fraseDosCriterios(criterios)}</b>.
            </>
          )}
        </p>
        {podeEditar && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSelecionar}
            disabled={selecionando || combinacao === 0}
          >
            {selecionando ? <Loader2 className="animate-spin" /> : null}
            {marcados === 0 ? `Selecionar todos (${n(combinacao)})` : `Selecionar só estes (${n(combinacao)})`}
          </Button>
        )}
      </div>
    </section>
  );
}
