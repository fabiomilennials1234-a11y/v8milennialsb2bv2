import { useEffect, useState } from "react";
import { ExternalLink, Pencil, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadCardMetrics } from "./LeadCardMetrics";
import { LeadCardNotes } from "./LeadCardNotes";
import { LeadCardFields } from "./LeadCardFields";
import type { LeadCardData } from "./types";

/**
 * A coluna do LEAD dentro do painel do Negócio — a metade esquerda do print.
 *
 * ── POR QUE A PESSOA VOLTOU PARA DENTRO DO NEGÓCIO ────────────────────────
 * O produto tinha dois painéis que se excluíam: abrir o Negócio fechava o Lead
 * e vice-versa, com o argumento de que empilhar as duas fichas cria duas
 * verdades sobre a mesma pessoa na tela. O argumento continua de pé — o que o
 * print do DataCrazy mostra é a saída que faltava: **não empilhar, encostar**.
 * Lado a lado não há duas verdades, há uma pessoa e um negócio dela, cada um
 * dono do seu assunto e os dois legíveis de uma vez.
 *
 * Nada aqui é desenho novo: métricas, anotação e campos são os mesmos
 * componentes do card do Lead, com os mesmos dados e a mesma gravação. O que
 * muda é a largura e a ordem.
 *
 * ── O QUE DO PRINT NÃO ENTROU ─────────────────────────────────────────────
 * "+ Adicionar listas" (o Torque não tem listas) e "+ Executar automação do
 * lead" (disparar workflow daqui puxaria o módulo de automações para dentro do
 * card e fecharia ciclo no dependency-cruiser). Ficam de fora em vez de virar
 * botão que não faz nada.
 */

/** Hue estável a partir do nome — mesma pessoa, mesma cor, sempre. */
function hueDoNome(nome: string): number {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return h;
}

