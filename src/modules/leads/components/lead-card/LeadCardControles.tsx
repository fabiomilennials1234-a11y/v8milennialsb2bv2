import { cn } from "@/lib/utils";

import { QualificationSlot } from "../lead-detail/modal/header/QualificationSlot";
import { QUALIFICATION_TIER_CONFIG } from "../lead-detail/modal/qualification-config";
import { ResponsibleSlot } from "../lead-detail/modal/header/ResponsibleSlot";
import type { QualificationTier } from "../lead-detail/modal/types";

/**
 * Os controles de qualificação e de responsáveis da coluna do Lead.
 *
 * ── POR QUE ELES VIVEM AQUI, E NÃO DENTRO DO `LeadCardAside` ──────────────
 * `LeadCardAside` é alcançável a partir de `src/preview/main.tsx`, e o teste
 * `preview-cards-sem-banco.test.ts` (inv:H5-17) reprova qualquer arquivo daquele
 * grafo que alcance react-query ou escreva a palavra `supabase` — a rota abre
 * sem login. `QualificationSlot` e `ResponsibleSlot` gravam por `useUpdateLead`,
 * então não podem ser importados de lá.
 *
 * O escape já é o idioma da casa: o card recebe o controle PRONTO como
 * `ReactNode` (é assim que `acaoWhatsapp` e `menuAdicionar` chegam ao
 * `LeadCardCompact`, ali por causa de ciclo no dependency-cruiser). Quem monta é
 * o `LeadCardContainer`, que já está fora do grafo do preview por construção.
 *
 * ── POR QUE `QualificationSlot` E NÃO O POPOVER DO CARD ───────────────────
 * `LeadCardQualificationPopover` — o que esta mesma frente criou para o card do
 * board — tem o gatilho **cravado** num `LeadCardAvatar` de 22px e não aceita
 * `children` nem `asChild`. Na coluna do painel ele apareceria como um segundo
 * avatar minúsculo ao lado do de 76px. `QualificationSlot` é um campo por
 * instância, desenha círculo de 36px, já traz a linha "Remover" explícita e já
 * atravessa módulo (o painel de contexto do chat monta os dois).
 *
 * ── NÃO PRECISA DE INVALIDAÇÃO PRÓPRIA ────────────────────────────────────
 * `useUpdateLead` invalida `["lead-detail", id]` — exatamente a chave que esta
 * coluna lê. A tela se corrige sozinha depois da escrita.
 */

function Faixa({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Um cartão da grade do V5 (a aba Dados da gaveta): rótulo micro em cima, o
 * controle e o que ele marca embaixo. O texto ao lado do controle repete o que
 * o círculo só mostra em iniciais/ícone — é o que o mockup lê sem passar o mouse.
 */
function Cartao({
  rotulo,
  valor,
  vazio,
  children,
}: {
  rotulo: string;
  valor: string | null;
  vazio: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[18px] border border-card-border bg-card px-3.5 py-3 shadow-relevo">
      <span className="text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground">
        {rotulo}
      </span>
      <div className="flex min-w-0 items-center gap-2.5">
        {children}
        <span
          className={cn(
            "min-w-0 truncate text-[13.5px]",
            valor ? "font-bold text-foreground" : "text-muted-foreground",
          )}
        >
          {valor ?? vazio}
        </span>
      </div>
    </div>
  );
}

export interface MembroDoLead {
  id: string;
  name: string;
  avatar_url?: string | null;
}

export function LeadCardControles({
  leadId,
  preVenda,
  venda,
  preQualificacao,
  qualificacao,
  atualizadoEm,
  className,
  forma = "faixa",
}: {
  leadId: string;
  preVenda: MembroDoLead | null;
  venda: MembroDoLead | null;
  preQualificacao: QualificationTier | null;
  qualificacao: QualificationTier | null;
  /**
   * `leads.updated_at` no momento do render — liga a trava otimista (#307).
   *
   * A ficha do lead (`LeadActionsBlock`) NÃO passa isto, e por isso duas pessoas
   * editando o mesmo lead gravam por cima uma da outra em silêncio. Aqui passa:
   * o conflito vira toast e refetch em vez de sobrescrita muda.
   */
  atualizadoEm?: string | null;
  className?: string;
  /**
   * `faixa` é a coluna estreita (duas linhas com rótulo e círculos);
   * `grade` é a aba Dados da gaveta do V5: quatro cartões em 2 × 2, como no
   * mockup. Os controles são OS MESMOS — só muda onde cada um mora.
   */
  forma?: "faixa" | "grade";
}) {
  if (forma === "grade") {
    const tier = (t: QualificationTier | null) => (t ? QUALIFICATION_TIER_CONFIG[t]?.label ?? null : null);
    return (
      <div className={cn("grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2", className)}>
        <Cartao rotulo="Resp. Pré-venda" valor={preVenda?.name ?? null} vazio="Sem responsável">
          <ResponsibleSlot
            leadId={leadId}
            field="pre_sale_responsible_id"
            label="Pré-Venda"
            currentMember={preVenda}
            expectedUpdatedAt={atualizadoEm}
          />
        </Cartao>
        <Cartao rotulo="Resp. Venda" valor={venda?.name ?? null} vazio="Sem responsável">
          <ResponsibleSlot
            leadId={leadId}
            field="sale_responsible_id"
            label="Venda"
            currentMember={venda}
            expectedUpdatedAt={atualizadoEm}
          />
        </Cartao>
        <Cartao rotulo="Pré-qualificação" valor={tier(preQualificacao)} vazio="Não definida">
          <QualificationSlot
            leadId={leadId}
            field="pre_qualification_tier"
            label="Pré-Qualificação"
            current={preQualificacao}
          />
        </Cartao>
        <Cartao rotulo="Qualificação" valor={tier(qualificacao)} vazio="Não definida">
          <QualificationSlot
            leadId={leadId}
            field="qualification_tier"
            label="Qualificação"
            current={qualificacao}
          />
        </Cartao>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      <Faixa rotulo="Responsáveis">
        <ResponsibleSlot
          leadId={leadId}
          field="pre_sale_responsible_id"
          label="Pré-Venda"
          currentMember={preVenda}
          expectedUpdatedAt={atualizadoEm}
        />
        <ResponsibleSlot
          leadId={leadId}
          field="sale_responsible_id"
          label="Venda"
          currentMember={venda}
          expectedUpdatedAt={atualizadoEm}
        />
      </Faixa>

      <Faixa rotulo="Qualificação">
        <QualificationSlot
          leadId={leadId}
          field="pre_qualification_tier"
          label="Pré-Qualificação"
          current={preQualificacao}
        />
        <QualificationSlot
          leadId={leadId}
          field="qualification_tier"
          label="Qualificação"
          current={qualificacao}
        />
      </Faixa>
    </div>
  );
}
