# Publicação das correções de suporte — 05/10/2026

**Estado:** base da implementação no commit `1633bd40f`, com testes específicos e build dual aprovados. Validar também os ajustes posteriores antes de publicar o commit final. Nenhuma migration ou publicação deste pacote foi aplicada em produção. Executar somente após pedido explícito do CTO. Os ajustes de aliases importam os mesmos módulos, sem mudança funcional.

A migration de filtros foi renumerada de `20271106000020` para `20271108000000` durante a integração: a versão antiga não havia sido aplicada e colidia com `corrigir_venda_ganha` da main. A nova versão sucede o teto verificado `20271107170000`. A migration `20271106000030` permanece independente.

## Publicação autorizada

1. Registrar a autorização, o commit final, o digest da imagem anterior e o da nova imagem. Conferir o histórico de migrations do ambiente e salvar as definições atuais dos quatro policies de `saved_views`, default de `owner_id`, função `stamp_support_ticket_first_response()` e sua ACL. Se divergirem do estado descrito abaixo, revisar o rollback antes de aplicar.
2. Aplicar **somente** `20271108000000_saved_views_owner_multi_org.sql` antes do front. O default `auth.uid()` também atende clientes antigos que omitem o dono. Não incluir migrations pendentes fora deste pacote por meio de um push geral.
3. Aplicar `20271106000030_support_first_response_origin.sql` quando autorizado; é independente do front e da migration de filtros salvos. Não recalcular datas históricas.
4. Publicar o artefato dual: V5, clássica e assets das duas versões. Preservar `classic/SNAPSHOT.json.ref = f9a29504b79a4ccd7fba5914c704601f547eba24` e o patch regenerado. Não alterar flags de organizações nem a seleção por cookie.
5. Executar a validação abaixo nas duas interfaces, com contas e registros de teste autorizados. Registrar resultado, horário e versão. Responder aos clientes sobre disponibilidade somente depois dessa validação; implementação local não significa correção publicada.

## Validação após publicação

- **Filtros salvos:** usuário participante de duas organizações cria, lê, altera e exclui filtro próprio em cada uma; trocar de organização/usuário não reaproveita cache alheio. Cliente antigo cria sem `owner_id` e recebe o dono autenticado. Outro usuário da mesma organização lê somente o compartilhado e não altera/exclui o filtro alheio; usuário externo às duas organizações não lê nem escreve. Tentar forjar dono deve falhar. Filtro de sistema não pode ser excluído. Executar as negativas com JWT de usuário, nunca com `service_role` ou master.
- **Primeira resposta:** comentário público com `from_staff=true` e autor master preenche apenas o chamado correspondente, uma única vez. Nota interna, comentário do cliente mesmo quando o autor é master e tentativa de marcar staff por usuário não master não preenchem o indicador. A ACL da função permanece restrita a `postgres` e `service_role`.
- **Anexos:** enviar PDF/imagem de teste; confirmar uma mensagem e um anexo acessível. Simular 401/403, leitura abortada, timeout de upload e assinatura tardia em ambiente de teste/interceptação local: há saída do carregamento, mensagem acionável e anexo preservado; upload incompleto não chama o provider. Corrigir rejeição confirmada permite nova tentativa. Timeout ambíguo verifica confirmação sem repetir upload/POST. A proteção é transitória e não persiste após reload completo; a causa original do incidente não foi comprovada.
- **Proposta:** abrir edição em duas sessões; salvar na primeira e depois na segunda. Conflito exige carregar a versão atual antes de reabrir a edição. Simular falha nessa recarga: edição permanece bloqueada, com ação explícita para recarregar; somente a versão atual libera uma nova tentativa, sem sobrescrever silenciosamente.
- **Checklist:** abrir e marcar item no popover sem abrir a ficha por propagação do clique.
- **Banner:** sessão de outro responsável não aparece; dono ou membro autorizado recebe o aviso; somente sessão sem dono/membros usa fallback admin/master. Trocar de usuário na mesma organização atualiza a audiência.
- **Entrega dual:** confirmar carregamento dos assets e do service worker de cada interface, sem 404, e ausência de novos erros nas etapas de leitura/upload. Não registrar nome de arquivo, telefone, URL assinada ou token na evidência.

## Rollback

Reverter o front publicando a **imagem dual anterior pelo digest registrado**, sem alterar flags. As duas migrations são compatíveis com o front anterior e podem permanecer; reverter banco somente se necessário e autorizado. Não apagar nem editar migrations já aplicadas ou linhas do histórico. Criar **novas migrations de rollback**, registrar revisão/aplicação e executar cada bloco abaixo como uma transação. Não restaurar dados, filtros ou datas de resposta.

### Reverter a migration 20271108000000

Estado anterior verificado: `owner_id` sem default; os quatro policies eram permissivos para `PUBLIC`, com organização única via `get_user_organization_id()`. UPDATE não tinha `WITH CHECK` explícito. `master_select_all_saved_views` permanece intacta. O rollback volta a limitar filtros à organização única e remove a compatibilidade do default para clientes antigos.

```sql
BEGIN;

ALTER TABLE public.saved_views ALTER COLUMN owner_id DROP DEFAULT;

DROP POLICY saved_views_select ON public.saved_views;
CREATE POLICY saved_views_select ON public.saved_views
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (
    organization_id = (SELECT public.get_user_organization_id())
    AND (owner_id = (SELECT auth.uid()) OR is_shared = true)
  );

DROP POLICY saved_views_insert ON public.saved_views;
CREATE POLICY saved_views_insert ON public.saved_views
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (
    organization_id = (SELECT public.get_user_organization_id())
    AND owner_id = (SELECT auth.uid())
  );

DROP POLICY saved_views_update ON public.saved_views;
CREATE POLICY saved_views_update ON public.saved_views
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (
    organization_id = (SELECT public.get_user_organization_id())
    AND owner_id = (SELECT auth.uid())
  );

DROP POLICY saved_views_delete ON public.saved_views;
CREATE POLICY saved_views_delete ON public.saved_views
  AS PERMISSIVE FOR DELETE TO PUBLIC
  USING (
    organization_id = (SELECT public.get_user_organization_id())
    AND owner_id = (SELECT auth.uid())
    AND is_system = false
  );

COMMIT;
```

### Reverter a migration 30

Restaurar apenas o corpo anterior, mantendo trigger e proprietário `postgres`. A ACL anterior é `postgres=X/postgres,service_role=X/postgres`; `CREATE OR REPLACE` preserva os grants e as instruções finais reafirmam esse acesso. Este rollback volta a contar comentário público de master mesmo quando `from_staff=false`; não desfaz timestamps já gravados.

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.stamp_support_ticket_first_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_master_user(NEW.author_user_id) THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('torque.support_clock', 'on', true);
  UPDATE public.support_tickets
  SET first_response_at = NEW.created_at
  WHERE id = NEW.ticket_id
    AND first_response_at IS NULL;
  PERFORM set_config('torque.support_clock', 'off', true);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_support_ticket_first_response()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_support_ticket_first_response()
  TO postgres, service_role;

COMMIT;
```

Após qualquer rollback, conferir definições/ACL contra o snapshot anterior, testar isolamento entre organizações e confirmar as duas interfaces da imagem restaurada. Registrar quais correções deixaram de estar disponíveis antes de atualizar o atendimento.
