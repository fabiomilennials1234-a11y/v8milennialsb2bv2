/**
 * TemplateNodeConfig — o painel do nó `send_whatsapp_template` (issue #1688).
 *
 * ─── O QUE ESTE PAINEL SUBSTITUI ────────────────────────────────────────────
 *
 * Um campo de texto livre chamado "ID do Template", que gravava `templateId` e
 * era lido por um handler que consultava uma tabela `whatsapp_templates` que
 * nunca existiu em produção. O nó tem 0 usos — nenhum cliente perdeu nada.
 *
 * ─── AS DUAS COISAS QUE ESTE PAINEL PRECISA SABER, E POR QUÊ ─────────────────
 *
 * 1. QUAL NÚMERO. Template aprovado é um objeto da conta da Meta, e quem tem
 *    conta da Meta é o canal oficial. Um chip Uazapi não tem templates — o
 *    provider dele nem implementa `sendTemplate`. Por isso o painel exige que o
 *    nó NOMEIE o canal oficial em "Número de saída" antes de listar qualquer
 *    coisa: sem instância não há de quem perguntar.
 *
 *    Nomear é a única forma. O canal oficial não entra nos degraus automáticos
 *    do roteamento — `conversation` e `responsible` nunca o resolvem, então um
 *    nó de template em política automática falharia sempre.
 *
 *    ⚠️ ESTE PAINEL NASCE INERTE, e é uma dependência de SEQUÊNCIA, não de
 *    código. Poder NOMEAR o canal oficial no "Número de saída" é o #1690
 *    (PR #1699), que ainda não está na main. Sem ele o canal oficial não
 *    aparece no seletor (`isRoutableInstance` filtra por uazapi/evolution) e
 *    o executor também não o carregaria (`loadInstance` filtra pelos mesmos
 *    provedores). Enquanto o #1699 não entrar, o operador chega no primeiro
 *    aviso e não tem opção válida para escolher — o que ainda é melhor que o
 *    campo de texto livre que este painel substitui, que prometia envio de
 *    template e não mandava nada. Quando o #1699 entrar, isto passa a
 *    funcionar sem uma linha a mais aqui.
 *
 * 2. A FORMA DO TEMPLATE. Não há catálogo local, e isso é decisão registrada na
 *    spec (#1684). O nó guarda o nome, o idioma e os `components` como vieram
 *    da listagem; o executor remonta o envio a partir disso, sem listar nada.
 *    Template removido na Meta depois de escolhido faz o envio falhar com o
 *    motivo dela, que é legível — melhor que um catálogo nosso mentindo que
 *    ainda existe.
 *
 * ⚠️ O MAPA DE VARIÁVEIS TEM DOIS NAMESPACES, e confundi-los troca os valores.
 * A CHAVE é o token do template da Meta (`1`, `2`, ou um nome quando o template
 * é NAMED). O VALOR é uma expressão do Torque (`{{nome}}`), resolvida contra o
 * lead no instante do envio. `{ "1": "{{nome}}" }` lê-se "o primeiro parâmetro
 * do template recebe o nome do lead".
 */
import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  botoesComVariavel,
  formatoDeMidiaDoCabecalho,
  getProviderProfile,
  midiaDeExemploDoCabecalho,
  previewDoTemplate,
  useNotificameTemplates,
  useWhatsAppInstances,
  variaveisDoTemplate,
  type NotificameTemplate,
} from "@/modules/communication";
import { VariableInserter } from "@/modules/workflows/components/VariableInserter";
import type { ActionNodeData } from "@/types/workflow";

import {
  CAMPOS_DO_NO_DE_TEMPLATE,
  type CamposDeTemplate,
} from "./campos-de-template";

interface Props {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
  /** Default: os campos do nó de template. */
  campos?: CamposDeTemplate;
}

/** Um bloco de aviso — o painel tem quatro estados que não são "pronto". */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
      <p className="text-xs text-warning">{children}</p>
    </div>
  );
}

