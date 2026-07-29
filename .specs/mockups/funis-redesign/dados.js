// ─────────────────────────────────────────────────────────────
// Dados fictícios do protótipo. Nada aqui toca o Torque real.
// Nomes de etapa vindos de src/contracts/pipe/pipe-defaults.ts.
// ─────────────────────────────────────────────────────────────

export const FUNIS = [
  { id: 'qualificacao',  nome: 'Qualificação',     cor: '#3b82f6', tipo: 'sistema',  qtd: 248 },
  { id: 'confirmacao',   nome: 'Confirmação',      cor: '#8b5cf6', tipo: 'sistema',  qtd: 37  },
  { id: 'propostas',     nome: 'Propostas',        cor: '#f97316', tipo: 'sistema',  qtd: 64  },
  { id: 'giro',          nome: 'Giro de carteira', cor: '#22c55e', tipo: 'custom',   qtd: 112 },
  { id: 'prospeccao',    nome: 'Prospecção fria',  cor: '#ec4899', tipo: 'custom',   qtd: 89  },
  { id: 'reativacao',    nome: 'Reativação Q3',    cor: '#a855f7', tipo: 'prazo',    qtd: 41  },
];

export const ETAPAS = [
  { nome: 'Novo',       cor: '#6366f1', n: 34 },
  { nome: 'Abordado',   cor: '#f59e0b', n: 61 },
  { nome: 'Respondeu',  cor: '#3b82f6', n: 48 },
  { nome: 'Agendado ✓', cor: '#22c55e', n: 22 },
  { nome: 'Remarcar',   cor: '#f97316', n: 9  },
  { nome: 'Esfriou',    cor: '#ef4444', n: 74 },
];

export const ORIGEM = {
  'Meta Ads':   { fg: '#3da8f5', bg: 'rgba(61,168,245,.12)' },
  'Indicação':  { fg: '#22c35d', bg: 'rgba(34,195,93,.12)'  },
  'Site':       { fg: '#ffc800', bg: 'rgba(255,200,0,.12)'  },
  'Lista fria': { fg: '#979187', bg: 'rgba(151,145,135,.14)' },
};

// Tags têm nome — sem isso não dá pra filtrar por elas, só ver a cor.
export const TAGS = [
  { id: 't1', nome: 'Ouro',        cor: '#ffc800' },
  { id: 't2', nome: 'Urgente',     cor: '#ef4444' },
  { id: 't3', nome: 'Recompra',    cor: '#22c55e' },
  { id: 't4', nome: 'Frota',       cor: '#8b5cf6' },
  { id: 't5', nome: 'Inbound',     cor: '#3b82f6' },
  { id: 't6', nome: 'Sem retorno', cor: '#979187' },
  { id: 't7', nome: 'Remarcado',   cor: '#f97316' },
];

export const EQUIPE = [
  { ini: 'BR', nome: 'Bruna Ricci',  papel: 'Pré-venda' },
  { ini: 'LA', nome: 'Lane Aguiar',  papel: 'Pré-venda' },
  { ini: 'MT', nome: 'Mateus Tolen', papel: 'Venda' },
];

export const FAIXAS_CALOR = [
  { id: 'ardente', nome: 'Ardente (9–10)', min: 9,  max: 10 },
  { id: 'quente',  nome: 'Quente (7–8)',   min: 7,  max: 8  },
  { id: 'morno',   nome: 'Morno (4–6)',    min: 4,  max: 6  },
  { id: 'frio',    nome: 'Frio (1–3)',     min: 1,  max: 3  },
];

// "Hoje" do protótipo. Fixo de propósito: os leads têm data de criação
// escrita à mão logo abaixo, e usar a data real do computador faria os
// atalhos de período ("7 dias", "Este mês") deixarem de casar com os dados
// no dia seguinte.
export const HOJE = '2026-07-29';

// Tempo parado na etapa. Faixas em vez de um campo "mais de N dias" porque
// o painel de filtros inteiro é multi-seleção — assim compõe com o resto.
export const FAIXAS_PARADO = [
  { id: 'ate2',    nome: 'Até 2 dias',      min: 0,  max: 2        },
  { id: 'ate7',    nome: '3 a 7 dias',      min: 3,  max: 7        },
  { id: 'ate14',   nome: '8 a 14 dias',     min: 8,  max: 14       },
  { id: 'ate30',   nome: '15 a 30 dias',    min: 15, max: 30       },
  { id: 'mais30',  nome: 'Mais de 30 dias', min: 31, max: Infinity },
];

