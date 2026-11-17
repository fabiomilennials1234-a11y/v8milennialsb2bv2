import { formatPhoneBR } from "@/shared/format/phone";
import type { ClienteParaAgenda } from "@/modules/analytics/lib/agenda-contatos";

/**
 * O que aparece ao passar o mouse num cliente da busca da "Nova agenda": os
 * mesmos dados da planilha da Café (razão social, fantasia, código, cidade,
 * representante, telefones), para conferir se é o cliente certo antes de marcar.
 */
export function ClienteAgendaInfo({ cliente }: { cliente: ClienteParaAgenda }) {
  const local = [cliente.cidade, cliente.uf].filter(Boolean).join(" / ");
  const linhas: Array<[string, string | null]> = [
    ["Nome fantasia", cliente.company],
    ["Cód. ERP", cliente.erp_code],
    ["Cidade", local || null],
    ["Representante", cliente.representante],
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] font-semibold leading-snug">{cliente.name || "Sem nome"}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="contents">
            <dt className="text-muted-foreground">{rotulo}</dt>
            <dd className="min-w-0 break-words font-medium">{valor ?? <span className="font-normal text-muted-foreground">—</span>}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">Telefones</dt>
        <dd className="min-w-0 font-medium">
          {cliente.telefones.length === 0 ? (
            <span className="font-normal text-muted-foreground">—</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {cliente.telefones.map((t) => (
                <li key={t} className="tabular-nums">{formatPhoneBR(t)}</li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </div>
  );
}