export function TemplateNodeConfig({
  data,
  onUpdate,
  campos = CAMPOS_DO_NO_DE_TEMPLATE,
}: Props) {
  const { data: instancias } = useWhatsAppInstances();

  // Chave computada não é atribuível a `Partial<ActionNodeData>` sem asserção —
  // o TypeScript perde o literal ao indexar. As cinco chaves possíveis são as da
  // interface acima, e é ela quem prende a lista.
  const gravar = (updates: Record<string, unknown>) =>
    onUpdate(updates as Partial<ActionNodeData>);

  const nomeEscolhido = data[campos.name];
  const idiomaEscolhido = data[campos.language];
  const componentesEscolhidos = data[campos.components];
  const midiaEscolhida = data[campos.headerMediaUrl];

  const instanciaDoNo = (instancias || []).find((i) => i.id === data.whatsappInstanceId);

  // Quem responde "este número tem templates?" é o REGISTRO DE PROVEDORES, que
  // já existe e é allowlist positiva (cert Rule 13). Perguntar por
  // `capabilities.templates` em vez de comparar o provedor à mão é o que
  // impede que um provedor novo entre valendo por omissão.
  const perfil = getProviderProfile(instanciaDoNo?.provider);
  const temTemplates = !!instanciaDoNo && perfil.capabilities.templates;

  // ⚠️ Mais estreito que `capabilities.templates` DE PROPÓSITO. `meta_cloud`
  // também tem templates aprovados, mas os dele não saem por
  // `useNotificameTemplates` — essa listagem é da conta do NotificaMe. Listar
  // um pelo outro devolveria a lista errada, ou vazia, sem dizer por quê.
  const oficial = temTemplates && perfil.id === "notificame";

  const { data: templates, isLoading, error } = useNotificameTemplates({
    instanceId: oficial ? data.whatsappInstanceId : null,
  });

  // Só APROVADO aparece. Um template em análise não é opção, é espera — listá-lo
  // como escolhível entregaria uma recusa certa no dia em que o workflow rodar.
  const aprovados = useMemo(
    () => (templates || []).filter((t) => t.status === "APPROVED"),
    [templates],
  );

  // O que o nó guardou, remontado no formato que os helpers pedem. O painel não
  // depende da listagem para renderizar o que já foi escolhido: se a conta ficar
  // fora do ar, o operador ainda vê a configuração que existe.
  const escolhido: NotificameTemplate | null = useMemo(() => {
    if (!nomeEscolhido) return null;
    const daLista = aprovados.find((t) => t.name === nomeEscolhido);
    if (daLista) return daLista;
    return {
      name: nomeEscolhido,
      id: null,
      language: idiomaEscolhido ?? null,
      status: "APPROVED",
      category: null,
      parameterFormat: null,
      components: componentesEscolhidos ?? [],
    };
  }, [nomeEscolhido, idiomaEscolhido, componentesEscolhidos, aprovados]);

  const variaveis = escolhido ? variaveisDoTemplate(escolhido).todas : [];
  const formatoDeMidia = escolhido ? formatoDeMidiaDoCabecalho(escolhido) : null;
  const botoesVariaveis = escolhido ? botoesComVariavel(escolhido) : [];
  const mapa = data[campos.variables] ?? {};

  function escolher(nome: string) {
    const t = aprovados.find((x) => x.name === nome);
    if (!t) return;
    gravar({
      [campos.name]: t.name,
      [campos.language]: t.language ?? "pt_BR",
      [campos.components]: t.components,
      // Mapa zerado: os tokens do template anterior não têm relação com os
      // deste, e aproveitá-los mandaria o valor de `{{1}}` de outro template.
      [campos.variables]: {},
      // A Meta guarda o arquivo do cabeçalho junto do template aprovado. Pedir
      // upload de algo que ela já tem seria retrabalho.
      [campos.headerMediaUrl]: midiaDeExemploDoCabecalho(t) ?? "",
    });
  }

  function definirVariavel(token: string, valor: string) {
    gravar({ [campos.variables]: { ...mapa, [token]: valor } });
  }

  if (!data.whatsappInstanceId) {
    return (
      <Aviso>
        Escolha primeiro o número de saída, acima. Templates aprovados pertencem
        à conta da Meta, então o nó precisa saber por qual número vai perguntar.
      </Aviso>
    );
  }

  if (!temTemplates) {
    return (
      <Aviso>
        O número escolhido não é o canal oficial. Templates aprovados só existem
        na conta da Meta — um número comum não tem nenhum, e o envio falharia.
      </Aviso>
    );
  }

  if (!oficial) {
    return (
      <Aviso>
        Este número é oficial, mas não é o canal do NotificaMe — os templates
        dele não saem por esta listagem. Escolha o número do WhatsApp Oficial.
      </Aviso>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Template aprovado</Label>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando templates...</p>
        ) : error ? (
          <Aviso>Não foi possível ler os templates da conta. Tente de novo.</Aviso>
        ) : aprovados.length === 0 ? (
          <Aviso>
            Nenhum template aprovado nesta conta. Crie e aguarde a aprovação da
            Meta em Configurações &gt; WhatsApp.
          </Aviso>
        ) : (
          <Select value={nomeEscolhido || ""} onValueChange={escolher}>
            <SelectTrigger aria-label="Template aprovado">
              <SelectValue placeholder="Selecione o template" />
            </SelectTrigger>
            <SelectContent>
              {aprovados.map((t) => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                  {t.language ? ` (${t.language})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {nomeEscolhido && !isLoading && !aprovados.some((t) => t.name === nomeEscolhido) && (
          <Aviso>
            O template “{nomeEscolhido}” não está mais aprovado nesta conta.
            O envio vai falhar com o motivo da Meta. Escolha outro.
          </Aviso>
        )}
      </div>

      {/*
        Botão de URL com parte variável não tem como ser preenchido por aqui: o
        executor monta o envio sem valores de botão, então `pendenciasDeEnvio`
        barra a mensagem antes de gastá-la. Avisar na configuração é melhor do
        que deixar o funil rodar meses e falhar toda vez.
      */}
      {botoesVariaveis.length > 0 && (
        <Aviso>
          Este template tem link variável no botão “{botoesVariaveis[0].texto}”.
          A automação não preenche link de botão, e o envio vai falhar. Escolha
          um template sem essa parte variável.
        </Aviso>
      )}

      {formatoDeMidia && (
        <div className="space-y-2">
          <Label>
            {formatoDeMidia === "IMAGE"
              ? "Imagem do cabeçalho"
              : formatoDeMidia === "VIDEO"
                ? "Vídeo do cabeçalho"
                : "Documento do cabeçalho"}
          </Label>
          <Input
            value={midiaEscolhida ?? ""}
            onChange={(e) => gravar({ [campos.headerMediaUrl]: e.target.value })}
            placeholder="https://..."
          />
          <p className="text-xs text-muted-foreground">
            Já vem preenchido com o arquivo que a Meta aprovou junto do template.
            Troque só se quiser outro. Sem ele, a Meta recusa o envio.
          </p>
        </div>
      )}

      {escolhido && variaveis.length > 0 && (
        <div className="space-y-3">
          <div>
            <Label>Variáveis do template</Label>
            <p className="text-xs text-muted-foreground">
              O que cada posição do template recebe. Use as variáveis do lead ou
              escreva um texto fixo.
            </p>
          </div>
          {variaveis.map((token) => (
            <div key={token} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs font-mono">{`{{${token}}}`}</Label>
                <VariableInserter
                  onInsert={(v) => definirVariavel(token, `${mapa[token] ?? ""}${v}`)}
                />
              </div>
              <Input
                value={mapa[token] ?? ""}
                onChange={(e) => definirVariavel(token, e.target.value)}
                placeholder="{{nome}}"
                aria-label={`Valor de {{${token}}}`}
              />
            </div>
          ))}
        </div>
      )}

      {escolhido && variaveis.length === 0 && nomeEscolhido && (
        <p className="text-xs text-muted-foreground">
          Este template não tem variáveis — sai como foi aprovado.
        </p>
      )}

      {escolhido && nomeEscolhido && (
        <div className="space-y-1">
          <Label className="text-xs">Prévia</Label>
          <div className="p-3 rounded-lg bg-muted/50 border text-xs whitespace-pre-wrap">
            {previewDoTemplate(escolhido, mapa)}
          </div>
          <p className="text-xs text-muted-foreground">
            As variáveis do lead são resolvidas no envio, não aqui.
          </p>
        </div>
      )}
    </div>
  );
}