// Visualizações salvas de exemplo. Uma view guarda a combinação inteira de
// filtros — inclusive período e tempo parado.
const semFiltro = { busca: '', origens: [], resp: [], calor: [], tags: [], parado: [], periodo: { de: '', ate: '' } };

export const VIEWS = [
  { id: 'v1', nome: 'Meus quentes',    f: { ...semFiltro, resp: ['BR'], calor: ['quente', 'ardente'] } },
  { id: 'v2', nome: 'Meta Ads parado', f: { ...semFiltro, origens: ['Meta Ads'], tags: ['t6'] } },
  { id: 'v3', nome: 'Indicações',      f: { ...semFiltro, origens: ['Indicação'] } },
  { id: 'v4', nome: 'Esquecidos (15+ dias)', f: { ...semFiltro, parado: ['ate30', 'mais30'] } },
  { id: 'v5', nome: 'Entraram em julho',     f: { ...semFiltro, periodo: { de: '2026-07-01', ate: '2026-07-31' } } },
];

// ── Recursos que um funil pode ligar ─────────────────────────
// `travaCustom: true` = hoje impossível em funil custom/prazo,
// porque custom_pipe_entries não tem coluna metadata jsonb.
export const RECURSOS = [
  {
    id: 'valor', nome: 'Valor do negócio', icone: 'money',
    desc: 'Um campo de R$ na entrada do lead neste funil.',
    moraEm: 'pipeline_entries.metadata → sale_value', travaCustom: true,
  },
  {
    id: 'orcamento', nome: 'Orçamento com produtos', icone: 'box',
    desc: 'Itens com quantidade, tipo (recorrente / unitário / projeto) e total.',
    moraEm: 'pipe_proposta_items (FK → pipeline_entries.id)', travaCustom: true, travaForte: true,
  },
  {
    id: 'reuniao', nome: 'Reunião', icone: 'calendar',
    desc: 'Data e hora, status de confirmação e link do Meet.',
    moraEm: 'pipeline_entries.metadata → meeting_date, meet_link, confirmation_status', travaCustom: true,
  },
  {
    id: 'notas', nome: 'Notas da entrada', icone: 'note',
    desc: 'Anotação livre presa a este funil, não ao lead.',
    moraEm: 'pipeline_entries.notes / custom_pipe_entries.notes', travaCustom: false,
  },
  {
    id: 'perda', nome: 'Motivo de perda', icone: 'x',
    desc: 'Ao mover para etapa de perda, pede o motivo da lista da org.',
    moraEm: 'pipeline_entries.metadata → loss_reason_id', travaCustom: true,
  },
  {
    id: 'compromisso', nome: 'Compromisso / data-alvo', icone: 'clock',
    desc: 'Uma data-alvo genérica, sem a mecânica de confirmação.',
    moraEm: 'pipeline_entries.metadata → commitment_date', travaCustom: true,
  },
  {
    id: 'sla', nome: 'SLA e envelhecimento', icone: 'gauge',
    desc: 'Marca o card de amarelo/vermelho conforme os dias parados na etapa.',
    moraEm: 'pipeline_stages.sla_hours, max_days_in_stage', travaCustom: true,
  },
  {
    id: 'handoff', nome: 'Passagem automática', icone: 'branch',
    desc: 'Ao cair numa etapa, joga o lead em outro funil.',
    moraEm: 'pipeline_stages.target_pipe_type / target_stage_key', travaCustom: false,
  },
];

