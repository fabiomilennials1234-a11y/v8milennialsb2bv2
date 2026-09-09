/**
 * templates-aprovados — quais Templates são escolhíveis, num lugar só (#1722).
 *
 * A pergunta "que Templates esta conta pode disparar" ganhou um SEGUNDO
 * consumidor: além do nó de Workflow (#1688, e o escape de janela #1689), agora
 * o passo de conteúdo do Disparo pelo Canal Oficial.
 *
 * ⚠️ É a mesma forma do defeito que o #1722 conserta uma camada acima: três
 * telas decidindo por conta própria quais NÚMEROS existiam, e o vendedor
 * descobrindo a divergência pela string crua do fornecedor. A decisão mora aqui;
 * a APRESENTAÇÃO é de cada tela, e essa pode diferir à vontade.
 *
 * Puro: sem React, sem rede. A listagem em si é do `useNotificameTemplates`.
 */
import { getProviderProfile } from "../lib/whatsapp-provider";

/** A forma mínima que a decisão precisa — subconjunto de `NotificameTemplate`. */
interface TemplateComStatus {
  status?: string | null;
}

/**
 * Só APROVADO é escolhível.
 *
 * ⚠️ `listTemplates` NÃO filtra por status: devolve PENDING, REJECTED, PAUSED e
 * DISABLED junto. O filtro é de quem chama — e um template em análise não é
 * opção, é espera. No Canal Oficial listá-lo é pior que inútil: a recusa da Meta
 * chega por CALLBACK, depois de o envio já ter parecido bem-sucedido.
 */
export function apenasAprovados<T extends TemplateComStatus>(
  templates: T[] | null | undefined,
): T[] {
  return (templates ?? []).filter((t) => t.status === "APPROVED");
}

/**
 * Esta conta tem uma listagem de Templates que nós sabemos ler?
 *
 * ⚠️ Mais estreito que `capabilities.templates` DE PROPÓSITO. O `meta_cloud`
 * também tem Templates aprovados, mas os dele não saem por
 * `useNotificameTemplates` — aquela listagem é da conta do NotificaMe. Listar um
 * pelo outro devolveria a lista errada, ou vazia, sem dizer por quê.
 */
export function contaListaTemplates(provider: string | null | undefined): boolean {
  if (!provider) return false;
  const perfil = getProviderProfile(provider as never);
  return !!perfil?.capabilities?.templates && perfil.id === "notificame";
}
