# Cadastro ERP no cartão do lead — Café Jurerê

A aba Dados do cartão lê o cadastro Toth de `upsell_clients`, pelo vínculo
`lead_id` e pela organização autenticada. Usa a flag existente
`leads_cafe_jurere_cadastro_erp`, exclusivamente na Café Jurerê, e só consulta
clientes com código ERP e elegibilidade na lista. Outras organizações e leads
nativos mantêm o cartão atual.

CPF/CNPJ, site, nascimento e endereço deixam de ser placeholders. Os grupos
Cadastro no ERP, Dados fiscais do ERP e Dados pessoais do ERP mostram os
campos cadastrais permitidos. São somente leitura; alteração deve ocorrer no
Toth. Data de cadastro não é data de nascimento/fundação. Campos vazios no ERP
continuam vazios, sem recuperar valores antigos de outra coluna.

`erp_metadata.cadastro` contém um snapshot com allowlist de campos escalares,
incluindo nulos. Não guarda payload arbitrário, tokens ou credenciais.
A sincronização normal mantém o snapshot para clientes elegíveis do piloto.

## Preenchimento inicial

Chamar `toth-sync-clientes` com autenticação administrativa existente:
`{ "cadastro_visivel_only": true, "dry_run": true }` para conferir volumes;
depois `dry_run: false`. No caminho do cron, o corpo também recebe a organização
e o header secreto existente autentica a execução.

Este modo exige a organização Café Jurerê e sua flag de recorte. Seleciona
somente clientes Toth vinculados a leads visíveis e não excluídos. Atualiza
apenas `erp_metadata`, sem criar clientes/leads nem mudar dono, situação,
classificação ou negócios. Compara o metadata anterior antes de escrever para
não sobrescrever uma sincronização concorrente. Retomada é idempotente.

O resultado informa visíveis, recebidos, planejados, atualizados, já iguais e
ausentes no ERP. Ausentes não são apagados. Códigos duplicados na resposta
interrompem antes de qualquer escrita. Logs contêm apenas contagens.

Validação: testes de mapping, escopo e idempotência; consulta com tenant e
vínculo; flag desligada inclusive com cache; erro de rede sem loading infinito.
Nenhuma migration ou ampliação de permissões é necessária.

## Execução em 10/09/2026

Produção: 12.748 registros recebidos do ERP; 2.263 clientes visíveis selecionados,
2.263 atualizados, nenhum ausente. Segunda prévia: zero alterações pendentes,
2.263 snapshots já iguais. Consulta independente confirmou 2.263 snapshots,
2.263 documentos, 2.263 e-mails NF-e, 2.144 cidades e 2.145 logradouros preenchidos.
Ausência de cidade/logradouro reflete o cadastro do ERP.

Leitura sob papel `authenticated` com identidade de membro da Café Jurerê:
2.263 snapshots acessíveis e zero registros de outras organizações.
68 testes passaram; build e lint sem regressões. Preview desktop/mobile validado
com dados fictícios, sem overflow horizontal. O ratchet de tipos ainda aponta
TS2352 em `WaitBusinessWindowNode.test.tsx`, arquivo inalterado em relação à
`origin/main` (commit anterior `5f9221eb`); não há erro nos arquivos desta entrega.