// Estado inicial por funil: recurso ligado + se resume no card
export const CONFIG_FUNIL = {
  // Qualificação sai com TUDO ligado de propósito: é o funil que abre por
  // padrão, e é nele que se vê o ponto da proposta — qualquer lead, em
  // qualquer funil, podendo ter produtos, valor, reunião, notas e data-alvo.
  // `card` fica ligado só no que cabe em 100px sem inchar o card de volta.
  // O contraste (funil que NÃO pode ter isso) continua sendo demonstrado
  // pelo Giro de carteira, logo abaixo, que é onde a trava do banco aparece.
  qualificacao: {
    valor:       { on: true,  card: true  },
    orcamento:   { on: true,  card: true  },
    reuniao:     { on: true,  card: true  },
    notas:       { on: true,  card: false },
    perda:       { on: true,  card: false },
    compromisso: { on: true,  card: false },
    sla:         { on: true,  card: true  },
    handoff:     { on: true,  card: false },
  },
  propostas: {
    valor:       { on: true,  card: true  },
    orcamento:   { on: true,  card: true  },
    reuniao:     { on: false, card: false },
    notas:       { on: true,  card: false },
    perda:       { on: true,  card: false },
    compromisso: { on: true,  card: true  },
    sla:         { on: false, card: false },
    handoff:     { on: false, card: false },
  },
  giro: {
    valor:       { on: false, card: false },
    orcamento:   { on: false, card: false },
    reuniao:     { on: false, card: false },
    notas:       { on: true,  card: true  },
    perda:       { on: false, card: false },
    compromisso: { on: false, card: false },
    sla:         { on: false, card: false },
    handoff:     { on: false, card: false },
  },
};

