/**
 * Escreve 3 colunas novas na Pagina 2 (aba GESTAO auto-report):
 *   Gestor | Saude Funil (prod 2026-06-23) | Questionamento p/ gestor
 * Casa por nome de cliente (coluna A da pag.2). Case/acento-insensivel.
 * Cobre as 35 orgs COM gestor na pag.1 (gestores: AUGUSTO, FABIO, GUGA, GUI, KAUA, TCHE).
 * Orgs sem gestor ficam em branco.
 *
 * COMO RODAR:
 * 1. Abrir a planilha > Extensoes > Apps Script.
 * 2. Colar este arquivo inteiro, salvar.
 * 3. Ajustar SHEET_NAME se a aba pag.2 nao se chamar "Pagina2".
 * 4. Rodar escreverGestao(). Autorizar no 1o run.
 *
 * Legenda funil: "stage:OPEN(Pp)" = etapa com OPEN cards abertos, P deles parados >7d.
 */

const SHEET_NAME = 'Página2'; // nome real da aba (pag.2 / GESTAO). Ajuste se diferente.

const DADOS = {
  // ===== AUGUSTO =====
  'basic 4u': ['AUGUSTO',
    'Copilot OFF. novo:570(568p), respondeu:161(160p!), abordado:146(146p), desqualificado:428(428p), sem_resposta:221(215p). Funil inteiro congelado.',
    'Copilot do Basic4u esta desligado com 160 leads que JA responderam parados +7d sem follow, 568 presos em novo e 428 desqualificados acumulando. Por que desligou? Religa hoje? Qual o plano pros 160 que responderam?'],
  'dra isabella': ['AUGUSTO',
    'Dormente: 1 lead em novo, 0 WhatsApp.',
    'Dra. Isabella esta dormente (1 lead, 0 WhatsApp) apesar de ticket alto (R$1.497). E reativar ou arquivar? Onde travou o briefing/onboarding?'],
  'realsc': ['AUGUSTO',
    'Macro saudavel, topo represado: novo:1756(1721p!), respondeu:185(162p), abordado:113(107p), cliente_que_nao_da_resposta:48(48p).',
    'RealSC parece saudavel no uso, mas tem 1.721 leads represados em novo ha +7d que nunca foram abordados. A automacao de abordagem cobre so parte da entrada? O que trava o topo do funil?'],

  // ===== FABIO =====
  'bagel licitacoes': ['FABIO',
    'WA mudo desde 02/06. abordado:113(60p), esfriou:27(26p), remarcar:11(11p), respondeu:11(11p).',
    'Bagel esta sem trafego no WhatsApp desde 02/06 com 113 leads em abordado parados e 173 leads/30d entrando. A instancia caiu ou a operacao parou? Quem esta pegando esses leads?'],

  // ===== GUGA =====
  'elvera': ['GUGA',
    'Marcado saudavel, mas novo:66(66p! todos parados), abordado:16(9p), respondeu:3(1p). Entrada nao escoa.',
    'Elvera esta marcada como saudavel, mas tem 66 leads em novo parados sem abordagem. A automacao cobre a entrada? Quem puxa esses 66 que nunca foram tocados?'],
  'coopeafamijf': ['GUGA',
    'Sem WA e sem IA (CRM manual). novo:713(704p, 625>14d!), abordado:58(58p), respondeu:34(34p).',
    'Coopeafamijf tem 713 leads parados em novo (625 ha +14d), sem WhatsApp e sem IA, rodando como CRM manual. O tier contratado inclui canal/automacao ou e CRM puro? Se inclui, falta provisionar WhatsApp.'],
  'all mix': ['GUGA',
    'Saudavel: 26 abertos, 0 parados. pre_qualificar:15, ligacao_whatsapp:8. Tudo fresco.',
    'All Mix esta saudavel (nada parado, 7 workflows ativos). Confirma que os 15 em pre_qualificar avancam pra proxima etapa ou empilham nessa fila?'],
  'brasil engrenagens': ['GUGA',
    'Copilot ativo, mas esfriou:105(100p! alta taxa de esfriamento), novo:53(29p), respondeu:16(16p), abordado:11(11p).',
    'Brasil Engrenagens vai bem no uso, mas tem 105 leads em esfriou (100 parados) - taxa de esfriamento alta. Tem reativacao rodando ou virou cemiterio? E os 16 que responderam estao parados sem follow.'],
  'london': ['GUGA',
    'Saudavel. abordado:61(41p), respondeu:53(27p), esfriou:22(6p).',
    'London vai bem, mas 27 dos 53 leads que responderam estao parados +7d sem follow. O closer esta pegando os respondeu? Tem cadencia definida pos-resposta?'],
  'agape': ['GUGA',
    'Sem WA e sem IA, mas abordado:234(226p!), esfriou:45(45p), respondeu:20(20p). Abordagem manual travou.',
    'Agape tem 234 leads em abordado parados (226 +7d) mas SEM canal WhatsApp e sem IA - abordagem manual empacou. O tier inclui automacao? Quem da sequencia nesses 234?'],
  'labarr': ['GUGA',
    'Copilot OFF (12k msgs WA/30d na mao). abordado:44(40p), respondeu:19(12p), em_planejamento:14(3p).',
    'Labarr esta com copilot desligado atendendo 12k msgs WA/30d na mao. 44 em abordado e 12 dos 19 que responderam parados. Religa o copilot? Quem segura esse volume manual?'],
  'bertin distribuidora': ['GUGA',
    'Saudavel no uso, mas em_andamento:236(234p! andamento que nao anda), desqualificado_perdido:138(138p), novo:42(0p).',
    'Bertin esta saudavel, mas 236 leads em em_andamento estao parados +7d - etapa estagnada. Sao negocios reais travados ou a etapa virou deposito? Precisa avanco/limpeza.'],
  'itatex': ['GUGA',
    'Saudavel, mas novo:147(144p), em_andamento:50(50p! todos parados), respondeu:59(17p), abordado:43(20p).',
    'Itatex vai bem, mas 147 em novo parados e 50 em em_andamento estagnados. O topo nao escoa - automacao cobre os 147? E os 50 em andamento estao vivos ou mortos?'],
  'mapila alimentos': ['GUGA',
    'WA desconectado desde 16/06. abordado:213(148p), novo:198(198p!), respondeu:69(67p), em_andamento:32(32p).',
    'Mapila esta com WhatsApp desconectado desde 16/06 e 198 em novo + 213 em abordado parados, 67 dos 69 que responderam sem follow. Reconecta o WA? Quem recupera esse backlog?'],
  'natu flores': ['GUGA',
    'Org vazia: 0 leads, 0 WhatsApp, 3 workflows criados nunca ligados.',
    'Natu Flores esta 100% vazia (0 leads, 0 WhatsApp) com 3 workflows criados mas nunca ligados. Vai ativar ou arquivar? O que falta pro go-live?'],
  'dadupack': ['GUGA',
    'Org vazia: 0 leads, 0 atividade, 3 workflows criados nunca ligados.',
    'Dadupack esta 100% vazia (0 leads, 0 atividade), workflows criados mas nunca ligados. Vai ativar ou arquivar? O que falta?'],
  'albieri': ['GUGA',
    'Dormente: 1 lead, sem WhatsApp.',
    'Albieri esta dormente (1 lead, sem WhatsApp). Reativar ou arquivar? Onde parou o onboarding?'],

  // ===== GUI =====
  'sc beauty': ['GUI',
    'Saudavel, mas follow_up_3:67(67p! cadencia congelou no passo 3), sem_resposta:57(56p), nutricao_infinita:38(33p).',
    'SC Beauty esta saudavel, mas 67 leads travados em follow_up_3 (todos parados) - a cadencia de follow congelou no passo 3. O workflow de follow parou de avancar? E 56 em sem_resposta pra reativar.'],
  'jakhro alimentos': ['GUI',
    'GAP CRITICO: WhatsApp nunca conectado. novo:175(75p). 167 leads/30d sem atendimento.',
    'Jakhro tem 175 leads em novo (75 parados) mas WhatsApp NUNCA foi conectado - copilot configurado sem canal. Provisiona a instancia WA? 167 leads/30d sem ninguem atender.'],
  'grafica cauta': ['GUI',
    'Saudavel no WA, mas novo:206(202p! nunca abordados), abordado:53(0p), pendente_de_info:11(0p).',
    'Grafica Cauta vai bem no WhatsApp, mas 206 leads em novo parados (202 +7d) nunca abordados. A automacao cobre so parte? Quem puxa os 206?'],
  'zaplub': ['GUI',
    'Dormente: 625 leads historicos, WA mudo desde 09/04. disparo_02:1(1p).',
    'Zaplub esta dormente (625 leads historicos, WhatsApp mudo desde 09/04). Reativar a base de 625 ou arquivar? Da pra rodar campanha de reativacao neles.'],

  // ===== KAUA =====
  'barulhinho bom': ['KAUA',
    'Copilot ativo, mas proposta_enviada:35(23p! dinheiro parado), esfriou:57(49p), marcar_compromisso:19(8p).',
    'Barulhinho Bom esta saudavel, mas 23 propostas enviadas paradas +7d sem retorno e 57 esfriaram. O follow de proposta esta rodando? Esses 23 sao dinheiro na mesa parado.'],
  'promove consorcios': ['KAUA',
    'Saudavel, automacao girando: nutricao_infinita:101(0p), disparo_automatico:49(0p), esfriou:37(14p), atendimento_humano:29(4p).',
    'Promove vai bem (automacao girando, pouco parado). 101 leads em nutricao_infinita - confirma que estao sendo reciclados pra venda ou viraram deposito eterno?'],
  'cervejaria insana': ['KAUA',
    'WA forte (16k msgs/30d), funil pequeno. respondeu:21(14p), abordado:7(0p), criando_proposta:4(0p).',
    'Cervejaria Insana tem WhatsApp forte (16k msgs/30d) mas funil pequeno e 14 dos 21 que responderam parados +7d. As conversas viram card no funil? Quem pega os respondeu?'],
  'saco ecomulti': ['KAUA',
    'Copilot ativo, mas novo:333(329p! maior represa do KAUA), respondeu:60(22p), esfriou:49(26p), abordado:41(27p).',
    'Saco Ecomulti esta saudavel, mas 333 leads em novo parados (329 +7d) - maior represa de entrada do seu grupo. O copilot ativo nao puxa os novo? 473 leads/30d entrando sem escoar.'],
  'glowhair': ['KAUA',
    'Org vazia: 0 leads, 0 atividade, nao implementado.',
    'Glowhair esta 100% vazia (0 leads, nao implementado). Vai implementar ou arquivar?'],
  'bennedita pan': ['KAUA',
    'WA desconectado desde 22/06. abordado:314(101p), proposta_enviada:1(1p), marcar_compromisso:1(1p).',
    'Bennedita Pan esta com WhatsApp desconectado desde 22/06 e 314 leads em abordado (101 parados). Reconecta o WA? Copilot ativo sem canal nao atende ninguem.'],
  'happyneis': ['KAUA',
    'WA ativo (7k msgs/30d). proposta_enviada:13(7p), respondeu:10(5p), marcar_compromisso:6(3p).',
    'Happyneis esta ativa, mas 7 propostas enviadas paradas +7d e 6 em marcar_compromisso sem agendar. O follow de proposta/agendamento esta rodando?'],
  'distetica': ['KAUA',
    'Copilot ativo, mas novo:90(87p! nunca abordados), abordado:12(9p), esfriou:5(2p).',
    'Distetica esta saudavel, mas 90 leads em novo parados (87 +7d) nunca abordados. O copilot ativo cobre a entrada? Quem puxa os 90?'],
  'sorvfoods': ['KAUA',
    'Org vazia: 0 leads, 3 workflows criados nunca ligados.',
    'Sorvfoods esta 100% vazia, workflows criados mas nunca ligados. Vai ativar ou arquivar?'],
  'castropil': ['KAUA',
    'Saudavel: 74 abertos, 0 parados. coletando_informacoes:31, respondeu_disparo:19, abordado:19. Tudo fresco.',
    'Castropil esta saudavel (nada parado). 31 leads em coletando_informacoes - confirma que avancam pra abordagem ou empacam na coleta?'],

  // ===== TCHE =====
  'forte sistemas': ['TCHE',
    'Quase sem uso (10 leads, 0 automacao, campanha pausada). esfriou:3(2p), respondeu:1(0p).',
    'Forte Sistemas esta quase sem uso (10 leads, 0 automacao, campanha pausada). Vai alimentar leads + ligar automacao ou segue parado? O que destrava?'],
  'dna de almas': ['TCHE',
    'Sem WA e sem IA, mas 16 workflows rodando. novo_lead:165(0p), novo:14(0p). Funil enche, ninguem atende.',
    'Dna de Almas tem 165 leads novos entrando e 16 workflows rodando, mas SEM WhatsApp e sem IA. Provisiona o canal? O funil enche mas nao atende ninguem.'],
  'hge iluminacao': ['TCHE',
    'Org vazia: 0 leads, 5 workflows criados nunca ligados.',
    'HGE Iluminacao esta 100% vazia, 5 workflows criados mas nunca ligados. Vai ativar ou arquivar?'],
  'troovebr': ['TCHE',
    'Saudavel (onboard 11/06). pre_qualificar:8(4p), agendado:4(4p), novo_lead:3(0p), respondeu:3(2p).',
    'TrooveBR (onboard 11/06) indo bem. 4 leads em agendado estao parados +7d - as reunioes aconteceram e ninguem moveu o card, ou cairam? Confirma o processo pos-agendamento.'],

  // ===== SEM GESTOR (pag.1 em branco) =====
  'natuplast': ['(SEM GESTOR)',
    'GAP CRITICO: copilot ativo mas WhatsApp nunca conectado. importado:139(0p), novo:139(0p). 139 leads/30d sem atendimento.',
    'Natuplast tem 139 leads e copilot ativo, mas WhatsApp NUNCA conectado (0 msgs) - 139 leads/30d sem atendimento, e nao tem gestor atribuido. Provisiona/reconecta a instancia WA? Quem assume?'],
  'honey cake': ['(SEM GESTOR)',
    'Org vazia: 0 leads, 4 workflows criados nunca ligados.',
    'Honey Cake esta 100% vazia (0 leads), 4 workflows criados mas nunca ligados e sem gestor. Vai ativar, arquivar ou definir dono?'],
  'jc atacado': ['(SEM GESTOR)',
    'Org vazia: 0 leads, 2 workflows criados nunca ligados.',
    'JC Atacado esta 100% vazia (0 leads), 2 workflows criados nunca ligados e sem gestor. Ativar, arquivar ou atribuir dono?'],
  'motor 100': ['(SEM GESTOR)',
    'Trial CRM: novo:401(0p), 100% ainda em novo, nada avancou.',
    'Motor 100 (trial CRM) recebeu ~401 leads e 100% seguem em novo - nada avancou e nao tem gestor. Quem assume? Sem alguem puxando qualificacao/abordagem o trial morre na entrada.'],
  'villa branca': ['(SEM GESTOR)',
    'Nao provisionada: sem org no Torque.',
    'Villa Branca esta na planilha mas NAO tem org no Torque (nunca provisionada) e sem gestor. Provisiona a org ou remove da lista? Quem assume?'],
  'autotek': ['(SEM GESTOR)',
    'Nao provisionada: sem org no Torque.',
    'Autotek esta na planilha mas NAO tem org no Torque (nunca provisionada) e sem gestor. Provisiona ou remove da lista? Quem assume?'],
  'chique distribuidora': ['(SEM GESTOR)',
    'Org vazia: 0 leads, 3 workflows criados nunca ligados.',
    'Chique Distribuidora esta 100% vazia (0 leads), 3 workflows criados nunca ligados e sem gestor. Ativar, arquivar ou atribuir dono?'],
  'ventimais': ['(SEM GESTOR)',
    'Org vazia: 0 leads, 3 workflows ativos rodando sem dados.',
    'Ventimais esta vazia (0 leads) com 3 workflows ativos rodando sem nada pra processar e sem gestor. Falta provisionar canal/alimentar leads? Quem assume?'],
};

