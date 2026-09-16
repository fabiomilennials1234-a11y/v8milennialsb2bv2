# Isolamento dos avisos de WhatsApp por número

## Diagnóstico

Na Café Jurerê, a consulta de notificações por destinatário reproduziu avisos
endereçados a Tatiane a partir do número da Fran e a Francielle a partir do número
da Fernanda. `fn_aviso_de_mensagem` escolhia `fn_dono_do_lead`, sem olhar a instância.
A chave `msg:<lead>` também agrupava mensagens de números distintos.

O chat já possuía políticas restritivas para mensagens/resumos e RPCs, mas o
resolvedor de instâncias permitia qualquer número sem vínculos. `notifications`
protegia o destinatário, porém não a origem do conteúdo copiado pelo trigger.

## Regra

- Membro lê apenas números explicitamente vinculados ao seu team member ativo.
- Admin/master mantêm acesso de gestão; não recebem broadcast de mensagens.
- Avisos de mensagens são destinados aos usuários ativos vinculados ao número,
  desde que também passem pela regra de responsável. Sem restrição por responsável,
  conversas sem lead continuam recebendo avisos.
- Um cliente em dois números gera avisos independentes por organização/número/telefone.
- O gate do proxy de WhatsApp verifica a instância antes de resolver lead/telefone,
  incluindo ações de mídia e histórico.
- Produtor, RLS do sino e consulta de push verificam o vínculo e o acesso ao lead atuais. Revogação impede novas leituras.
- Avisos antigos de mensagem sem instância comprovada permanecem armazenados,
  mas deixam de ser expostos aos destinatários e à fila de push. Não há backfill:
  uma linha antiga pode conter eventos de vários números.
- Grupos, mensagens enviadas, IA e importação de histórico não geram avisos.
- Agenda, suporte e demais avisos pessoais mantêm suas regras.

## Validação e publicação

O teste SQL executa o trigger original, reproduz o destinatário incorreto, aplica
a migration e verifica produtor, agrupamento, RLS e push. Inclui dois membros da
mesma org, outra org, admin, master, ausência/revogação de vínculo e membro inativo.
Não envia mensagens e não cria dados de cliente em produção.

Aplicar explicitamente `20271021000013_isolate_whatsapp_notifications.sql` antes
do frontend. Não executar `db push` amplo: o ledger contém migrations com datas
futuras. As funções existentes de histórico e leitura continuam usando o mesmo
resolvedor de instâncias. Não há edge function nova para publicar.

Após publicação, atualizar as abas já abertas para descartar prévias recebidas
antes da correção. Dados já entregues ao navegador não podem ser recolhidos pelo banco.

Fernanda está cadastrada como admin e possui vínculos com vários números. Esta
correção não altera papéis nem vínculos existentes da equipe.

O advisor de segurança de produção foi consultado como baseline. O produtor de
mensagens possuía execução por anon/authenticated; a migration revoga essa
permissão, mantendo execução pelo trigger. Os helpers de leitura ficam no schema privado e derivam o usuário de auth.uid().
O helper de destinatário é acessível somente por outros definers (sem grant aos clientes).

## Correções da revisão do PR #2125

A migration ficou após as definições de 2027: o nome anterior executava antes de
criar o schema private e suas funções eram sobrescritas por migrations seguintes.
O teste usa o predicado real de responsável (sem stub permissivo), exercita a
ativação da restrição, override explícito, revogação e conteúdo agregado do Copilot.

Conversations são agregadas por lead/agente e não têm proveniência por número.
O transcript agregado fica restrito a admin/master; membros recebem o histórico
original de whatsapp_messages, já filtrado por número. As colunas context,
short_term_memory e long_term_memory não são legíveis por clientes autenticados;
o backend service_role continua usando essas memórias. Dados operacionais
(estado, pausa, takeover, contagem) continuam acessíveis quando há histórico do
lead em número autorizado e o gate de responsável permite. A listagem do histórico
e as contagens agora selecionam colunas explícitas, preservando esses controles.

O predicado de responsável foi extraído sem mudar suas regras para um helper
privado sem EXECUTE para clientes ou service_role. Produtor/push usam esse helper
por dentro de seus definers; o predicado público continua derivando auth.uid().

Resumos por instância e o gate usado pelo Oráculo/summarize-conversation também
exigem vínculo explícito: remover o último vínculo não abre o número. O contexto
agregado sem instância fica restrito a admin/master, como o transcript agregado.
Os testes exercitam push e Oráculo sob SET ROLE service_role.
