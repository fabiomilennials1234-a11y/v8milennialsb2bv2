/**
 * EscapeDeJanelaConfig — o que o nó de TEXTO manda quando a janela de 24 horas
 * fechou (issue #1689).
 *
 * ─── O PROBLEMA QUE ELE RESOLVE NA TELA ─────────────────────────────────────
 *
 * Num canal oficial a Meta recusa mensagem livre depois de 24 horas sem o
 * contato falar. Sem declaração nenhuma, o nó de texto simplesmente falha — e
 * como NENHUMA das 1.749 ligações entre nós dos workflows ativos é saída de
 * erro, um nó que falha derruba a execução inteira. O campo abaixo é a única
 * declaração que mantém a régua viva nessa hora.
 *
 * ─── POR QUE ELE SÓ APARECE NO CANAL OFICIAL ────────────────────────────────
 *
 * O nó de texto é o mais usado do produto — 9.394 envios por semana, todos por
 * chip. Chip não tem janela: o campo seria ruído permanente para ~30 orgs que
 * nunca vão precisar dele, e ruído permanente é como um aviso deixa de ser
 * lido. Aparece quando o nó nomeia o canal oficial, que é quando ele passa a
 * ter consequência.
 *
 * ⚠️ ELE NÃO REPETE A REGRA. Quem decide entre texto, template e falha é
 * `supabase/functions/_shared/decisao-de-envio.ts`, no envio. Este painel só
 * COLETA o template e conta ao operador o que vai acontecer sem ele — não há
 * segunda cópia da decisão para divergir da primeira.
 */
import { getProviderProfile, useWhatsAppInstances } from "@/modules/communication";
import type { ActionNodeData } from "@/types/workflow";

import { CAMPOS_DO_ESCAPE_DE_JANELA } from "./campos-de-template";
import { TemplateNodeConfig } from "./TemplateNodeConfig";

interface Props {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}

export function EscapeDeJanelaConfig({ data, onUpdate }: Props) {
  const { data: instancias } = useWhatsAppInstances();
  const instanciaDoNo = (instancias || []).find((i) => i.id === data.whatsappInstanceId);

  // Mesmo recorte do painel do nó de template: o registro de provedores
  // responde "este número tem templates?", e só o canal do NotificaMe é listado
  // por `useNotificameTemplates`. Um chip cai fora e a tela dele não muda.
  const perfil = getProviderProfile(instanciaDoNo?.provider);
  const oficial = !!instanciaDoNo && perfil.capabilities.templates &&
    perfil.id === "notificame";

  if (!oficial) return null;

  const configurado = !!data.escapeTemplateName;

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Se a janela de 24 horas estiver fechada</p>
        <p className="text-xs text-muted-foreground">
          Quando o lead não fala com este número há mais de 24 horas, a Meta só
          aceita template aprovado. Escolha qual template o nó manda nessa hora.
        </p>
      </div>

      {!configurado && (
        <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
          <p className="text-xs text-warning">
            Sem template aqui, o nó falha quando a janela estiver fechada — e a
            execução do workflow para nesse ponto.
          </p>
        </div>
      )}

      <TemplateNodeConfig
        data={data}
        onUpdate={onUpdate}
        campos={CAMPOS_DO_ESCAPE_DE_JANELA}
      />
    </div>
  );
}
