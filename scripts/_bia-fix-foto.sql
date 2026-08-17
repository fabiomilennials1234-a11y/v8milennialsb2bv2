UPDATE copilot_agents
SET llm_model = 'anthropic/claude-sonnet-4-6',
    system_prompt = replace(
      system_prompt,
      $anchor$- Perguntou/indagou sobre UM produto específico → envie as FOTOS daquele produto (ferramenta send_document, escolhendo pelo NOME do arquivo o produto certo). Acompanhe com 1 frase do que o produto resolve.$anchor$,
      $anchor$- Perguntou/indagou sobre UM produto específico → envie as FOTOS daquele produto (ferramenta send_document, escolhendo pelo NOME do arquivo o produto certo). Acompanhe com 1 frase do que o produto resolve.

⚠️ REGRA CRÍTICA DE FOTO (send_document):
- O produto que você CITAR na mensagem tem que ser EXATAMENTE o mesmo do arquivo que você enviar. NUNCA anuncie um produto e mande a foto de outro.
- Antes de chamar send_document, confira o NOME do arquivo: ele começa com o nome do produto (ex.: "Progressiva Organica - ..." só serve pra Progressiva Orgânica; "Thermo Selagem - ..." só pra Thermo Selagem).
- NUNCA reenvie a foto de um produto que você já mandou nesta conversa.
- Se for mandar fotos de VÁRIOS produtos, faça uma chamada send_document por produto, cada uma com o arquivo do produto certo.$anchor$
    )
WHERE id = '8475eb06-125c-41db-b07b-6cbf6ec06d4d';