// ── Leads por etapa ──────────────────────────────────────────
// `d`  = há quanto tempo está parado NESTA etapa (filtro "Parado há")
// `cr` = data de criação do lead, ISO (filtro de período)
// Os dois são independentes: um lead criado em maio pode ter se mexido ontem.
// Toda data de criação é anterior ao tempo parado — lead não fica parado há
// mais tempo do que existe.
export const LEADS = [
  [ // Novo
    { id: 'l1', n: 'Ricardo Menezes',  e: 'Metalúrgica Vale Norte',   t: '(11) 9 8123-4477', v: 'R$ 48.500',  o: 'Meta Ads',   c: 7,  d: 'há 2 horas',  cr: '2026-07-12', a: ['BR'],       tg: ['t1'] },
    { id: 'l2', n: 'Juliana Freitas',  e: 'Embalagens RG',            t: '(41) 9 9702-1180', v: 'R$ 9.400',   o: 'Site',       c: 3,  d: 'há 5 horas',  cr: '2026-07-20', a: ['LA'],       tg: [] },
    { id: 'l3', n: 'Paulo Ribeiro',    e: 'Ferragens Novo Horizonte', t: '(31) 9 8840-2093', v: 'R$ 18.300',  o: 'Lista fria', c: 2,  d: 'ontem',       cr: '2026-06-28', a: ['BR'],       tg: ['t4'] },
    { id: 'l4', n: 'Helena Vasques',   e: 'Cimentos Aurora',          t: '(27) 9 9418-6655', v: 'R$ 91.000',  o: 'Indicação',  c: 9,  d: 'ontem',       cr: '2026-07-25', a: ['MT'],       tg: ['t2'] },
    { id: 'l5', n: 'Douglas Sampaio',  e: 'Tubos & Conexões Leste',   t: '(11) 9 9002-7731', v: 'R$ 33.700',  o: 'Meta Ads',   c: 5,  d: 'há 2 dias',   cr: '2026-07-15', a: ['LA','BR'], tg: [] },
    { id: 'l6', n: 'Beatriz Camargo',  e: 'Adesivos Panorama',        t: '(16) 9 8845-1209', v: 'R$ 6.800',   o: 'Site',       c: 2,  d: 'há 3 dias',   cr: '2026-05-30', a: ['BR'],       tg: ['t5'] },
    { id: 'l27', n: 'Nelson Aguiar',   e: 'Rebites Sudeste',          t: '(11) 9 8390-7741', v: 'R$ 24.600',  o: 'Meta Ads',   c: 4,  d: 'há 4 dias',   cr: '2026-07-22', a: ['MT'],       tg: [] },
    { id: 'l28', n: 'Vera Lucindo',    e: 'Esquadrias Novo Porto',    t: '(48) 9 9712-0086', v: 'R$ 39.100',  o: 'Indicação',  c: 8,  d: 'há 5 dias',   cr: '2026-07-19', a: ['LA'],       tg: ['t3'] },
    { id: 'l29', n: 'Fábio Quintela',  e: 'Abrasivos Central',        t: '(31) 9 8228-5519', v: 'R$ 15.200',  o: 'Site',       c: 3,  d: 'há 7 dias',   cr: '2026-06-14', a: ['BR','LA'], tg: [] },
  ],
  [ // Abordado
    { id: 'l7',  n: 'Anderson Prado',  e: 'Tintas Bandeirante',       t: '(19) 9 9611-3388', v: 'R$ 76.200',  o: 'Meta Ads',   c: 8,  d: 'há 1 dia',    cr: '2026-07-24', a: ['MT','BR'], tg: ['t2', 't1'] },
    { id: 'l8',  n: 'Camila Duarte',   e: 'Química Sul Ltda',         t: '(51) 9 8177-6620', v: 'R$ 27.800',  o: 'Indicação',  c: 5,  d: 'há 3 dias',   cr: '2026-06-20', a: ['LA'],       tg: ['t3'] },
    { id: 'l9',  n: 'Sandra Nogueira', e: 'Plásticos Itamar',         t: '(47) 9 9034-5512', v: 'R$ 54.000',  o: 'Site',       c: 6,  d: 'há 4 dias',   cr: '2026-07-11', a: ['MT'],       tg: [] },
    { id: 'l10', n: 'Elias Fontoura',  e: 'Motores Guarani',          t: '(43) 9 9250-8814', v: 'R$ 118.400', o: 'Indicação',  c: 9,  d: 'há 5 dias',   cr: '2026-05-18', a: ['BR'],       tg: ['t1'] },
    { id: 'l11', n: 'Priscila Amaral', e: 'Lubrificantes Onze',       t: '(11) 9 8776-3345', v: 'R$ 22.100',  o: 'Meta Ads',   c: 3,  d: 'há 6 dias',   cr: '2026-07-08', a: ['LA'],       tg: [] },
    { id: 'l12', n: 'Otávio Bezerra',  e: 'Serralheria Vertical',     t: '(81) 9 9503-2266', v: 'R$ 41.900',  o: 'Lista fria', c: 4,  d: 'há 8 dias',   cr: '2026-06-02', a: ['MT'],       tg: ['t4'] },
  ],
  [ // Respondeu
    { id: 'l13', n: 'Marcelo Tavares', e: 'Aços Piraí',               t: '(11) 9 9455-7712', v: 'R$ 132.000', o: 'Indicação',  c: 10, d: 'há 6 horas',  cr: '2026-07-27', a: ['BR','MT'], tg: ['t2'] },
    { id: 'l14', n: 'Fernanda Lopes',  e: 'Distribuidora Cristal',    t: '(62) 9 8290-4471', v: 'R$ 12.900',  o: 'Meta Ads',   c: 5,  d: 'há 2 dias',   cr: '2026-06-25', a: ['LA'],       tg: ['t5'] },
    { id: 'l15', n: 'Rogério Pinheiro',e: 'Compressores Atlas Sul',   t: '(54) 9 9187-0042', v: 'R$ 87.300',  o: 'Site',       c: 8,  d: 'há 3 dias',   cr: '2026-05-09', a: ['MT'],       tg: ['t1', 't3'] },
    { id: 'l16', n: 'Larissa Andrade', e: 'Filtros Nordeste',         t: '(71) 9 8664-9917', v: 'R$ 19.750',  o: 'Indicação',  c: 6,  d: 'há 4 dias',   cr: '2026-07-16', a: ['BR'],       tg: [] },
    { id: 'l17', n: 'Wagner Duarte',   e: 'Correias Primax',          t: '(11) 9 9871-5503', v: 'R$ 45.200',  o: 'Meta Ads',   c: 5,  d: 'há 6 dias',   cr: '2026-06-30', a: ['LA'],       tg: ['t4'] },
  ],
  [ // Agendado ✓
    { id: 'l18', n: 'Vinícius Aragão', e: 'Rolamentos Delta',         t: '(21) 9 9628-3040', v: 'R$ 63.700',  o: 'Meta Ads',   c: 8,  d: 'há 1 dia',    cr: '2026-07-21', a: ['MT'],       tg: ['t3', 't1'] },
    { id: 'l19', n: 'Cristiane Mota',  e: 'Válvulas Ipiranga Sul',    t: '(31) 9 9744-1188', v: 'R$ 58.900',  o: 'Indicação',  c: 9,  d: 'há 2 dias',   cr: '2026-06-11', a: ['BR'],       tg: ['t3'] },
    { id: 'l20', n: 'Leandro Bastos',  e: 'Fundição Três Rios',       t: '(24) 9 8830-6674', v: 'R$ 104.500', o: 'Site',       c: 6,  d: 'há 4 dias',   cr: '2026-05-22', a: ['LA','MT'], tg: [] },
  ],
  [ // Remarcar
    { id: 'l21', n: 'Tatiane Correia', e: 'Fios & Cabos Ipê',         t: '(85) 9 9911-2274', v: 'R$ 21.450',  o: 'Site',       c: 3,  d: 'há 8 dias',   cr: '2026-07-05', a: ['BR'],       tg: [] },
    { id: 'l22', n: 'Ivan Marchetti',  e: 'Estofados Bandeira',       t: '(11) 9 9066-4432', v: 'R$ 37.800',  o: 'Meta Ads',   c: 5,  d: 'há 11 dias',  cr: '2026-06-08', a: ['LA'],       tg: ['t7'] },
  ],
  [ // Esfriou
    { id: 'l23', n: 'Gustavo Peçanha', e: 'Vidraçaria Monte Belo',    t: '(48) 9 8123-9080', v: 'R$ 7.200',   o: 'Lista fria', c: 1,  d: 'há 22 dias',  cr: '2026-06-16', a: ['LA'],       tg: ['t6'] },
    { id: 'l24', n: 'Renata Bulhões',  e: 'Papelaria Atlântica',      t: '(11) 9 9330-1176', v: 'R$ 15.600',  o: 'Site',       c: 2,  d: 'há 31 dias',  cr: '2026-05-27', a: ['BR'],       tg: [] },
    { id: 'l25', n: 'Alexandre Ítalo', e: 'Madeireira Campo Verde',   t: '(65) 9 9277-8140', v: 'R$ 28.300',  o: 'Lista fria', c: 1,  d: 'há 38 dias',  cr: '2026-05-12', a: ['MT'],       tg: ['t6'] },
    { id: 'l26', n: 'Mônica Salgueiro',e: 'Refrigeração Polar Ltda',  t: '(41) 9 8551-3327', v: 'R$ 11.900',  o: 'Meta Ads',   c: 1,  d: 'há 45 dias',  cr: '2026-04-28', a: ['BR'],       tg: [] },
  ],
];