function norm_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acento
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function escreverGestao() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    const nomes = ss.getSheets().map(function (s) { return s.getName(); }).join(' | ');
    SpreadsheetApp.getUi().alert('Aba "' + SHEET_NAME + '" nao encontrada.\nAbas existentes: ' + nomes + '\nAjuste SHEET_NAME pro nome certo.');
    return;
  }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  const headerRow = 1;
  const c0 = lastCol + 1;

  sh.getRange(headerRow, c0, 1, 3).setValues([['Gestor', 'Saude Funil (prod 23/06)', 'Questionamento p/ gestor']]);

  const clientes = sh.getRange(headerRow + 1, 1, lastRow - headerRow, 1).getValues();
  const keys = Object.keys(DADOS);
  const out = [];
  let casados = 0;
  for (let i = 0; i < clientes.length; i++) {
    const key = norm_(clientes[i][0]);
    let hit = DADOS[key];
    if (!hit && key) {
      for (let j = 0; j < keys.length; j++) {
        const k = keys[j];
        if (key === k || key.indexOf(k) >= 0 || k.indexOf(key) >= 0) { hit = DADOS[k]; break; }
      }
    }
    if (hit) { out.push(hit); casados++; }
    else { out.push(['', '', '']); }
  }
  sh.getRange(headerRow + 1, c0, out.length, 3).setValues(out);
  SpreadsheetApp.getUi().alert('Pronto. ' + casados + ' orgs com gestor preenchidas de ' + out.length + ' linhas.');
}