export function LeadCardAside({
  lead,
  onSaveNote,
  onSaveField,
  onAbrirFicha,
  controles,
}: {
  lead: LeadCardData;
  onSaveNote?: (texto: string) => void;
  onSaveField?: (chave: string, valor: string) => Promise<void>;
  /** Abre a ficha inteira do lead. Sem ela o lápis não aparece. */
  onAbrirFicha?: () => void;
  /**
   * Qualificação e responsáveis, montados PRONTOS por quem tem acesso ao banco.
   *
   * Não é preciosismo de arquitetura: este arquivo está no grafo de
   * `/preview.html`, e `preview-cards-sem-banco.test.ts` reprova qualquer coisa
   * aqui dentro que alcance react-query. Mesmo formato de `acaoWhatsapp` no
   * `LeadCardCompact`. Sem a prop, a coluna continua como era — só de leitura.
   */
  controles?: React.ReactNode;
}) {
  const [nota, setNota] = useState(lead.nota);
  const [grupo, setGrupo] = useState(0);
  const h = hueDoNome(lead.nome);

  // A anotação é estado local para não piscar a cada tecla — e por isso PRECISA
  // ser reposta ao trocar de pessoa, senão o card grava a nota de um no outro.
  useEffect(() => {
    setNota(lead.nota);
    setGrupo(0);
  }, [lead.id, lead.nota]);

  const grupos = lead.campos;
  const grupoAtivo = grupos[Math.min(grupo, Math.max(0, grupos.length - 1))];

  return (
    <aside className="flex h-full min-h-0 w-[356px] shrink-0 flex-col border-r border-border">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Capa + avatar, como no print. A capa não é enfeite gratuito: ela dá
            um chão para o avatar transbordar e é o que separa a coluna da
            pessoa da coluna do negócio sem precisar de mais uma borda. */}
        <div
          className="h-[92px] w-full"
          style={{
            background: `linear-gradient(135deg, hsl(${h} 45% 30%), hsl(${(h + 40) % 360} 40% 18%))`,
          }}
          aria-hidden="true"
        />

        <div className="flex flex-col items-center px-5 pb-5">
          <div className="relative -mt-[38px]">
            <div
              style={{ "--h": h } as React.CSSProperties}
              className={cn(
                "flex size-[76px] items-center justify-center rounded-full text-[30px] font-semibold",
                "ring-4 ring-background",
                "bg-[hsl(var(--h)_70%_92%)] text-[hsl(var(--h)_55%_32%)]",
                "dark:bg-[hsl(var(--h)_42%_22%)] dark:text-[hsl(var(--h)_58%_74%)]",
              )}
              aria-hidden="true"
            >
              {(lead.nome || "?").trim().charAt(0).toUpperCase()}
            </div>
            {onAbrirFicha && (
              <button
                type="button"
                onClick={onAbrirFicha}
                title="Abrir a ficha completa do lead"
                aria-label="Abrir a ficha completa do lead"
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full",
                  "border border-border bg-card text-muted-foreground shadow-sm",
                  "transition-colors hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <Pencil className="size-3.5" />
              </button>
            )}
          </div>

          <h2 className="mt-2.5 max-w-full truncate text-center text-[17px] font-semibold tracking-[-0.02em]">
            {lead.nome}
          </h2>
          {lead.empresa && (
            <p className="max-w-full truncate text-center text-[12.5px] text-muted-foreground">
              {lead.empresa}
            </p>
          )}

          {/* Relação e etiquetas. A faixa fica mesmo vazia: sumir quando não há
              etiqueta é o que faz ninguém nunca etiquetar. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {lead.relacao === "cliente" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-[3px] text-[11.5px] font-semibold text-primary">
                <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                Cliente
              </span>
            )}
            {lead.tags.map((t) => (
              <span
                key={t.id}
                className="inline-flex rounded-full border border-border bg-muted/50 px-2.5 py-[3px] text-[11.5px] text-muted-foreground"
              >
                {t.nome}
              </span>
            ))}
            {lead.tags.length === 0 && (
              <span className="inline-flex rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11.5px] text-muted-foreground/70">
                sem etiqueta
              </span>
            )}
          </div>

          {/* "Sem atendente" do print — link azul quando vazio, que é o padrão
              do DataCrazy inteiro: campo vazio é convite, não lacuna. */}
          <div className="mt-3 flex w-full items-center justify-center gap-2 border-t border-border pt-3 text-[12.5px]">
            <UserRound className="size-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
            {lead.dono ? (
              <span className="truncate text-foreground/90" title={lead.dono.papel}>
                {lead.dono.nome}
              </span>
            ) : (
              <span className="text-primary underline underline-offset-2">Sem atendente</span>
            )}
          </div>

          {/* Os controles ficam logo abaixo da linha do atendente porque é a
              mesma pergunta — "quem cuida disto?" — só que acionável. A linha
              de cima continua existindo: ela mostra o NOME do responsável
              efetivo, e os círculos dos slots mostram só as iniciais. Trocar
              uma pela outra ganharia um clique e perderia a leitura. */}
          {controles && (
            <div className="mt-3 w-full border-t border-border pt-3">{controles}</div>
          )}

          {onAbrirFicha && (
            <button
              type="button"
              onClick={onAbrirFicha}
              className={cn(
                "mt-2 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground",
                "transition-colors hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              Ver ficha completa
              <ExternalLink className="size-3" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-5 border-t border-border px-5 py-5">
          <LeadCardMetrics metricas={lead.metricas} />
        </div>

        {grupos.length > 0 && (
          <div className="flex flex-col border-t border-border">
            {/* As abas Perfil | Endereço | Campos adicionais do print. Os grupos
                já vêm prontos de `useLeadCardData`; aqui só se escolhe um por
                vez, porque a coluna tem 356px e a pilha inteira empurrava a
                anotação para 4 telas abaixo. */}
            <nav className="flex items-center gap-1 overflow-x-auto border-b border-border px-3">
              {grupos.map((g, i) => {
                const acesa = i === Math.min(grupo, grupos.length - 1);
                return (
                  <button
                    key={g.titulo}
                    type="button"
                    onClick={() => setGrupo(i)}
                    className={cn(
                      "relative shrink-0 px-2.5 py-2.5 text-[12.5px] transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      acesa
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {g.titulo}
                    {acesa && (
                      <span className="absolute inset-x-1.5 -bottom-px h-[2px] rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="px-5 py-4">
              {grupoAtivo && <LeadCardFields grupos={[grupoAtivo]} onSave={onSaveField} />}
            </div>
          </div>
        )}
      </div>

      {/* A anotação fica ancorada no pé, como no card do Lead: se ela some
          abaixo da dobra, "espaço para anotação" vira promessa. */}
      <div className="shrink-0 border-t border-border px-5 py-4">
        <LeadCardNotes
          valor={nota}
          onSave={(texto) => {
            setNota(texto);
            onSaveNote?.(texto);
          }}
        />
      </div>
    </aside>
  );
}