// Tiers de qualificação (src/.../qualification-config.tsx)
export const TIERS = [
  { id: 'diamante',      nome: 'Diamante',      cor: '#67e8f9' },
  { id: 'ouro',          nome: 'Ouro',          cor: '#ffc800' },
  { id: 'prata',         nome: 'Prata',         cor: '#acb0b9' },
  { id: 'bronze',        nome: 'Bronze',        cor: '#c9814b' },
  { id: 'desqualificado',nome: 'Desqualificado',cor: '#979187' },
];

// Campos personalizados da org (lead_custom_fields)
export const CAMPOS_CUSTOM = [
  { id: 'cnpj',     nome: 'CNPJ' },
  { id: 'porte',    nome: 'Porte' },
  { id: 'segmento', nome: 'Segmento' },
  { id: 'compra',   nome: 'Compra de concorrente' },
];

// Filtros do feed de atividade (ActivityFeed)
export const FILTROS_FEED = ['Todos', 'Comentários', 'Manual', 'Copilot', 'Automação', 'Sistema', 'Pipeline'];

// ── Ficha: o que cada lead tem em cada funil ─────────────────
// Só o Ricardo tem ficha rica; o resto cai num padrão.
export const FICHAS = {
  l1: {
    email: 'ricardo.menezes@valenorte.com.br',
    criadoEm: '12 jul 2026 às 09:14',
    idade: 'há 16 dias',
    preVenda: 'BR', venda: 'MT',
    preQual: 'ouro', qual: 'diamante',
    info: {
      Segmento: 'Metalurgia',
      Urgência: '1 mês',
      Faturamento: 'R$ 4,2M/ano',
      Observações: 'Compra hoje de concorrente. Contrato vence em outubro — janela curta.',
    },
    custom: { cnpj: '18.442.907/0001-55', porte: '80–200 funcionários', segmento: 'Metalurgia', compra: 'Sim — concorrente direto' },
    tracking: {
      Origem: 'Meta Ads',
      'UTM Campaign': 'compressores-b2b-jul',
      'UTM Source': 'facebook',
      'UTM Medium': 'cpc',
      'Meta Campaign ID': '23859471028340192',
    },
    checklists: [
      {
        titulo: 'Qualificação inicial',
        itens: [
          { txt: 'Confirmar decisor', ok: true },
          { txt: 'Levantar volume mensal', ok: true },
          { txt: 'Checar prazo do contrato atual', ok: false },
        ],
      },
      { titulo: 'Proposta', itens: [{ txt: 'Enviar orçamento', ok: false }, { txt: 'Follow-up D+3', ok: false }] },
    ],
    comentarios: [
      { autor: 'Bruna Ricci', ini: 'BR', quando: 'há 2 horas', txt: 'Atendeu. Pediu pra retornar depois das 17h — reunião interna à tarde.' },
      { autor: 'Mateus Tolen', ini: 'MT', quando: 'ontem', txt: '@Bruna Ricci consegue confirmar se o volume é mensal ou trimestral? Muda a proposta.' },
      { autor: 'Bruna Ricci', ini: 'BR', quando: 'há 6 dias', txt: 'Orçamento enviado por e-mail e WhatsApp.' },
    ],
    timeline: [
      { fonte: 'Pipeline', txt: 'Etapa alterada para "Novo" no Funil de Qualificação', quando: 'há 2 horas' },
      { fonte: 'Copilot',  txt: 'Agente Bia respondeu à primeira mensagem', quando: 'há 2 horas' },
      { fonte: 'Sistema',  txt: 'Lead criado via Meta Ads', quando: 'há 16 dias' },
    ],
    entradas: [
      {
        funil: 'qualificacao', etapa: 'Novo', desde: 'há 2 horas',
        valor: 'R$ 48.500',
        notas: 'Pediu para retornar depois das 17h. Já compra de concorrente, contrato vence em outubro.',
        reuniao: null,
      },
      {
        funil: 'propostas', etapa: 'Proposta Enviada', desde: 'há 6 dias',
        // `unit` é sempre PREÇO UNITÁRIO em reais. O total da linha é unit × qtd,
        // e o total do orçamento é recalculado no boot — nunca digitado à mão,
        // senão desencontra do primeiro recálculo.
        orcamento: {
          itens: [
            { nome: 'Compressor parafuso 50L', qtd: 2, tipo: 'Unit', unit: 15900 },
            { nome: 'Manutenção preventiva',   qtd: 1, tipo: 'Rec.', unit: 1200  },
            { nome: 'Instalação e setup',      qtd: 1, tipo: 'Proj', unit: 2300  },
          ],
        },
        compromisso: '15/08/2026',
        notas: 'Proposta enviada por e-mail e WhatsApp. Aguardando aprovação do sócio.',
        perda: null,
      },
      {
        funil: 'giro', etapa: 'Em andamento', desde: 'há 3 dias',
        notas: 'Cliente antigo, parou de comprar em março.',
        bloqueado: true,
      },
    ],
  },
};

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// '2026-07-12' → '12 jul 2026'. Fatia a string em vez de usar `new Date`:
// `new Date('2026-07-12')` é lido como UTC e volta um dia em fuso negativo.
export function dataLonga(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d} ${MESES[Number(m) - 1]} ${a}`;
}

// '2026-07-12' → '12/07'. Para os chips, onde o ano só ocupa espaço.
export function dataCurta(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// Gera uma ficha plausível para os leads sem seed próprio, para o
// protótipo não ter "buraco" ao abrir qualquer card.
export function fichaBase(lead) {
  const primeiro = lead.n.split(' ')[0].toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const dominio = lead.e.split(' ')[0].toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const tier = lead.c >= 9 ? 'diamante' : lead.c >= 7 ? 'ouro' : lead.c >= 4 ? 'prata' : 'bronze';

  return {
    email: `${primeiro}@${dominio}.com.br`,
    criadoEm: dataLonga(lead.cr) + ' às 11:02',
    idade: lead.d,
    preVenda: lead.a[0] || null,
    venda: lead.a[1] || null,
    preQual: tier,
    qual: null,
    info: { Segmento: '—', Urgência: '—', Faturamento: '—' },
    custom: {},
    tracking: { Origem: lead.o },
    checklists: [],
    comentarios: [],
    timeline: [{ fonte: 'Sistema', txt: `Lead criado via ${lead.o}`, quando: lead.d }],
    entradas: [{ funil: 'qualificacao', etapa: 'Novo', desde: lead.d, valor: null, notas: null, reuniao: null }],
  };
}
