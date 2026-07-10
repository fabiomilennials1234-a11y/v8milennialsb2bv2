-- ============================================================
-- Chamado: anexos, num bucket privado.
--
-- O anexo típico é uma captura da tela do CRM. Nela aparecem nome, telefone,
-- empresa e CNPJ dos **leads do nosso cliente** — dado dos clientes dele, do
-- qual somos operadores de LGPD.
--
-- Por isso o bucket é privado, e a leitura sai por URL assinada de vida curta,
-- autorizada no servidor. O bucket `help-media` é público: um link eterno e
-- irrevogável, que o Google indexa. Não se reusa um bucket público por
-- conveniência (ADR-0018, decisão 9).
--
-- A autorização se apoia no caminho: `<ticketId>/<uuid>.<ext>`. O primeiro
-- segmento é o Chamado, e `can_read_support_ticket()` já sabe dizer quem pode
-- lê-lo — autor, admin da Organização, master. É a mesma função que a policy de
-- `support_ticket_comments` usa, e ela é SECURITY DEFINER justamente para não
-- recursionar em `apply_rls()`.
--
-- Esconder um botão no React não protege arquivo nenhum: quem souber o caminho,
-- baixa. A regra mora aqui.
--
-- Verificado em produção por sonda em transação revertida: o bucket é privado; a
-- função devolve `false` para lixo, travessia de diretório, caminho vazio e
-- objeto de outro bucket, sem levantar; a policy foi avaliada como `authenticated`
-- sobre os 168.296 objetos dos outros buckets sem quebrar nenhum; o autor lê o
-- próprio anexo, o master lê, um usuário de outra Organização não lê, e ninguém
-- lê o anexo de um chamado inexistente.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  false,                       -- privado. Nunca mude isto.
  5242880,                     -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- O cast do caminho para uuid mora numa função que devolve `false` em vez de
-- levantar exceção.
--
-- Uma policy é avaliada para toda linha de `storage.objects` que o planner
-- decidir olhar, e a ordem entre `bucket_id = '…'` e o resto do predicado não é
-- garantida. Um `((storage.foldername(name))[1])::uuid` inline explodiria ao
-- topar com um objeto de outro bucket cuja primeira pasta não é um uuid — e
-- levaria junto a listagem daquele bucket.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_support_attachment(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ticket_id UUID;
BEGIN
  BEGIN
    ticket_id := split_part(object_name, '/', 1)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN public.can_read_support_ticket(ticket_id);
END;
$$;

COMMENT ON FUNCTION public.can_read_support_attachment(TEXT) IS
  'Autoriza um objeto de support-attachments pelo primeiro segmento do caminho (o id do Chamado). Devolve false, nunca levanta, para nao quebrar a listagem de outros buckets.';

REVOKE ALL ON FUNCTION public.can_read_support_attachment(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_support_attachment(TEXT) TO authenticated;

-- ------------------------------------------------------------
-- Policies
-- ------------------------------------------------------------

DROP POLICY IF EXISTS support_attachments_select ON storage.objects;
CREATE POLICY support_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.can_read_support_attachment(name)
  );

-- Quem pode ler o Chamado pode anexar a ele. Um membro de outra Organização não
-- alcança nem o SELECT, então também não escreve.
DROP POLICY IF EXISTS support_attachments_insert ON storage.objects;
CREATE POLICY support_attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND public.can_read_support_attachment(name)
  );

-- Anexo não se edita: trocar o conteúdo de um arquivo já enviado apagaria a
-- evidência que ele é. Sem policy de UPDATE, ninguém atualiza.
DROP POLICY IF EXISTS support_attachments_update ON storage.objects;

-- Só o master apaga — o mesmo que vale para o Chamado.
DROP POLICY IF EXISTS support_attachments_delete ON storage.objects;
CREATE POLICY support_attachments_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.is_master_user()
  );
