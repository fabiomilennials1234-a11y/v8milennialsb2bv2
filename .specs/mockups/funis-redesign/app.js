import {
  FUNIS, ETAPAS, ORIGEM, TAGS, EQUIPE, FAIXAS_CALOR, FAIXAS_PARADO, HOJE, VIEWS,
  RECURSOS, CONFIG_FUNIL, LEADS, FICHAS, fichaBase,
  TIERS, CAMPOS_CUSTOM, FILTROS_FEED, dataLonga, dataCurta,
} from './dados.js';

// ─────────────────────────────────────────────────────────────
// Catálogo fictício — alimenta o autocomplete de produto
// ─────────────────────────────────────────────────────────────
const CATALOGO = [
  { nome: 'Compressor parafuso 50L',    tipo: 'Unit', valor: 15900 },
  { nome: 'Compressor pistão 20L',      tipo: 'Unit', valor: 4200  },
  { nome: 'Manutenção preventiva',      tipo: 'Rec.', valor: 1200  },
  { nome: 'Contrato de suporte',        tipo: 'Rec.', valor: 450   },
  { nome: 'Instalação e setup',         tipo: 'Proj', valor: 2300  },
  { nome: 'Treinamento de operação',    tipo: 'Proj', valor: 1800  },
  { nome: 'Kit de filtros (12 un)',     tipo: 'Unit', valor: 890   },
  { nome: 'Mangueira alta pressão 10m', tipo: 'Unit', valor: 320   },
];
const TIPOS = ['Unit', 'Rec.', 'Proj'];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

function ico(id, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', '#i-' + id);
  s.appendChild(u);
  return s;
}

function corIniciais(ini) {
  let h = 0;
  for (let i = 0; i < ini.length; i++) h = (h * 31 + ini.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 60%, 45%)`;
}

const brl = (n) => 'R$ ' + n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const soNumero = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;

// Ignora acento e caixa — "peçanha" acha "Peçanha", "acos" acha "Aços"
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const diasDe = (d) => {
  const m = /(\d+)\s*dias?/.exec(d);
  if (m) return Number(m[1]);
  if (/ontem/.test(d)) return 1;
  return 0;
};

const tagPorId = (id) => TAGS.find((t) => t.id === id);
const REUNIOES = {
  l18: '12/08 · 14:00', l19: '13/08 · 09:30', l20: '14/08 · 16:00',
  l21: '19/08 · 10:00', l22: '21/08 · 15:30',
};
const NOTAS = new Set(['l1', 'l13', 'l4', 'l10', 'l23']);

let funilAtual = 'qualificacao';
let leadAberto = null;
const views = [...VIEWS];
let viewAtiva = null;

// Visão do board. O alternador Kanban/Lista/Analytics saiu do cabeçalho no
// Modelo 1; ele mora no topo do menu Views — assim a Lista continua alcançável
// no desktop sem devolver um segundo controle à faixa.
let vista = 'kanban';
const VISTAS = [
  { id: 'kanban',    nome: 'Kanban',    ic: 'kanban' },
  { id: 'lista',     nome: 'Lista',     ic: 'list'   },
  { id: 'analytics', nome: 'Analytics', ic: 'chart'  },
];

// Seleção múltipla. Guarda id de lead; a barra de ação em massa lê daqui.
const selecao = new Set();
let ancoraSel = null;              // p/ shift-clique selecionar intervalo
let ordemLista = { col: 'valor', asc: false };
const ordemColuna = {};            // idx da etapa → critério de ordenação
let abaCfg = 'recursos';

// `ordemColuna` é chaveada por ÍNDICE, e a aba Etapas mexe na ordem de ETAPAS.
// Sem remapear, ordenar a 3ª coluna e depois mover uma etapa fazia a ordenação
// aparecer noutra coluna — errado e silencioso. Chamado nas 3 mutações.
function trocarOrdem(i, j) {
  const a = ordemColuna[i], b = ordemColuna[j];
  if (b === undefined) delete ordemColuna[i]; else ordemColuna[i] = b;
  if (a === undefined) delete ordemColuna[j]; else ordemColuna[j] = a;
}

function reindexarOrdem(pos, delta) {
  const novo = {};
  Object.keys(ordemColuna).forEach((k) => {
    const i = Number(k);
    if (i === pos && delta < 0) return;      // a etapa excluída leva o critério junto
    novo[i >= pos ? i + delta : i] = ordemColuna[k];
  });
  Object.keys(ordemColuna).forEach((k) => delete ordemColuna[k]);
  Object.assign(ordemColuna, novo);
}

const filtrosVazios = () => ({
  busca: '', origens: [], resp: [], calor: [], tags: [],
  parado: [],                    // faixas de dias parado na etapa
  periodo: { de: '', ate: '' },  // data de criação do lead, ISO, inclusivo nas 2 pontas
});
let filtros = filtrosVazios();

// Atalhos do filtro de período. `de` é calculado a partir de HOJE, que é fixo
// no protótipo — ver o comentário em dados.js.
function menosDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d - n));
  return dt.toISOString().slice(0, 10);
}

const ATALHOS_PERIODO = [
  { id: '7d',  rot: '7 dias',     faixa: () => ({ de: menosDias(HOJE, 6), ate: HOJE }) },
  { id: '30d', rot: '30 dias',    faixa: () => ({ de: menosDias(HOJE, 29), ate: HOJE }) },
  { id: 'mes', rot: 'Este mês',   faixa: () => ({ de: HOJE.slice(0, 8) + '01', ate: HOJE }) },
  { id: '90d', rot: '90 dias',    faixa: () => ({ de: menosDias(HOJE, 89), ate: HOJE }) },
];

function fichaDe(leadId) {
  if (!FICHAS[leadId]) FICHAS[leadId] = fichaBase(leadPorId(leadId));
  return FICHAS[leadId];
}
const leadPorId = (id) => LEADS.flat().find((l) => l.id === id);

// Preso ao funil aberto: o orçamento mora na ENTRADA do lead naquele funil,
// não no lead. Sem este filtro o card de Qualificação exibia o orçamento que
// existe na entrada de Propostas — número certo, funil errado.
function resumoOrcamento(leadId) {
  const f = FICHAS[leadId];
  if (!f) return null;
  const ent = f.entradas.find((e) => e.funil === funilAtual && e.orcamento?.itens?.length);
  return ent ? `${ent.orcamento.itens.length} ${ent.orcamento.itens.length === 1 ? 'item' : 'itens'}` : null;
}

// ─────────────────────────────────────────────────────────────
// Filtros
// ─────────────────────────────────────────────────────────────
function passa(lead) {
  const f = filtros;

  if (f.busca) {
    const q = norm(f.busca.trim());
    if (q) {
      // Nome e empresa casam por texto; telefone casa por dígito, exigindo
      // 3+ dígitos pra um "1" solto não trazer a base inteira.
      const texto = norm(lead.n + ' ' + lead.e);
      const digitos = q.replace(/\D/g, '');
      const fone = lead.t.replace(/\D/g, '');
      const casaTexto = texto.includes(q);
      const casaFone = digitos.length >= 3 && fone.includes(digitos);
      if (!casaTexto && !casaFone) return false;
    }
  }
  if (f.origens.length && !f.origens.includes(lead.o)) return false;
  if (f.resp.length && !lead.a.some((i) => f.resp.includes(i))) return false;
  if (f.tags.length && !lead.tg.some((t) => f.tags.includes(t))) return false;
  if (f.calor.length) {
    const faixa = FAIXAS_CALOR.find((x) => lead.c >= x.min && lead.c <= x.max);
    if (!faixa || !f.calor.includes(faixa.id)) return false;
  }

  // Período de criação. Data ISO compara direito como string ('2026-07-09' <
  // '2026-07-12'), então não precisa virar Date. Inclusivo nas duas pontas:
  // "de 01/07 até 31/07" tem que trazer quem entrou no dia 31.
  if (f.periodo.de && lead.cr < f.periodo.de) return false;
  if (f.periodo.ate && lead.cr > f.periodo.ate) return false;

  // Tempo parado na etapa atual.
  if (f.parado.length) {
    const dias = diasDe(lead.d);
    const faixa = FAIXAS_PARADO.find((x) => dias >= x.min && dias <= x.max);
    if (!faixa || !f.parado.includes(faixa.id)) return false;
  }
  return true;
}

const leadsDaEtapa = (i) => (LEADS[i] || []).filter(passa);

function contarFiltros() {
  const f = filtros;
  return (f.origens.length ? 1 : 0) + (f.resp.length ? 1 : 0) + (f.calor.length ? 1 : 0)
    + (f.tags.length ? 1 : 0) + (f.parado.length ? 1 : 0) + (f.periodo.de || f.periodo.ate ? 1 : 0);
}
const temFiltro = () => contarFiltros() > 0 || !!filtros.busca;

// ─────────────────────────────────────────────────────────────
// Board
// ─────────────────────────────────────────────────────────────
function chipsDoCard(lead) {
  const cfg = CONFIG_FUNIL[funilAtual] || {};
  const chips = [];
  if (cfg.reuniao?.on && cfg.reuniao.card && REUNIOES[lead.id]) {
    chips.push({ ic: 'calendar', txt: REUNIOES[lead.id], forte: true });
  }
  const orc = resumoOrcamento(lead.id);
  if (cfg.orcamento?.on && cfg.orcamento.card && orc) chips.push({ ic: 'box', txt: orc });
  if (cfg.notas?.on && cfg.notas.card && NOTAS.has(lead.id)) chips.push({ ic: 'note', txt: 'nota' });
  if (cfg.sla?.on && cfg.sla.card) {
    const dias = diasDe(lead.d);
    if (dias >= 8) chips.push({ ic: 'gauge', txt: `${dias}d parado`, warn: true });
  }
  return chips;
}

function montarCard(lead, etapaIdx, idsVisiveis) {
  const cfg = CONFIG_FUNIL[funilAtual] || {};
  const marcado = selecao.has(lead.id);
  const cd = el('div', 'cd' + (marcado ? ' cd--sel' : ''));
  cd.tabIndex = 0;
  cd.setAttribute('role', 'button');
  cd.dataset.lead = lead.id;
  cd.setAttribute('aria-label', `${lead.n}, ${lead.e}. Enter abre a ficha.`);

  const top = el('div', 'cd-top');

  // A caixa fica escondida até o hover (ou até haver seleção), pra não
  // roubar os 100px que o card ganhou ao ser compactado.
  const sel = el('button', 'cd-sel' + (marcado ? ' cd-sel--on' : ''));
  sel.type = 'button';
  sel.setAttribute('role', 'checkbox');
  sel.setAttribute('aria-checked', String(marcado));
  sel.setAttribute('aria-label', `Selecionar ${lead.n}`);
  sel.appendChild(ico('check'));
  sel.addEventListener('click', (e) => {
    e.stopPropagation();
    alternarSelecao(lead.id, idsVisiveis, e.shiftKey);
  });
  top.appendChild(sel);

  const who = el('div', 'cd-who');
  who.appendChild(el('div', 'cd-nm', lead.n));
  const co = el('div', 'cd-co');
  co.appendChild(ico('build'));
  co.appendChild(el('span', null, lead.e));
  who.appendChild(co);
  top.appendChild(who);

  const avs = el('div', 'avs');
  lead.a.forEach((ini) => {
    const s = el('span', null, ini);
    s.style.background = corIniciais(ini);
    s.title = EQUIPE.find((m) => m.ini === ini)?.nome || ini;
    avs.appendChild(s);
  });
  top.appendChild(avs);

  const kb = el('button', 'cd-kb');
  kb.type = 'button';
  kb.setAttribute('aria-haspopup', 'menu');
  kb.setAttribute('aria-label', `Ações de ${lead.n}`);
  kb.appendChild(ico('dots'));
  kb.addEventListener('click', (e) => {
    e.stopPropagation();
    abrirMenuCard(e.currentTarget, lead, etapaIdx);
  });
  top.appendChild(kb);
  cd.appendChild(top);

  const bd = el('div', 'cd-badges');
  if (lead.tg.length) {
    const tags = el('span', 'cd-tags');
    lead.tg.forEach((id) => {
      const t = tagPorId(id);
      if (!t) return;
      const i = el('i');
      i.style.background = t.cor;
      i.title = t.nome;
      tags.appendChild(i);
    });
    bd.appendChild(tags);
  }
  const org = ORIGEM[lead.o];
  const b1 = el('span', 'bdg', lead.o);
  b1.style.color = org.fg;
  b1.style.background = org.bg;
  b1.style.borderColor = org.fg + '40';
  bd.appendChild(b1);
  if (lead.c >= 8) {
    const b2 = el('span', 'bdg', 'Alto potencial');
    b2.style.color = '#f6a823';
    b2.style.background = 'rgba(246,168,35,.12)';
    b2.style.borderColor = 'rgba(246,168,35,.28)';
    bd.appendChild(b2);
  }
  const bt = el('span', 'bdg bdg--time');
  bt.appendChild(ico('clock'));
  bt.appendChild(el('span', null, lead.d));
  bd.appendChild(bt);
  cd.appendChild(bd);

  const info = el('div', 'cd-info');
  info.appendChild(el('span', 'tel', lead.t));
  if (cfg.valor?.on && cfg.valor.card) info.appendChild(el('span', 'val', lead.v));
  cd.appendChild(info);

  const chips = chipsDoCard(lead);
  if (chips.length) {
    const cw = el('div', 'cd-chips');
    chips.forEach((c) => {
      const s = el('span', 'rchip' + (c.warn ? ' rchip--warn' : ''));
      s.appendChild(ico(c.ic));
      s.appendChild(c.forte ? el('b', null, c.txt) : el('span', null, c.txt));
      cw.appendChild(s);
    });
    cd.appendChild(cw);
  }
  return cd;
}

// Ordenação por coluna. `padrao` = ordem do array, que é a ordem em que o
// arrasto deixou os cards — por isso é o default e não some do menu.
const CRITERIOS = [
  { id: 'padrao', nome: 'Ordem manual' },
  { id: 'valor',  nome: 'Maior valor' },
  { id: 'calor',  nome: 'Mais quente' },
  { id: 'tempo',  nome: 'Mais parado' },
  { id: 'nome',   nome: 'Nome (A–Z)' },
];

function ordenar(lista, criterio) {
  if (!criterio || criterio === 'padrao') return lista;
  const copia = [...lista];
  if (criterio === 'valor') copia.sort((a, b) => soNumero(b.v) - soNumero(a.v));
  if (criterio === 'calor') copia.sort((a, b) => b.c - a.c);
  if (criterio === 'tempo') copia.sort((a, b) => diasDe(b.d) - diasDe(a.d));
  if (criterio === 'nome') copia.sort((a, b) => norm(a.n).localeCompare(norm(b.n)));
  return copia;
}

// Ponto único de redesenho: tudo no app chama renderBoard(), e é aqui que
// se decide qual visão desenhar. Mantém os ~20 pontos de chamada intactos.
//
// A rolagem é preservada AQUI, não dentro de cada visão: todo redesenho
// esvazia o #board, e sem isto marcar uma linha lá embaixo na Lista jogava a
// página de volta pro topo. Ao TROCAR de visão a rolagem zera de propósito —
// a posição de uma visão não quer dizer nada na outra.
let vistaDesenhada = null;

function renderBoard() {
  const board = $('#board');
  const mesma = vistaDesenhada === vista;
  const x = mesma ? board.scrollLeft : 0;
  const y = mesma ? board.scrollTop : 0;

  board.className = 'board board--' + vista;
  if (vista === 'kanban') renderKanban();
  else if (vista === 'lista') renderLista();
  else renderAnalytics();
  vistaDesenhada = vista;

  board.scrollLeft = x;
  board.scrollTop = y;
  renderSelbar();
}

function renderKanban() {
  const board = $('#board');
  board.textContent = '';

  let total = 0;
  ETAPAS.forEach((et, idx) => {
    const col = el('div', 'col');
    col.dataset.etapa = String(idx);
    const visiveis = ordenar(leadsDaEtapa(idx), ordemColuna[idx]);
    total += visiveis.length;

    const h = el('div', 'col-h');
    const sw = el('span', 'sw');
    sw.style.background = et.cor;
    h.appendChild(sw);
    h.appendChild(el('span', 'nm', et.nome));
    const pill = el('span', 'pill' + (temFiltro() ? ' pill--filtrado' : ''), temFiltro() ? String(visiveis.length) : String(et.n));
    pill.title = temFiltro() ? `${visiveis.length} de ${et.n} com os filtros atuais` : `${et.n} negócios`;
    h.appendChild(pill);
    if (ordemColuna[idx] && ordemColuna[idx] !== 'padrao') {
      const o = el('span', 'col-ord');
      o.appendChild(ico('sort'));
      o.title = 'Ordenado por ' + CRITERIOS.find((c) => c.id === ordemColuna[idx]).nome.toLowerCase();
      h.appendChild(o);
    }
    const kb = el('button', 'kb');
    kb.type = 'button';
    kb.setAttribute('aria-haspopup', 'menu');
    kb.setAttribute('aria-label', `Opções da etapa ${et.nome}`);
    kb.appendChild(ico('dots'));
    kb.addEventListener('click', (e) => abrirMenuColuna(e.currentTarget, idx));
    h.appendChild(kb);
    col.appendChild(h);

    const body = el('div', 'col-body');
    body.dataset.etapa = String(idx);
    const ids = visiveis.map((l) => l.id);
    if (visiveis.length) visiveis.forEach((l) => body.appendChild(montarCard(l, idx, ids)));
    else body.appendChild(el('div', 'col-empty', temFiltro() ? 'Nada com esses filtros' : 'Solte um card aqui'));
    col.appendChild(body);

    const f = el('button', 'col-f');
    f.type = 'button';
    f.appendChild(ico('plus'));
    f.appendChild(el('span', null, 'Novo negócio'));
    col.appendChild(f);

    body.addEventListener('scroll', () => marcarTemMais(body), { passive: true });
    board.appendChild(col);
  });

  $('#vazio-geral').hidden = total > 0 || !temFiltro();
  requestAnimationFrame(() => $$('.col-body').forEach(marcarTemMais));
}

function marcarTemMais(body) {
  const sobra = body.scrollHeight - body.clientHeight - body.scrollTop;
  body.classList.toggle('tem-mais', sobra > 4);
}

// ─────────────────────────────────────────────────────────────
// Arrastar entre etapas (ponteiro, limiar de 8px — como o dnd-kit)
// ─────────────────────────────────────────────────────────────
const LIMIAR = 8;
let arrasto = null;
let arrastou = false;

// Índice ABSOLUTO em LEADS[etapa]. Com filtro ativo a coluna mostra
// um subconjunto, então a posição na tela não é a posição no array.
function indiceAbsoluto(body, y, etapa) {
  const cards = $$('.cd:not(.cd--fantasma)', body);
  const lista = LEADS[etapa];
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) {
      const pos = lista.findIndex((l) => l.id === c.dataset.lead);
      if (pos > -1) return pos;
    }
  }
  return lista.length;
}

function iniciarArrasto(e, card) {
  const r = card.getBoundingClientRect();
  arrasto = {
    leadId: card.dataset.lead,
    deEtapa: Number(card.closest('.col-body').dataset.etapa),
    x0: e.clientX, y0: e.clientY,
    offX: e.clientX - r.left, offY: e.clientY - r.top,
    largura: r.width, card, ativo: false, clone: null, alvo: null,
  };
}

function ativarArrasto() {
  const a = arrasto;
  a.ativo = true;
  arrastou = true;
  a.clone = a.card.cloneNode(true);
  a.clone.classList.add('cd--voando');
  a.clone.style.width = a.largura + 'px';
  document.body.appendChild(a.clone);
  a.card.classList.add('cd--fantasma');
  document.body.classList.add('arrastando');
}

function moverArrasto(e) {
  const a = arrasto;
  if (!a) return;
  if (!a.ativo) {
    if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < LIMIAR) return;
    ativarArrasto();
  }
  a.clone.style.left = (e.clientX - a.offX) + 'px';
  a.clone.style.top = (e.clientY - a.offY) + 'px';

  a.clone.style.visibility = 'hidden';
  const sob = document.elementFromPoint(e.clientX, e.clientY);
  a.clone.style.visibility = '';

  const body = sob?.closest('.col-body');
  $$('.col-body.alvo').forEach((b) => b.classList.remove('alvo'));
  if (body) {
    body.classList.add('alvo');
    const etapa = Number(body.dataset.etapa);
    a.alvo = { etapa, indice: indiceAbsoluto(body, e.clientY, etapa) };
  } else {
    a.alvo = null;
  }
}

function soltarArrasto() {
  const a = arrasto;
  arrasto = null;
  if (!a) return;
  $$('.col-body.alvo').forEach((b) => b.classList.remove('alvo'));
  document.body.classList.remove('arrastando');
  if (!a.ativo) return;

  a.clone.remove();
  a.card.classList.remove('cd--fantasma');

  if (a.alvo) {
    const { etapa, indice } = a.alvo;
    const origem = LEADS[a.deEtapa];
    const pos = origem.findIndex((l) => l.id === a.leadId);
    if (pos > -1) {
      const [lead] = origem.splice(pos, 1);
      let destino = indice;
      if (etapa === a.deEtapa && pos < indice) destino--;
      LEADS[etapa].splice(destino, 0, lead);
      if (etapa !== a.deEtapa) {
        ETAPAS[a.deEtapa].n = Math.max(0, ETAPAS[a.deEtapa].n - 1);
        ETAPAS[etapa].n += 1;
        lead.d = 'agora';
        avisar(`${lead.n} → ${ETAPAS[etapa].nome}`);
      }
    }
  }
  renderBoard();
}

function avisar(txt) {
  const t = el('div', 'toast');
  t.appendChild(ico('check'));
  t.appendChild(el('span', null, txt));
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ─────────────────────────────────────────────────────────────
// Popovers (dropdown de funil, filtros, views)
// ─────────────────────────────────────────────────────────────
let popAberto = null;

function abrirPop(menu, botao) {
  fecharPop();
  menu.hidden = false;
  botao.setAttribute('aria-expanded', 'true');
  popAberto = { menu, botao };
  const primeiro = menu.querySelector('button, input, [tabindex]');
  if (primeiro) primeiro.focus();
}

function fecharPop() {
  if (!popAberto) return;
  popAberto.menu.hidden = true;
  popAberto.botao.setAttribute('aria-expanded', 'false');
  popAberto = null;
}

function alternarPop(menu, botao, render) {
  if (popAberto?.menu === menu) { fecharPop(); botao.focus(); return; }
  if (render) render();
  abrirPop(menu, botao);
}

document.addEventListener('mousedown', (e) => {
  if (!popAberto) return;
  if (popAberto.menu.contains(e.target) || popAberto.botao.contains(e.target)) return;
  fecharPop();
});

// ── Dropdown de funil ────────────────────────────────────────
const GRUPOS = [
  { rot: 'Estruturais',  tipo: 'sistema' },
  { rot: 'Customizados', tipo: 'custom'  },
  { rot: 'Com prazo',    tipo: 'prazo'   },
];

function renderMenuFunis() {
  const m = $('#menu-funis');
  m.textContent = '';

  GRUPOS.forEach((g) => {
    const doGrupo = FUNIS.filter((f) => f.tipo === g.tipo);
    if (!doGrupo.length) return;
    m.appendChild(el('div', 'menu-t', g.rot));
    doGrupo.forEach((f) => {
      const configurado = !!CONFIG_FUNIL[f.id];
      const b = el('button', 'menu-i' + (f.id === funilAtual ? ' menu-i--on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(f.id === funilAtual));

      const sw = el('span', 'sw');
      sw.style.background = f.cor;
      b.appendChild(sw);
      b.appendChild(el('span', 'n', f.nome));
      if (!configurado) {
        const av = el('span', 'menu-av', 'sem dados');
        av.title = 'Este funil não tem dados no protótipo — o board continua no atual';
        b.appendChild(av);
      }
      b.appendChild(el('span', 'q', String(f.qtd)));
      if (f.id === funilAtual) b.appendChild(ico('check', 'menu-ck'));

      b.addEventListener('click', () => {
        if (!configurado) return;
        funilAtual = f.id;
        $('#pick-nome').textContent = f.nome;
        $('#pick-sw').style.background = f.cor;
        fecharPop();
        $('#btn-pick').focus();
        renderBoard();
      });
      if (!configurado) b.disabled = true;
      m.appendChild(b);
    });
  });

  const sep = el('div', 'menu-sep');
  m.appendChild(sep);
  const novo = el('button', 'menu-i menu-i--acao');
  novo.type = 'button';
  novo.appendChild(ico('plus'));
  novo.appendChild(el('span', 'n', 'Criar funil'));
  m.appendChild(novo);
}

// ── Painel de filtros ────────────────────────────────────────
function secaoFiltro(titulo, itens, selecionados, aoAlternar) {
  const s = el('div', 'fsec');
  s.appendChild(el('div', 'fsec-t', titulo));
  itens.forEach((it) => {
    const marcado = selecionados.includes(it.id);
    const b = el('button', 'fopt' + (marcado ? ' fopt--on' : ''));
    b.type = 'button';
    b.setAttribute('role', 'checkbox');
    b.setAttribute('aria-checked', String(marcado));
    const box = el('span', 'box');
    box.appendChild(ico('check'));
    b.appendChild(box);
    if (it.cor) {
      const d = el('span', 'fdot');
      d.style.background = it.cor;
      b.appendChild(d);
    }
    b.appendChild(el('span', 'n', it.nome));
    b.addEventListener('click', () => { aoAlternar(it.id); renderMenuFiltros(); aplicarFiltros(); });
    s.appendChild(b);
  });
  return s;
}

function alterna(lista, id) {
  const i = lista.indexOf(id);
  if (i > -1) lista.splice(i, 1); else lista.push(id);
}

// Período de criação: atalhos + as duas datas. Os atalhos só preenchem os
// campos — quem manda são o "de" e o "até", então dá pra pegar um atalho e
// depois ajustar uma ponta sem perder a outra.
function secaoPeriodo() {
  const p = filtros.periodo;
  const s = el('div', 'fsec');
  s.appendChild(el('div', 'fsec-t', 'Criados no período'));

  const atalhos = el('div', 'fper-atalhos');
  ATALHOS_PERIODO.forEach((at) => {
    const f = at.faixa();
    const ativo = p.de === f.de && p.ate === f.ate;
    const b = el('button', 'fper-at' + (ativo ? ' fper-at--on' : ''), at.rot);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(ativo));
    b.addEventListener('click', () => {
      // Reclicar o atalho que já está valendo desliga o filtro.
      Object.assign(p, ativo ? { de: '', ate: '' } : f);
      viewAtiva = null;
      renderMenuFiltros(); aplicarFiltros();
    });
    atalhos.appendChild(b);
  });
  s.appendChild(atalhos);

  const linha = el('div', 'fper-datas');
  const campo = (rot, chave, outro) => {
    const w = el('label', 'fper-c');
    w.appendChild(el('span', null, rot));
    const i = el('input', 'inp inp--data');
    i.type = 'date';
    i.value = p[chave];
    i.max = chave === 'de' ? (p.ate || HOJE) : HOJE;
    if (chave === 'ate' && p.de) i.min = p.de;
    i.setAttribute('aria-label', `Criados ${rot.toLowerCase()}`);
    i.addEventListener('change', () => {
      // Nada é criado no futuro: o `max` do input só segura o seletor nativo,
      // digitar ou colar passa por cima dele.
      p[chave] = i.value && i.value > HOJE ? HOJE : i.value;
      // Inverteu as pontas? Arrasta a outra junto, senão sobra um intervalo
      // impossível (de > até) que nunca casaria com nada.
      if (p.de && p.ate && p.de > p.ate) p[outro] = p[chave];
      viewAtiva = null;
      renderMenuFiltros(); aplicarFiltros();
    });
    w.appendChild(i);
    return w;
  };
  linha.appendChild(campo('De', 'de', 'ate'));
  linha.appendChild(campo('Até', 'ate', 'de'));
  s.appendChild(linha);

  if (p.de || p.ate) {
    const lim = el('button', 'fper-limpar', 'Limpar período');
    lim.type = 'button';
    lim.addEventListener('click', () => {
      p.de = ''; p.ate = '';
      viewAtiva = null;
      renderMenuFiltros(); aplicarFiltros();
    });
    s.appendChild(lim);
  }
  return s;
}

function renderMenuFiltros() {
  const m = $('#menu-filtros');
  // Com 6 seções o painel rola. Todo clique aqui redesenha ele inteiro, e sem
  // guardar a posição marcar "Tags" jogava a lista de volta pro topo.
  const y = m.scrollTop;
  m.textContent = '';

  const topo = el('div', 'menu-topo');
  topo.appendChild(el('span', null, 'Filtros'));
  const limpar = el('button', 'menu-limpar', 'Limpar tudo');
  limpar.type = 'button';
  limpar.addEventListener('click', () => {
    const busca = filtros.busca;
    filtros = filtrosVazios();
    filtros.busca = busca;
    viewAtiva = null;
    renderMenuFiltros(); aplicarFiltros();
  });
  topo.appendChild(limpar);
  m.appendChild(topo);

  const corpo = el('div', 'menu-corpo');
  corpo.appendChild(secaoPeriodo());

  corpo.appendChild(secaoFiltro('Parado há',
    FAIXAS_PARADO.map((x) => ({ id: x.id, nome: x.nome })),
    filtros.parado, (id) => alterna(filtros.parado, id)));

  corpo.appendChild(secaoFiltro('Origem',
    Object.keys(ORIGEM).map((o) => ({ id: o, nome: o, cor: ORIGEM[o].fg })),
    filtros.origens, (id) => alterna(filtros.origens, id)));

  corpo.appendChild(secaoFiltro('Responsável',
    EQUIPE.map((p) => ({ id: p.ini, nome: p.nome })),
    filtros.resp, (id) => alterna(filtros.resp, id)));

  corpo.appendChild(secaoFiltro('Calor',
    FAIXAS_CALOR.map((f) => ({ id: f.id, nome: f.nome })),
    filtros.calor, (id) => alterna(filtros.calor, id)));

  corpo.appendChild(secaoFiltro('Tags',
    TAGS.map((t) => ({ id: t.id, nome: t.nome, cor: t.cor })),
    filtros.tags, (id) => alterna(filtros.tags, id)));

  m.appendChild(corpo);
  m.scrollTop = y;
}

// ── Views ────────────────────────────────────────────────────
function mesmosFiltros(a, b) {
  const chave = (f) => JSON.stringify({
    o: [...f.origens].sort(), r: [...f.resp].sort(),
    c: [...f.calor].sort(), t: [...f.tags].sort(),
    p: [...(f.parado || [])].sort(),
    d: [f.periodo?.de || '', f.periodo?.ate || ''],
  });
  return chave(a) === chave(b);
}

// O alternador Kanban/Lista/Analytics saiu da faixa quando o Modelo 1 fundiu
// tudo numa linha — mas sem ele a visão Lista (a única do mobile) ficaria
// inalcançável no desktop. A saída é ele morar aqui, no topo do menu Views:
// o cabeçalho continua com uma linha só e nada some da navegação.
function renderMenuViews() {
  const m = $('#menu-views');
  m.textContent = '';

  m.appendChild(el('div', 'menu-t', 'Visão'));
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Visão do funil');
  VISTAS.forEach((v) => {
    const b = el('button', 'seg-b' + (v.id === vista ? ' seg-b--on' : ''));
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(v.id === vista));
    b.appendChild(ico(v.ic));
    b.appendChild(el('span', null, v.nome));
    b.addEventListener('click', () => {
      vista = v.id;
      $('#ic-vista').firstChild.setAttribute('href', '#i-' + v.ic);
      fecharPop();
      $('#btn-views').focus();
      renderBoard();
    });
    seg.appendChild(b);
  });
  m.appendChild(seg);
  m.appendChild(el('div', 'menu-sep'));

  m.appendChild(el('div', 'menu-t', 'Visualizações salvas'));

  if (!views.length) m.appendChild(el('div', 'menu-vazio', 'Nenhuma ainda'));

  // Aplicar e excluir são IRMÃOS dentro da linha. Antes o × era um <button>
  // dentro do <button> da view (aninhamento inválido) e ficava absoluto na
  // borda direita — exatamente em cima do ✓ que marca a view em uso.
  views.forEach((v) => {
    const ativa = viewAtiva === v.id && mesmosFiltros(filtros, v.f);
    const linha = el('div', 'menu-linha');

    const b = el('button', 'menu-i' + (ativa ? ' menu-i--on' : ''));
    b.type = 'button';
    b.appendChild(ico('book'));
    b.appendChild(el('span', 'n', v.nome));
    if (ativa) b.appendChild(ico('check', 'menu-ck'));
    b.addEventListener('click', () => {
      // Sobre os padrões, não no lugar deles: view salva antes de um filtro
      // novo existir não tem a chave dele, e sem esta base `passa()` quebraria
      // ao ler `filtros.periodo.de` de um undefined.
      filtros = { ...filtrosVazios(), ...structuredClone(v.f), busca: filtros.busca };
      viewAtiva = v.id;
      fecharPop();
      aplicarFiltros();
    });
    linha.appendChild(b);

    const rm = el('button', 'menu-rm');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Excluir a visualização ${v.nome}`);
    rm.appendChild(ico('x'));
    rm.addEventListener('click', () => {
      const i = views.findIndex((x) => x.id === v.id);
      if (i > -1) views.splice(i, 1);
      if (viewAtiva === v.id) viewAtiva = null;
      renderMenuViews();
    });
    linha.appendChild(rm);

    m.appendChild(linha);
  });

  m.appendChild(el('div', 'menu-sep'));

  if (!contarFiltros()) {
    const av = el('div', 'menu-vazio', 'Aplique um filtro para poder salvar');
    m.appendChild(av);
    return;
  }

  const form = el('div', 'menu-salvar');
  const inp = el('input', 'inp');
  inp.type = 'text';
  inp.placeholder = 'Nome da visualização';
  inp.setAttribute('aria-label', 'Nome da visualização');
  form.appendChild(inp);
  const ok = el('button', 'btn-sm btn-sm--gold', 'Salvar');
  ok.type = 'button';
  const salvar = () => {
    const nome = inp.value.trim();
    if (!nome) { inp.classList.add('inp--erro'); inp.focus(); return; }
    const v = { id: 'v' + Date.now(), nome, f: structuredClone({ ...filtros, busca: '' }) };
    views.push(v);
    viewAtiva = v.id;
    renderMenuViews();
    avisar(`Visualização "${nome}" salva`);
  };
  ok.addEventListener('click', salvar);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') salvar(); });
  inp.addEventListener('input', () => inp.classList.remove('inp--erro'));
  form.appendChild(ok);
  m.appendChild(form);
}

// ── Chips dos filtros ativos ─────────────────────────────────
function renderChips() {
  const barra = $('#chips');
  barra.textContent = '';
  const f = filtros;

  const add = (rot, aoRemover) => {
    const c = el('span', 'chip');
    c.appendChild(el('span', null, rot));
    const x = el('button', 'x');
    x.type = 'button';
    x.setAttribute('aria-label', `Remover filtro ${rot}`);
    x.appendChild(ico('x'));
    x.addEventListener('click', () => { aoRemover(); viewAtiva = null; aplicarFiltros(); });
    c.appendChild(x);
    barra.appendChild(c);
  };

  if (f.origens.length) add(`Origem: ${f.origens.join(', ')}`, () => { f.origens = []; });
  if (f.resp.length) {
    const nomes = f.resp.map((i) => EQUIPE.find((m) => m.ini === i)?.nome || i);
    add(`Responsável: ${nomes.join(', ')}`, () => { f.resp = []; });
  }
  if (f.calor.length) {
    const nomes = f.calor.map((id) => FAIXAS_CALOR.find((x) => x.id === id)?.nome.split(' ')[0] || id);
    add(`Calor: ${nomes.join(', ')}`, () => { f.calor = []; });
  }
  if (f.tags.length) {
    const nomes = f.tags.map((id) => tagPorId(id)?.nome || id);
    add(`Tags: ${nomes.join(', ')}`, () => { f.tags = []; });
  }
  if (f.periodo.de || f.periodo.ate) {
    const rot = f.periodo.de && f.periodo.ate
      ? `Criados ${dataCurta(f.periodo.de)} → ${dataCurta(f.periodo.ate)}`
      : f.periodo.de ? `Criados desde ${dataLonga(f.periodo.de)}`
        : `Criados até ${dataLonga(f.periodo.ate)}`;
    add(rot, () => { f.periodo.de = ''; f.periodo.ate = ''; });
  }
  if (f.parado.length) {
    const nomes = f.parado.map((id) => FAIXAS_PARADO.find((x) => x.id === id)?.nome || id);
    add(`Parado: ${nomes.join(', ')}`, () => { f.parado = []; });
  }
  if (f.busca) add(`Busca: "${f.busca}"`, () => { f.busca = ''; $('#busca').value = ''; });

  if (barra.childElementCount) {
    const lim = el('button', 'chip-limpar', 'Limpar tudo');
    lim.type = 'button';
    lim.addEventListener('click', () => {
      filtros = filtrosVazios();
      $('#busca').value = '';
      viewAtiva = null;
      aplicarFiltros();
    });
    barra.appendChild(lim);
  }

  if (viewAtiva) {
    const v = views.find((x) => x.id === viewAtiva);
    if (v && mesmosFiltros(filtros, v.f)) {
      const b = el('span', 'chip chip--view');
      b.appendChild(ico('book'));
      b.appendChild(el('span', null, v.nome));
      barra.insertBefore(b, barra.firstChild);
    }
  }
  barra.hidden = !barra.childElementCount;
}

function aplicarFiltros() {
  const n = contarFiltros();
  const cnt = $('#cnt-filtros');
  cnt.textContent = String(n);
  cnt.hidden = n === 0;
  renderChips();
  renderBoard();
}

// ─────────────────────────────────────────────────────────────
// Ficha do lead
// ─────────────────────────────────────────────────────────────
function faixaCalor(c) {
  if (c >= 9) return { nome: 'Ardente', cor: '#ef4444' };
  if (c >= 7) return { nome: 'Quente', cor: '#fb923c' };
  if (c >= 4) return { nome: 'Morno', cor: '#f6a823' };
  return { nome: 'Frio', cor: '#60a5fa' };
}

function cabecalhoBloco(icone, titulo, rotulo, aoClicar) {
  const h = el('div', 'blk-h');
  h.appendChild(ico(icone));
  h.appendChild(el('span', null, titulo));
  if (rotulo) {
    const b = el('button', 'edit', rotulo);
    b.type = 'button';
    b.addEventListener('click', aoClicar);
    h.appendChild(b);
  }
  return h;
}

function botao(txt, tipo, aoClicar) {
  const b = el('button', 'btn-sm' + (tipo === 'gold' ? ' btn-sm--gold' : ''), txt);
  b.type = 'button';
  b.addEventListener('click', aoClicar);
  return b;
}

function vazio(txt) {
  const v = el('div', 'vazio');
  v.appendChild(ico('plus'));
  v.appendChild(el('span', null, txt));
  return v;
}

function blocoValor(ent) {
  const b = el('div', 'blk');
  if (ent._editando === 'valor') {
    b.appendChild(cabecalhoBloco('money', 'Valor do negócio'));
    const row = el('div', 'ed-row');
    const inp = el('input', 'inp');
    inp.type = 'text';
    inp.value = ent.valor ? String(soNumero(ent.valor)) : '';
    inp.placeholder = '0';
    inp.setAttribute('aria-label', 'Valor em reais');
    row.appendChild(inp);
    row.appendChild(botao('Salvar', 'gold', () => {
      const n = soNumero(inp.value);
      ent.valor = n ? brl(n) : null;
      ent._editando = null;
      sincronizarValorDoCard();
      renderTrilhos(); renderBoard();
    }));
    row.appendChild(botao('Cancelar', null, () => { ent._editando = null; renderTrilhos(); }));
    b.appendChild(row);
    setTimeout(() => inp.focus(), 0);
    return b;
  }
  b.appendChild(cabecalhoBloco('money', 'Valor do negócio', ent.valor ? 'editar' : 'definir', () => {
    ent._editando = 'valor'; renderTrilhos();
  }));
  b.appendChild(ent.valor ? el('div', 'big-val', ent.valor) : vazio('Definir o valor deste negócio'));
  return b;
}

function recalcular(orc) {
  let unico = 0, mensal = 0;
  orc.itens.forEach((it) => {
    if (it.tipo === 'Rec.') mensal += it.unit * (it.qtd || 1);
    else unico += it.unit * (it.qtd || 1);
  });
  orc.total = brl(unico);
  orc.recorrente = mensal ? brl(mensal) + '/mês' : '—';
}

function sincronizarValorDoOrcamento(ent) {
  if (!ent.orcamento) return;
  ent.valor = ent.orcamento.itens.length ? ent.orcamento.total : null;
  sincronizarValorDoCard();
}

function sincronizarValorDoCard() {
  const lead = leadPorId(leadAberto);
  if (!lead) return;
  const ent = fichaDe(leadAberto).entradas.find((e) => e.funil === funilAtual);
  if (ent?.valor) lead.v = ent.valor;
}

function blocoOrcamento(ent) {
  const b = el('div', 'blk');
  const editando = ent._editando === 'orcamento';
  if (!ent.orcamento) ent.orcamento = { itens: [], total: 'R$ 0', recorrente: '—' };
  const orc = ent.orcamento;

  b.appendChild(cabecalhoBloco('box', 'Orçamento', editando ? 'concluir' : 'editar itens', () => {
    ent._editando = editando ? null : 'orcamento';
    renderTrilhos();
  }));

  if (!orc.itens.length && !editando) {
    b.appendChild(vazio('Nenhum produto — clique em "editar itens"'));
    return b;
  }

  const lista = el('div', 'itens');
  orc.itens.forEach((it, i) => {
    const linha = it.unit * (it.qtd || 1);
    const row = el('div', 'item');
    row.appendChild(el('span', 'q', `${it.qtd}×`));
    row.appendChild(el('span', 'nm', it.nome));
    row.appendChild(el('span', 'tp', it.tipo));
    const vl = el('span', 'vl', brl(linha) + (it.tipo === 'Rec.' ? '/mês' : ''));
    vl.title = `${it.qtd} × ${brl(it.unit)}`;
    row.appendChild(vl);
    if (editando) {
      const rm = el('button', 'rm');
      rm.type = 'button';
      rm.setAttribute('aria-label', `Remover ${it.nome}`);
      rm.appendChild(ico('x'));
      rm.addEventListener('click', () => {
        orc.itens.splice(i, 1);
        recalcular(orc); sincronizarValorDoOrcamento(ent);
        renderTrilhos(); renderBoard();
      });
      row.appendChild(rm);
    }
    lista.appendChild(row);
  });
  b.appendChild(lista);

  if (editando) b.appendChild(formProduto(ent, orc));

  if (orc.itens.length) {
    const tot = el('div', 'tot');
    tot.appendChild(el('span', 'k', `Total · recorrente ${orc.recorrente}`));
    tot.appendChild(el('span', 'v', orc.total));
    b.appendChild(tot);
  }
  return b;
}

function formProduto(ent, orc) {
  const box = el('div', 'add-prod');
  box.appendChild(el('div', 'add-t', 'Adicionar produto'));

  const l1 = el('div', 'ed-row');
  const nome = el('input', 'inp');
  nome.type = 'text';
  nome.placeholder = 'Buscar no catálogo ou digitar…';
  nome.setAttribute('list', 'catalogo');
  nome.setAttribute('aria-label', 'Produto');
  l1.appendChild(nome);
  box.appendChild(l1);

  const l2 = el('div', 'ed-row');
  const qtd = el('input', 'inp inp--mini');
  qtd.type = 'number'; qtd.min = '1'; qtd.value = '1';
  qtd.setAttribute('aria-label', 'Quantidade');
  l2.appendChild(qtd);

  const tipo = el('select', 'inp inp--mini');
  tipo.setAttribute('aria-label', 'Tipo');
  TIPOS.forEach((t) => {
    const o = el('option', null, t);
    o.value = t;
    tipo.appendChild(o);
  });
  l2.appendChild(tipo);

  const valor = el('input', 'inp');
  valor.type = 'text'; valor.placeholder = 'Valor unitário';
  valor.setAttribute('aria-label', 'Valor');
  l2.appendChild(valor);

  nome.addEventListener('input', () => {
    const p = CATALOGO.find((c) => norm(c.nome) === norm(nome.value.trim()));
    if (p) { tipo.value = p.tipo; valor.value = String(p.valor); }
  });

  const add = botao('Adicionar', 'gold', () => {
    const n = nome.value.trim();
    const v = soNumero(valor.value);
    if (!n) { nome.focus(); nome.classList.add('inp--erro'); return; }
    if (!v) { valor.focus(); valor.classList.add('inp--erro'); return; }
    orc.itens.push({ nome: n, qtd: Math.max(1, Number(qtd.value) || 1), tipo: tipo.value, unit: v });
    recalcular(orc); sincronizarValorDoOrcamento(ent);
    renderTrilhos(); renderBoard();
  });
  l2.appendChild(add);
  box.appendChild(l2);

  [nome, valor].forEach((i) => i.addEventListener('input', () => i.classList.remove('inp--erro')));
  [nome, valor].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); }));
  setTimeout(() => nome.focus(), 0);
  return box;
}

function blocoReuniao(ent) {
  const b = el('div', 'blk');
  if (ent._editando === 'reuniao') {
    b.appendChild(cabecalhoBloco('calendar', 'Reunião'));
    const row = el('div', 'ed-row');
    const data = el('input', 'inp');
    data.type = 'date';
    data.setAttribute('aria-label', 'Data da reunião');
    const hora = el('input', 'inp inp--mini');
    hora.type = 'time'; hora.value = '14:00';
    hora.setAttribute('aria-label', 'Hora da reunião');
    row.appendChild(data); row.appendChild(hora);
    row.appendChild(botao('Salvar', 'gold', () => {
      if (!data.value) { data.classList.add('inp--erro'); data.focus(); return; }
      const [a, m, d] = data.value.split('-');
      ent.reuniao = `${d}/${m}/${a} · ${hora.value} — link do Meet gerado`;
      ent._editando = null;
      renderTrilhos(); renderBoard();
    }));
    row.appendChild(botao('Cancelar', null, () => { ent._editando = null; renderTrilhos(); }));
    b.appendChild(row);
    setTimeout(() => data.focus(), 0);
    return b;
  }
  b.appendChild(cabecalhoBloco('calendar', 'Reunião', ent.reuniao ? 'remarcar' : 'adicionar', () => {
    ent._editando = 'reuniao'; renderTrilhos();
  }));
  b.appendChild(ent.reuniao ? el('div', 'nota', ent.reuniao) : vazio('Marcar reunião e gerar link do Meet'));
  return b;
}

// Data-alvo sem a mecânica de confirmação da Reunião: é só uma data que o
// vendedor promete. Editável de verdade — a pill aparece em todo lead agora,
// e pill que abre um painel só de leitura é promessa vazia.
function blocoCompromisso(ent) {
  const b = el('div', 'blk');
  if (ent._editando === 'compromisso') {
    b.appendChild(cabecalhoBloco('clock', 'Compromisso'));
    const row = el('div', 'ed-row');
    const data = el('input', 'inp');
    data.type = 'date';
    data.setAttribute('aria-label', 'Data-alvo');
    row.appendChild(data);
    row.appendChild(botao('Salvar', 'gold', () => {
      if (!data.value) { data.classList.add('inp--erro'); data.focus(); return; }
      const [a, m, d] = data.value.split('-');
      ent.compromisso = `${d}/${m}/${a}`;
      ent._editando = null;
      renderTrilhos(); renderBoard();
    }));
    row.appendChild(botao('Cancelar', null, () => { ent._editando = null; renderTrilhos(); }));
    if (ent.compromisso) {
      row.appendChild(botao('Limpar', null, () => {
        ent.compromisso = null;
        ent._editando = null;
        renderTrilhos(); renderBoard();
      }));
    }
    b.appendChild(row);
    data.addEventListener('input', () => data.classList.remove('inp--erro'));
    setTimeout(() => data.focus(), 0);
    return b;
  }
  b.appendChild(cabecalhoBloco('clock', 'Compromisso', ent.compromisso ? 'remarcar' : 'definir', () => {
    ent._editando = 'compromisso'; renderTrilhos();
  }));
  b.appendChild(ent.compromisso ? el('div', 'nota', ent.compromisso) : vazio('Definir uma data-alvo para este negócio'));
  return b;
}

function blocoNotas(ent) {
  const b = el('div', 'blk');
  if (ent._editando === 'notas') {
    b.appendChild(cabecalhoBloco('note', 'Notas'));
    const ta = el('textarea', 'inp inp--area');
    ta.rows = 3;
    ta.value = ent.notas || '';
    ta.setAttribute('aria-label', 'Notas deste funil');
    b.appendChild(ta);
    const row = el('div', 'ed-row');
    row.appendChild(botao('Salvar', 'gold', () => {
      ent.notas = ta.value.trim() || null;
      ent._editando = null;
      renderTrilhos(); renderBoard();
    }));
    row.appendChild(botao('Cancelar', null, () => { ent._editando = null; renderTrilhos(); }));
    b.appendChild(row);
    setTimeout(() => ta.focus(), 0);
    return b;
  }
  b.appendChild(cabecalhoBloco('note', 'Notas', ent.notas ? 'editar' : 'adicionar', () => {
    ent._editando = 'notas'; renderTrilhos();
  }));
  b.appendChild(ent.notas ? el('div', 'nota', ent.notas) : vazio('Anotar algo sobre este funil'));
  return b;
}

// ─────────────────────────────────────────────────────────────
// Ficha do lead — estrutura do LeadDetailDialogV2 (modal do sistema)
// Desktop sem abas: grid 7/5. Esquerda = CrossPipePanel + Info,
// direita = Checklist + Histórico & comentários.
// A generalização é nas ACTION PILLS: hoje o sistema tem duas
// hardcoded (Reunião no pipe_confirmacao, Orçamento no pipe_propostas).
// Aqui elas passam a ser os recursos que cada funil ligou.
// ─────────────────────────────────────────────────────────────

// Mesma forma de ETAPAS ({nome, cor, n}) para a aba Etapas poder editar
// qualquer funil com um só componente.
const paleta = ['#6366f1', '#f59e0b', '#3b82f6', '#22c55e', '#f97316', '#ef4444', '#8b5cf6', '#14b8a6'];
const comoEtapas = (nomes) => nomes.map((nome, i) => ({ nome, cor: paleta[i % paleta.length], n: 0 }));

const ETAPAS_OUTROS = {
  propostas: comoEtapas(['Marcar Compromisso', 'Reativar', 'Compromisso Marcado', 'Proposta Enviada', 'Esfriou', 'Futuro', 'Vendido ✓', 'Perdido']),
  giro: comoEtapas(['Novo', 'Em andamento', 'Concluído']),
  confirmacao: comoEtapas(['Reunião Marcada', 'Confirmar D-3', 'Confirmar D-1', 'Compareceu ✓', 'Perdido ✗']),
};

const stagesDoFunil = (id) => (id === 'qualificacao' ? ETAPAS : ETAPAS_OUTROS[id]);

// Lido na hora, não congelado no boot: a aba Etapas renomeia e reordena,
// e a trilha da ficha tem que acompanhar.
const etapasDoFunil = (id) => stagesDoFunil(id)?.map((e) => e.nome);

const PILL_META = {
  valor:       { ic: 'money',    rot: 'Valor' },
  orcamento:   { ic: 'box',      rot: 'Orçamento' },
  reuniao:     { ic: 'calendar', rot: 'Reunião' },
  notas:       { ic: 'note',     rot: 'Notas' },
  perda:       { ic: 'x',        rot: 'Motivo de perda' },
  compromisso: { ic: 'clock',    rot: 'Compromisso' },
};

function resumoPill(id, ent) {
  if (id === 'valor') return ent.valor || 'a definir';
  if (id === 'orcamento') return ent.orcamento?.itens?.length ? `${ent.orcamento.itens.length} itens` : 'a definir';
  if (id === 'reuniao') return ent.reuniao ? ent.reuniao.split(' —')[0] : 'sem data';
  if (id === 'notas') return ent.notas ? 'preenchida' : 'vazia';
  if (id === 'compromisso') return ent.compromisso || 'sem data';
  if (id === 'perda') return ent.perda || '—';
  return '';
}

function painelDoPill(id, ent) {
  if (id === 'valor') return blocoValor(ent);
  if (id === 'orcamento') return blocoOrcamento(ent);
  if (id === 'reuniao') return blocoReuniao(ent);
  if (id === 'notas') return blocoNotas(ent);
  if (id === 'compromisso') return blocoCompromisso(ent);
  const b = el('div', 'blk');
  b.appendChild(cabecalhoBloco('x', 'Motivo de perda'));
  b.appendChild(ent.perda ? el('div', 'nota', ent.perda) : vazio('Pedido ao mover para etapa de perda'));
  return b;
}

// ── Zona A — trilha de etapas ────────────────────────────────
function montarStageRail(ent) {
  const funil = FUNIS.find((f) => f.id === ent.funil);
  const etapas = etapasDoFunil(ent.funil) || [ent.etapa];
  const rail = el('div', 'srail');

  const cab = el('div', 'srail-h');
  const sw = el('span', 'sw');
  sw.style.background = funil.cor;
  cab.appendChild(sw);
  cab.appendChild(el('span', 'nm', funil.nome));
  cab.appendChild(el('span', 'ago', `nesta etapa ${ent.desde}`));
  rail.appendChild(cab);

  const trilha = el('div', 'trilha');
  trilha.setAttribute('role', 'tablist');
  trilha.setAttribute('aria-label', `Etapas de ${funil.nome}`);
  const atual = etapas.indexOf(ent.etapa);
  etapas.forEach((nome, i) => {
    const b = el('button', 'stg' + (i === atual ? ' stg--on' : i < atual ? ' stg--feita' : ''));
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === atual));
    b.textContent = nome;
    b.addEventListener('click', () => {
      ent.etapa = nome;
      ent.desde = 'agora';
      moverNoBoard(ent, nome);
      renderPipes();
      avisar(`${leadPorId(leadAberto).n} → ${nome}`);
    });
    trilha.appendChild(b);
  });
  rail.appendChild(trilha);
  return rail;
}

// Mover pela ficha reflete no board, quando é o funil aberto
function moverNoBoard(ent, nomeEtapa) {
  if (ent.funil !== funilAtual) return;
  const destino = ETAPAS.findIndex((e) => e.nome === nomeEtapa);
  if (destino < 0) return;
  for (let i = 0; i < LEADS.length; i++) {
    const pos = LEADS[i].findIndex((l) => l.id === leadAberto);
    if (pos < 0) continue;
    if (i === destino) return;
    const [lead] = LEADS[i].splice(pos, 1);
    lead.d = 'agora';
    LEADS[destino].unshift(lead);
    ETAPAS[i].n = Math.max(0, ETAPAS[i].n - 1);
    ETAPAS[destino].n += 1;
    renderBoard();
    return;
  }
}

// ── CrossPipePanel completo ──────────────────────────────────
function renderPipes() {
  const ficha = fichaDe(leadAberto);
  const alvo = $('#f-pipes');
  alvo.textContent = '';

  if (!ficha.entradas.length) {
    alvo.appendChild(el('div', 'vazio-sec', 'Sem pipes ainda'));
    return;
  }

  ficha.entradas.forEach((ent) => {
    const bloco = el('div', 'pipe-bloco');
    bloco.appendChild(montarStageRail(ent));

    const cfg = CONFIG_FUNIL[ent.funil] || {};
    const ligados = Object.keys(PILL_META).filter((id) => cfg[id]?.on);

    if (ent.bloqueado) {
      const t = el('div', 'trava');
      t.appendChild(ico('warn'));
      const txt = el('div');
      txt.innerHTML =
        '<b>Recursos indisponíveis neste funil.</b> Valor, orçamento e reunião não têm onde ser gravados: ' +
        '<code>custom_pipe_entries</code> não tem a coluna <code>metadata jsonb</code> que os funis de sistema usam.';
      t.appendChild(txt);
      bloco.appendChild(t);
    }

    if (ligados.length) {
      const pills = el('div', 'pills');
      ligados.forEach((id) => {
        const meta = PILL_META[id];
        const aberta = ent._pill === id;
        const b = el('button', 'pill-a' + (aberta ? ' pill-a--on' : ''));
        b.type = 'button';
        b.setAttribute('aria-expanded', String(aberta));
        b.appendChild(ico(meta.ic));
        b.appendChild(el('span', 'r', meta.rot));
        b.appendChild(el('span', 'v', resumoPill(id, ent)));
        b.addEventListener('click', () => {
          ent._pill = aberta ? null : id;
          ent._editando = null;
          renderPipes();
        });
        pills.appendChild(b);
      });
      bloco.appendChild(pills);

      if (ent._pill) {
        const painel = el('div', 'apainel');
        painel.appendChild(painelDoPill(ent._pill, ent));
        bloco.appendChild(painel);
      }
    } else if (!ent.bloqueado) {
      const v = el('div', 'vazio');
      v.appendChild(ico('gear'));
      v.appendChild(el('span', null, 'Nenhum recurso ligado neste funil — ligue em Configurações.'));
      bloco.appendChild(v);
    }

    alvo.appendChild(bloco);
  });

  // Zona C — "Adicionar a"
  const usados = new Set(ficha.entradas.map((e) => e.funil));
  const faltando = FUNIS.filter((f) => !usados.has(f.id));
  if (faltando.length) {
    const tira = el('div', 'add-pipe');
    tira.appendChild(el('span', 'add-r', 'Adicionar a'));
    faltando.slice(0, 5).forEach((f) => {
      const c = el('button', 'chip-add');
      c.type = 'button';
      const sw = el('span', 'sw');
      sw.style.background = f.cor;
      c.appendChild(sw);
      c.appendChild(el('span', null, f.nome));
      c.addEventListener('click', () => {
        const etapas = etapasDoFunil(f.id) || ['Novo'];
        ficha.entradas.push({
          funil: f.id, etapa: etapas[0], desde: 'agora',
          valor: null, notas: null, reuniao: null,
          bloqueado: f.tipo !== 'sistema',
        });
        renderPipes();
        avisar(`Adicionado a ${f.nome}`);
      });
      tira.appendChild(c);
    });
    alvo.appendChild(tira);
  }
}

// ── LeadInfoColumn ───────────────────────────────────────────
function linhaInfo(k, v) {
  const r = el('div', 'inf-r');
  r.appendChild(el('span', 'k', k));
  r.appendChild(el('span', 'v', v));
  return r;
}

function renderInfo() {
  const lead = leadPorId(leadAberto);
  const ficha = fichaDe(leadAberto);
  const alvo = $('#f-info');
  alvo.textContent = '';

  // 1. Informações do lead — só campos preenchidos
  const s1 = el('div', 'inf-sec');
  s1.appendChild(el('h3', 'inf-t', 'Informações do lead'));
  const preenchidos = [
    ['Nome', lead.n], ['Empresa', lead.e], ['Telefone', lead.t], ['Email', ficha.email],
    ...Object.entries(ficha.info).filter(([, v]) => v && v !== '—'),
  ];
  preenchidos.forEach(([k, v]) => s1.appendChild(linhaInfo(k, v)));
  alvo.appendChild(s1);

  // 2. Campos personalizados
  const comValor = CAMPOS_CUSTOM.filter((c) => ficha.custom[c.id]);
  if (comValor.length) {
    const s2 = el('div', 'inf-sec');
    s2.appendChild(el('h3', 'inf-t', 'Campos personalizados'));
    comValor.forEach((c) => s2.appendChild(linhaInfo(c.nome, ficha.custom[c.id])));
    alvo.appendChild(s2);
  }

  // 3. Faltam informações (N) — ou "Lead completo"
  const faltam = CAMPOS_CUSTOM.filter((c) => !ficha.custom[c.id]).map((c) => c.nome)
    .concat(Object.entries(ficha.info).filter(([, v]) => !v || v === '—').map(([k]) => k));
  const s3 = el('div', 'inf-sec');
  if (faltam.length) {
    s3.appendChild(el('h3', 'inf-t', `Faltam informações (${faltam.length})`));
    faltam.slice(0, 3).forEach((n) => {
      const b = el('button', 'inf-falta');
      b.type = 'button';
      b.appendChild(ico('plus'));
      b.appendChild(el('span', null, `adicionar ${n.toLowerCase()}`));
      s3.appendChild(b);
    });
    if (faltam.length > 3) {
      const m = el('button', 'inf-mais', `Mostrar mais (${faltam.length - 3})`);
      m.type = 'button';
      s3.appendChild(m);
    }
  } else {
    s3.appendChild(el('h3', 'inf-t', 'Lead completo'));
    s3.appendChild(el('p', 'inf-ok', 'Todas as informações preenchidas.'));
  }
  alvo.appendChild(s3);

  // 4. Tracking
  const s4 = el('div', 'inf-sec');
  s4.appendChild(el('h3', 'inf-t', 'Tracking'));
  s4.appendChild(linhaInfo('Criado em', ficha.criadoEm));
  Object.entries(ficha.tracking).forEach(([k, v]) => {
    if (k === 'Origem') {
      const r = el('div', 'inf-r');
      r.appendChild(el('span', 'k', 'Origem'));
      const org = ORIGEM[v];
      const bd = el('span', 'bdg', v);
      if (org) { bd.style.color = org.fg; bd.style.background = org.bg; bd.style.borderColor = org.fg + '40'; }
      r.appendChild(bd);
      s4.appendChild(r);
    } else {
      s4.appendChild(linhaInfo(k, v));
    }
  });
  alvo.appendChild(s4);
}

// ── Checklist ────────────────────────────────────────────────
function renderCheck() {
  const ficha = fichaDe(leadAberto);
  const alvo = $('#f-check');
  alvo.textContent = '';

  const itens = ficha.checklists.flatMap((c) => c.itens);
  const feitos = itens.filter((i) => i.ok).length;

  const cab = el('div', 'sec-h');
  cab.appendChild(el('h3', null, 'Checklist'));
  if (itens.length) cab.appendChild(el('span', 'sec-n', `${feitos}/${itens.length}`));
  const novo = el('button', 'sec-acao', 'Novo');
  novo.type = 'button';
  cab.appendChild(novo);
  alvo.appendChild(cab);

  if (!ficha.checklists.length) {
    alvo.appendChild(vazio('Adicionar checklist'));
    return;
  }

  const barra = el('div', 'prog');
  const fill = el('span');
  fill.style.width = itens.length ? `${(feitos / itens.length) * 100}%` : '0%';
  barra.appendChild(fill);
  alvo.appendChild(barra);

  ficha.checklists.forEach((c) => {
    const bloco = el('div', 'chk-bloco');
    bloco.appendChild(el('div', 'chk-t', c.titulo));
    c.itens.forEach((it) => {
      const l = el('button', 'chk-i' + (it.ok ? ' chk-i--ok' : ''));
      l.type = 'button';
      l.setAttribute('role', 'checkbox');
      l.setAttribute('aria-checked', String(it.ok));
      const box = el('span', 'box');
      box.appendChild(ico('check'));
      l.appendChild(box);
      l.appendChild(el('span', 'txt', it.txt));
      l.addEventListener('click', () => { it.ok = !it.ok; renderCheck(); });
      bloco.appendChild(l);
    });
    alvo.appendChild(bloco);
  });
}

// ── Histórico & comentários ──────────────────────────────────
let filtroFeed = 'Todos';

function renderHist() {
  const ficha = fichaDe(leadAberto);
  const alvo = $('#f-hist');
  alvo.textContent = '';

  const cab = el('div', 'sec-h');
  cab.appendChild(el('h3', null, 'Histórico & comentários'));
  alvo.appendChild(cab);

  // Composer
  const comp = el('div', 'composer');
  const ta = el('textarea', 'inp inp--area');
  ta.rows = 2;
  ta.placeholder = 'Escreva um comentário…  use @ para mencionar.';
  ta.setAttribute('aria-label', 'Novo comentário');
  comp.appendChild(ta);
  const rod = el('div', 'composer-r');
  rod.appendChild(el('span', 'dica', '⌘/Ctrl + Enter para publicar'));
  const pub = botao('Publicar', 'gold', () => {
    const txt = ta.value.trim();
    if (!txt) { ta.focus(); return; }
    ficha.comentarios.unshift({ autor: 'Lucas M.', ini: 'LM', quando: 'agora', txt });
    renderHist();
    avisar('Comentário publicado');
  });
  rod.appendChild(pub);
  comp.appendChild(rod);
  ta.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') pub.click();
  });
  alvo.appendChild(comp);

  // Filtros do feed
  const fl = el('div', 'feed-f');
  FILTROS_FEED.forEach((f) => {
    const b = el('button', 'ff' + (f === filtroFeed ? ' ff--on' : ''), f);
    b.type = 'button';
    b.addEventListener('click', () => { filtroFeed = f; renderHist(); });
    fl.appendChild(b);
  });
  alvo.appendChild(fl);

  // Feed
  const feed = el('div', 'feed');
  const mostraCom = filtroFeed === 'Todos' || filtroFeed === 'Comentários';
  const eventos = [];
  if (mostraCom) ficha.comentarios.forEach((c) => eventos.push({ tipo: 'com', ...c }));
  ficha.timeline.forEach((t) => {
    if (filtroFeed === 'Todos' || filtroFeed === t.fonte) eventos.push({ tipo: 'ev', ...t });
  });

  if (!eventos.length) {
    feed.appendChild(el('p', 'feed-vazio', filtroFeed === 'Comentários'
      ? 'Nenhum comentário ainda.'
      : 'Nada por aqui.'));
  }

  eventos.forEach((ev) => {
    if (ev.tipo === 'com') {
      const c = el('div', 'com');
      const av = el('span', 'com-av', ev.ini);
      av.style.background = corIniciais(ev.ini);
      c.appendChild(av);
      const corpo = el('div', 'com-b');
      const h = el('div', 'com-h');
      h.appendChild(el('span', 'a', ev.autor));
      h.appendChild(el('span', 'q', ev.quando));
      corpo.appendChild(h);
      const p = el('p', 'com-t');
      // realça @menção
      ev.txt.split(/(@[\wÀ-ú]+(?:\s[A-ZÀ-Ú][\wÀ-ú]+)?)/g).forEach((parte) => {
        if (parte.startsWith('@')) p.appendChild(el('b', 'mencao', parte));
        else p.appendChild(document.createTextNode(parte));
      });
      corpo.appendChild(p);
      c.appendChild(corpo);
      feed.appendChild(c);
    } else {
      const e2 = el('div', 'ev');
      e2.appendChild(el('span', 'ev-f', ev.fonte));
      e2.appendChild(el('span', 'ev-t', ev.txt));
      e2.appendChild(el('span', 'ev-q', ev.quando));
      feed.appendChild(e2);
    }
  });
  alvo.appendChild(feed);
}

// ── Abertura ─────────────────────────────────────────────────
function slot(rot, valor, cor) {
  const s = el('button', 'slot');
  s.type = 'button';
  s.appendChild(el('span', 'slot-r', rot));
  if (valor) {
    const v = el('span', 'slot-v', valor);
    if (cor) v.style.color = cor;
    s.appendChild(v);
  } else {
    s.appendChild(el('span', 'slot-v slot-v--vazio', 'definir'));
  }
  return s;
}

function renderTrilhos() { renderPipes(); }

function abrirFicha(leadId) {
  const lead = leadPorId(leadId);
  if (!lead) return;
  leadAberto = leadId;
  const ficha = fichaDe(leadId);
  ficha.entradas.forEach((e) => { e._editando = null; });
  filtroFeed = 'Todos';

  const av = $('#f-av');
  av.textContent = lead.n.split(' ').map((p) => p[0]).slice(0, 2).join('');
  av.style.background = corIniciais(lead.n.slice(0, 2).toUpperCase());
  $('#f-nome').textContent = lead.n;

  const meta = $('#f-meta');
  meta.textContent = '';
  meta.appendChild(el('span', null, lead.e));
  meta.appendChild(el('span', 'ponto', '·'));
  meta.appendChild(el('span', 'fone', lead.t));
  meta.appendChild(el('span', 'ponto', '·'));
  const idade = el('span', 'idade', ficha.idade);
  idade.title = `Criado em ${ficha.criadoEm}`;
  meta.appendChild(idade);
  const fx = faixaCalor(lead.c);
  const cal = el('span', 'calor');
  cal.style.color = fx.cor;
  cal.style.borderColor = fx.cor + '55';
  cal.style.background = fx.cor + '18';
  cal.appendChild(ico('flame'));
  cal.appendChild(el('span', null, `${fx.nome} ${lead.c}`));
  meta.appendChild(cal);

  // Responsáveis
  const resp = $('#f-resp');
  resp.textContent = '';
  [['Pré-Venda', ficha.preVenda], ['Venda', ficha.venda]].forEach(([rot, ini]) => {
    const m = EQUIPE.find((x) => x.ini === ini);
    resp.appendChild(slot(rot, m ? m.nome : null));
  });

  // Qualificação
  const qual = $('#f-qual');
  qual.textContent = '';
  [['Pré-Qualificação', ficha.preQual], ['Qualificação', ficha.qual]].forEach(([rot, id]) => {
    const t = TIERS.find((x) => x.id === id);
    qual.appendChild(slot(rot, t ? t.nome : null, t?.cor));
  });

  // Tags
  const tags = $('#f-tags');
  tags.textContent = '';
  if (lead.tg.length) {
    lead.tg.forEach((id) => {
      const t = tagPorId(id);
      if (!t) return;
      const chip = el('span', 'tagchip', t.nome);
      chip.style.color = t.cor;
      chip.style.borderColor = t.cor + '55';
      chip.style.background = t.cor + '18';
      tags.appendChild(chip);
    });
  } else {
    tags.appendChild(el('span', 'sem-tag', 'Sem tags'));
  }
  const addTag = el('button', 'add-tag');
  addTag.type = 'button';
  addTag.appendChild(ico('plus'));
  addTag.appendChild(el('span', null, 'Tag'));
  tags.appendChild(addTag);

  renderPipes();
  renderInfo();
  renderCheck();
  renderHist();
  abrir('#ov-ficha');
}

// ─────────────────────────────────────────────────────────────
// Configurações do funil
// ─────────────────────────────────────────────────────────────
const ABAS_CFG = [
  { id: 'etapas',   rot: 'Etapas' },
  { id: 'recursos', rot: 'Recursos' },
  { id: 'distrib',  rot: 'Distribuição' },
  { id: 'autom',    rot: 'Automações' },
];

function renderConfig() {
  const funil = FUNIS.find((f) => f.id === funilAtual);
  const custom = funil.tipo !== 'sistema';

  $('#c-nome').textContent = `Configurações — ${funil.nome}`;
  $('#c-tipo').textContent = custom
    ? (funil.tipo === 'prazo' ? 'Funil com prazo' : 'Funil customizado')
    : 'Funil de sistema';

  const tabs = $('#c-tabs');
  tabs.textContent = '';
  ABAS_CFG.forEach((a) => {
    const b = el('button', 'cfg-tab' + (a.id === abaCfg ? ' on' : ''), a.rot);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(a.id === abaCfg));
    b.addEventListener('click', () => { abaCfg = a.id; renderConfig(); });
    tabs.appendChild(b);
  });

  const body = $('#c-body');
  body.textContent = '';
  if (abaCfg === 'recursos') painelRecursos(body, funil, custom);
  else if (abaCfg === 'etapas') painelEtapas(body, funil, custom);
  else painelPendente(body, abaCfg);
}

function painelPendente(body, id) {
  const nome = ABAS_CFG.find((a) => a.id === id).rot;
  const v = el('div', 'cfg-pendente');
  v.appendChild(ico('gear'));
  v.appendChild(el('b', null, `${nome} — fora do escopo deste protótipo.`));
  v.appendChild(el('span', null, id === 'distrib'
    ? 'A distribuição (round-robin, carga, por origem) não muda com o redesign: a tela é a mesma de hoje.'
    : 'As automações do funil continuam no editor atual; o redesign não encosta nelas.'));
  body.appendChild(v);
}

// ── Aba Etapas ───────────────────────────────────────────────
function painelEtapas(body, funil, custom) {
  const stages = stagesDoFunil(funil.id);
  const noBoard = funil.id === 'qualificacao';   // o único com leads no protótipo

  const intro = el('p', 'cfg-intro');
  intro.innerHTML = noBoard
    ? 'Renomear, reordenar, recolorir e excluir etapa. O board redesenha na hora.'
    : 'Este funil não tem dados no protótipo — as mudanças aqui aparecem na <b style="color:var(--fg)">trilha de etapas dentro da ficha</b> do lead, não no board.';
  body.appendChild(intro);

  if (!stages) {
    body.appendChild(el('div', 'cfg-pendente', 'Funil sem etapas no protótipo.'));
    return;
  }

  const lista = el('div', 'etp-lista');

  stages.forEach((et, i) => {
    const row = el('div', 'etp');

    const cor = el('button', 'etp-cor');
    cor.type = 'button';
    cor.style.background = et.cor;
    cor.setAttribute('aria-label', `Cor da etapa ${et.nome}`);
    cor.addEventListener('click', (e) => abrirMenuFlut(e.currentTarget, paleta.map((c) => ({
      cor: c, rot: c, on: c === et.cor,
      ao: () => { et.cor = c; renderConfig(); renderBoard(); },
    })), 'Cor'));
    row.appendChild(cor);

    const nome = el('input', 'inp etp-nome');
    nome.type = 'text';
    nome.value = et.nome;
    nome.setAttribute('aria-label', `Nome da etapa ${i + 1}`);
    // `input` e não `change`: o board e a trilha da ficha acompanham a digitação.
    nome.addEventListener('input', () => {
      const antigo = et.nome;
      et.nome = nome.value || 'Sem nome';
      renomearNasFichas(funil.id, antigo, et.nome);
      renderBoard();
      if (leadAberto) renderTrilhos();
    });
    row.appendChild(nome);

    // SLA vive em pipeline_stages, tabela que só os funis de sistema usam —
    // a trava 5. Em funil custom o campo aparece desligado, com o motivo.
    const sla = el('label', 'etp-sla' + (custom ? ' etp-sla--off' : ''));
    sla.appendChild(el('span', null, 'alerta em'));
    const dias = el('input', 'inp inp--mini');
    dias.type = 'number';
    dias.min = '0';
    dias.value = String(et.sla ?? '');
    dias.placeholder = '—';
    dias.disabled = custom;
    dias.setAttribute('aria-label', `Dias de SLA da etapa ${et.nome}`);
    dias.addEventListener('input', () => { et.sla = Number(dias.value) || null; });
    sla.appendChild(dias);
    sla.appendChild(el('span', null, 'd'));
    if (custom) sla.title = 'SLA e envelhecimento vivem em pipeline_stages, que os funis custom não usam (custom_pipeline_stages não tem esses campos).';
    row.appendChild(sla);

    // Funil sem board no protótipo ainda tem ocupação: os leads que têm uma
    // ENTRADA nele, dentro das fichas. Mostrar '—' aqui escondia isso e fazia
    // a recusa de excluir etapa ocupada passar batido logo abaixo.
    const nEt = noBoard ? (LEADS[i] || []).length : contarNasFichas(funil.id, et.nome);
    const qtd = el('span', 'etp-q', String(nEt));
    qtd.title = 'Negócios nesta etapa';
    row.appendChild(qtd);

    const mover = (delta) => {
      const j = i + delta;
      if (j < 0 || j >= stages.length) return;
      [stages[i], stages[j]] = [stages[j], stages[i]];
      if (noBoard) { [LEADS[i], LEADS[j]] = [LEADS[j], LEADS[i]]; trocarOrdem(i, j); }
      renderConfig();
      renderBoard();
      if (leadAberto) renderTrilhos();
    };

    const cima = el('button', 'etp-b');
    cima.type = 'button';
    cima.disabled = i === 0;
    cima.setAttribute('aria-label', `Subir ${et.nome}`);
    cima.appendChild(ico('up'));
    cima.addEventListener('click', () => mover(-1));
    row.appendChild(cima);

    const baixo = el('button', 'etp-b');
    baixo.type = 'button';
    baixo.disabled = i === stages.length - 1;
    baixo.setAttribute('aria-label', `Descer ${et.nome}`);
    baixo.appendChild(ico('chev'));
    baixo.addEventListener('click', () => mover(1));
    row.appendChild(baixo);

    const rm = el('button', 'etp-b etp-b--rm');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Excluir ${et.nome}`);
    rm.appendChild(ico('trash'));
    rm.addEventListener('click', () => {
      if (nEt) {
        avisar(`Mova ${nEt === 1 ? 'o negócio' : `os ${nEt} negócios`} antes de excluir "${et.nome}"`);
        return;
      }
      if (stages.length <= 1) { avisar('Um funil precisa de pelo menos uma etapa'); return; }
      stages.splice(i, 1);
      if (noBoard) { LEADS.splice(i, 1); reindexarOrdem(i, -1); }
      renderConfig();
      renderBoard();
      if (leadAberto) renderTrilhos();
      avisar(`Etapa "${et.nome}" excluída`);
    });
    row.appendChild(rm);

    lista.appendChild(row);
  });

  body.appendChild(lista);

  const add = el('button', 'etp-add');
  add.type = 'button';
  add.appendChild(ico('plus'));
  add.appendChild(el('span', null, 'Nova etapa'));
  add.addEventListener('click', () => {
    stages.push({ nome: 'Nova etapa', cor: paleta[stages.length % paleta.length], n: 0 });
    if (noBoard) LEADS.push([]);
    renderConfig();
    renderBoard();
    // Foca o campo recém-criado pra já sair digitando o nome.
    const campos = $$('.etp-nome', body);
    campos[campos.length - 1]?.select();
  });
  body.appendChild(add);

  const nota = el('div', 'cfg-trava');
  nota.appendChild(ico('warn'));
  const t = el('div');
  t.innerHTML =
    '<b>Toda feature de etapa é escrita duas vezes hoje.</b> <code>pipeline_stages</code> é chaveada por ' +
    '<code>(organization_id, pipeline_type)</code> e não tem <code>pipeline_id</code>; ' +
    '<code>custom_pipeline_stages</code> é por <code>pipeline_id</code>. SLA e envelhecimento só existem na ' +
    'primeira — por isso o campo acima fica travado em funil custom.';
  nota.appendChild(t);
  body.appendChild(nota);
}

// Quantos leads têm uma entrada nesta etapa, contando pelas FICHAS. É a única
// fonte para os funis que não têm board no protótipo.
const contarNasFichas = (funilId, etapa) =>
  Object.values(FICHAS).filter((f) =>
    f.entradas?.some((e) => e.funil === funilId && e.etapa === etapa)).length;

// Renomear etapa não pode deixar a ficha apontando pro nome velho: a trilha
// casa por texto, e o lead ficaria sem etapa marcada.
function renomearNasFichas(funilId, antigo, novo) {
  Object.values(FICHAS).forEach((f) => {
    f.entradas?.forEach((e) => {
      if (e.funil === funilId && e.etapa === antigo) e.etapa = novo;
    });
  });
}

// ── Aba Recursos ─────────────────────────────────────────────
function painelRecursos(body, funil, custom) {
  const cfg = CONFIG_FUNIL[funilAtual] || (CONFIG_FUNIL[funilAtual] = {});

  const intro = el('p', 'cfg-intro');
  intro.innerHTML =
    'Cada recurso ligado aqui aparece na ficha de <b style="color:var(--fg)">todo lead</b> deste funil. ' +
    '<b style="color:var(--fg)">No card</b> resume o dado no kanban — deixe desligado o que não vale ' +
    'ocupar espaço no board.';
  body.appendChild(intro);

  RECURSOS.forEach((r) => {
    const st = cfg[r.id] || (cfg[r.id] = { on: false, card: false });
    const travado = custom && r.travaCustom;
    const row = el('div', 'rec');

    const icw = el('div', 'rec-ic');
    icw.appendChild(ico(r.icone));
    row.appendChild(icw);

    const txt = el('div', 'rec-txt');
    txt.appendChild(el('div', 'rec-nm', r.nome));
    txt.appendChild(el('div', 'rec-ds', travado
      ? (r.travaForte
        ? 'Impossível hoje: os itens são presos por chave estrangeira à tabela dos funis de sistema.'
        : 'Indisponível hoje: este tipo de funil não tem onde gravar o dado.')
      : r.desc));
    txt.appendChild(el('div', 'rec-mora', r.moraEm));
    row.appendChild(txt);

    const ctl = el('div', 'rec-ctl');
    const sw = el('button', 'sw-t');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', `Ligar ${r.nome}`);
    sw.disabled = travado;
    ctl.appendChild(sw);

    const chk = el('button', 'chk');
    chk.type = 'button';
    chk.setAttribute('role', 'checkbox');
    const box = el('span', 'box');
    box.appendChild(ico('check'));
    chk.appendChild(box);
    chk.appendChild(el('span', null, 'no card'));
    ctl.appendChild(chk);

    const pintar = () => {
      const ligado = !!st.on && !travado;
      row.className = 'rec' + (ligado ? ' rec--on' : ' rec--off') + (travado ? ' rec--travado' : '');
      sw.setAttribute('aria-checked', String(ligado));
      chk.setAttribute('aria-checked', String(!!st.card && ligado));
      if (travado || !st.on) chk.setAttribute('disabled', '');
      else chk.removeAttribute('disabled');
    };
    pintar();

    sw.addEventListener('click', () => {
      st.on = !st.on;
      if (!st.on) st.card = false;
      pintar(); renderBoard();
      if (leadAberto) renderTrilhos();
    });
    chk.addEventListener('click', () => {
      if (travado || !st.on) return;
      st.card = !st.card;
      pintar(); renderBoard();
    });

    row.appendChild(ctl);
    body.appendChild(row);
  });
}

// ─────────────────────────────────────────────────────────────
// Menu flutuante — kebab do card e da coluna, e a barra de massa
//
// Diferente dos popovers da faixa (que são ancorados no CSS dentro de
// .pop-wrap), estes nascem em qualquer canto da tela, inclusive dentro de
// uma coluna com overflow. Por isso vivem no <body> com position:fixed e
// são posicionados na mão, com recorte na borda da janela.
// ─────────────────────────────────────────────────────────────
let menuFlut = null;

function fecharMenuFlut() {
  if (!menuFlut) return;
  menuFlut.no.remove();
  menuFlut.ancora?.setAttribute('aria-expanded', 'false');
  menuFlut = null;
}

function abrirMenuFlut(ancora, itens, titulo) {
  const jaAberto = menuFlut?.ancora === ancora;
  fecharPop();
  fecharMenuFlut();
  if (jaAberto) return;

  const no = el('div', 'mflut');
  no.setAttribute('role', 'menu');
  document.body.appendChild(no);
  menuFlut = { no, ancora };
  ancora.setAttribute('aria-expanded', 'true');
  pintarMenuFlut(itens, titulo, null);
  // Leva o foco pra dentro, como abrirPop já faz com os popovers da faixa.
  // Sem isso o Tab continua no card atrás e o menu é inalcançável por teclado.
  no.querySelector('.mf-i:not(:disabled)')?.focus();
}

// `fonte` pode ser um array ou uma função que devolve o array. Precisa ser
// função quando os itens têm estado (a marca de "atribuído a todos"): repintar
// o mesmo array congelaria a marca no valor de antes do clique.
function pintarMenuFlut(fonte, titulo, voltar) {
  const itens = typeof fonte === 'function' ? fonte() : fonte;
  const no = menuFlut.no;
  no.textContent = '';

  if (voltar) {
    const b = el('button', 'mf-voltar');
    b.type = 'button';
    b.appendChild(ico('back'));
    b.appendChild(el('span', null, titulo));
    b.addEventListener('click', voltar);
    no.appendChild(b);
  } else if (titulo) {
    no.appendChild(el('div', 'mf-t', titulo));
  }

  itens.forEach((it) => {
    if (it.sep) { no.appendChild(el('div', 'mf-sep')); return; }
    if (it.nota) { no.appendChild(el('div', 'mf-nota', it.nota)); return; }

    const b = el('button', 'mf-i' + (it.perigo ? ' mf-i--perigo' : '') + (it.on ? ' mf-i--on' : ''));
    b.type = 'button';
    b.setAttribute('role', it.on == null ? 'menuitem' : 'menuitemcheckbox');
    if (it.on != null) b.setAttribute('aria-checked', String(it.on));
    b.disabled = !!it.off;

    if (it.cor) {
      const d = el('span', 'mf-dot');
      d.style.background = it.cor;
      b.appendChild(d);
    } else if (it.ic) {
      b.appendChild(ico(it.ic));
    }
    b.appendChild(el('span', 'r', it.rot));
    if (it.dir) b.appendChild(el('span', 'dir', it.dir));
    if (it.sub) b.appendChild(ico('chev', 'mf-mais'));
    if (it.on) b.appendChild(ico('check', 'mf-ck'));

    b.addEventListener('click', () => {
      if (it.sub) {
        pintarMenuFlut(it.sub, it.rot, () => pintarMenuFlut(fonte, titulo, voltar));
        return;
      }
      const fica = it.ao?.();
      if (fica === 'ficar') {
        // Toggle de marcar/desmarcar: redesenha o mesmo nível em vez de fechar.
        pintarMenuFlut(fonte, titulo, voltar);
        return;
      }
      fecharMenuFlut();
    });
    no.appendChild(b);
  });

  posicionarMenuFlut();
}

function posicionarMenuFlut() {
  const { no, ancora } = menuFlut;
  // Item que devolve 'ficar' (marcar tag, atribuir responsável) chama
  // renderBoard antes de repintar o menu — e renderBoard reconstrói o card e
  // a barra, destruindo o botão que serve de âncora. Medir um nó fora do
  // documento devolve DOMRect(0,0,0,0) e joga o menu no canto superior
  // esquerdo. Sem âncora viva, fica onde já estava.
  if (!ancora.isConnected) return;
  const a = ancora.getBoundingClientRect();
  const m = no.getBoundingClientRect();
  const marg = 8;
  // Alinha a direita do menu com a direita do botão; se estourar à esquerda,
  // gruda na margem. Vertical: abaixo, ou acima quando não cabe.
  let x = a.right - m.width;
  if (x < marg) x = marg;
  if (x + m.width > innerWidth - marg) x = innerWidth - marg - m.width;
  let y = a.bottom + 6;
  if (y + m.height > innerHeight - marg) y = Math.max(marg, a.top - m.height - 6);
  no.style.left = Math.round(x) + 'px';
  no.style.top = Math.round(y) + 'px';
}

document.addEventListener('mousedown', (e) => {
  if (!menuFlut) return;
  if (menuFlut.no.contains(e.target) || menuFlut.ancora.contains(e.target)) return;
  fecharMenuFlut();
});
addEventListener('resize', fecharMenuFlut);

// Rolar a coluna leva o botão junto e o menu ficaria órfão no meio da tela.
// Fechar na primeira rolagem é frágil: o próprio menu rola (max-height +
// overflow) e o navegador rola sozinho pra revelar o item focado, o que
// fecharia o menu no meio de um clique. Então acompanha em vez de fechar,
// e só desiste quando o botão de origem sai de vista.
document.addEventListener('scroll', () => {
  if (!menuFlut) return;
  if (!menuFlut.ancora.isConnected) return;
  const a = menuFlut.ancora.getBoundingClientRect();
  const some = a.bottom < 0 || a.top > innerHeight || a.right < 0 || a.left > innerWidth;
  if (some) fecharMenuFlut();
  else posicionarMenuFlut();
}, true);

// ─────────────────────────────────────────────────────────────
// Seleção múltipla
// ─────────────────────────────────────────────────────────────
function alternarSelecao(id, idsVisiveis, shift) {
  if (shift && ancoraSel && idsVisiveis) {
    const a = idsVisiveis.indexOf(ancoraSel);
    const b = idsVisiveis.indexOf(id);
    if (a > -1 && b > -1) {
      idsVisiveis.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => selecao.add(x));
      renderBoard();
      return;
    }
  }
  if (selecao.has(id)) selecao.delete(id);
  else { selecao.add(id); ancoraSel = id; }
  renderBoard();
}

const leadsSelecionados = () => [...selecao].map(leadPorId).filter(Boolean);

function limparSelecao() {
  selecao.clear();
  ancoraSel = null;
  renderBoard();
}

// Etapa em que o lead está hoje — usado no CSV e na visão Lista.
function etapaDoLead(id) {
  const i = LEADS.findIndex((col) => col.some((l) => l.id === id));
  return i < 0 ? null : { i, nome: ETAPAS[i].nome, cor: ETAPAS[i].cor };
}

function moverLeads(ids, destino) {
  let movidos = 0;
  ids.forEach((id) => {
    const origem = LEADS.findIndex((col) => col.some((l) => l.id === id));
    if (origem < 0 || origem === destino) return;
    const pos = LEADS[origem].findIndex((l) => l.id === id);
    const [lead] = LEADS[origem].splice(pos, 1);
    lead.d = 'agora';
    LEADS[destino].unshift(lead);
    ETAPAS[origem].n = Math.max(0, ETAPAS[origem].n - 1);
    ETAPAS[destino].n += 1;
    movidos++;
  });
  return movidos;
}

// ─────────────────────────────────────────────────────────────
// Exportar CSV
//
// Separador `;` e BOM UTF-8: é o que faz o Excel em pt-BR abrir o arquivo
// já colunado e com acento certo, sem passar pelo assistente de importação.
// ─────────────────────────────────────────────────────────────
function baixarCSV(nomeArquivo, leads) {
  const cab = ['Nome', 'Empresa', 'Telefone', 'Etapa', 'Valor', 'Origem', 'Calor', 'Responsáveis', 'Tags', 'Criado em', 'Parado há'];
  const linhas = leads.map((l) => [
    l.n, l.e, l.t, etapaDoLead(l.id)?.nome || '—', l.v, l.o, l.c,
    l.a.map((i) => EQUIPE.find((m) => m.ini === i)?.nome || i).join(', '),
    l.tg.map((t) => tagPorId(t)?.nome).filter(Boolean).join(', '),
    l.cr, l.d,
  ]);
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = [cab, ...linhas].map((r) => r.map(esc).join(';')).join('\r\n');

  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = el('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  avisar(`${leads.length} ${leads.length === 1 ? 'negócio exportado' : 'negócios exportados'}`);
}

const nomeArquivo = (sufixo) =>
  `torque-${norm(FUNIS.find((f) => f.id === funilAtual).nome).replace(/\W+/g, '-')}-${sufixo}.csv`;

// ─────────────────────────────────────────────────────────────
// Submenus reaproveitados pelos três menus (card, coluna, massa)
// ─────────────────────────────────────────────────────────────
function subEtapas(ao, atual) {
  return () => ETAPAS.map((et, i) => ({
    cor: et.cor, rot: et.nome, dir: String(et.n),
    off: i === atual,
    ao: () => ao(i),
  }));
}

function subResponsavel(leads) {
  return () => {
    const todos = (ini) => leads.every((l) => l.a.includes(ini));
    return [
      ...EQUIPE.map((m) => ({
        ic: 'user', rot: m.nome, dir: m.papel, on: todos(m.ini),
        ao: () => {
          const tirar = todos(m.ini);
          leads.forEach((l) => {
            if (tirar) l.a = l.a.filter((x) => x !== m.ini);
            else if (!l.a.includes(m.ini)) l.a.push(m.ini);
          });
          renderBoard();
          return 'ficar';
        },
      })),
      { sep: true },
      { ic: 'x', rot: 'Tirar todos os responsáveis', ao: () => { leads.forEach((l) => { l.a = []; }); renderBoard(); } },
    ];
  };
}

function subTags(leads) {
  return () => TAGS.map((t) => {
    const todos = leads.every((l) => l.tg.includes(t.id));
    return {
      cor: t.cor, rot: t.nome, on: todos,
      ao: () => {
        leads.forEach((l) => {
          if (todos) l.tg = l.tg.filter((x) => x !== t.id);
          else if (!l.tg.includes(t.id)) l.tg.push(t.id);
        });
        renderBoard();
        return 'ficar';
      },
    };
  });
}

// ── Kebab do card ────────────────────────────────────────────
function abrirMenuCard(ancora, lead, etapaIdx) {
  const marcado = selecao.has(lead.id);
  abrirMenuFlut(ancora, [
    { ic: 'book', rot: 'Abrir ficha', ao: () => abrirFicha(lead.id) },
    { ic: 'whats', rot: 'Abrir no WhatsApp', ao: () => avisar(`WhatsApp de ${lead.n} (protótipo)`) },
    { ic: 'clock', rot: 'Criar follow-up', ao: () => avisar('Follow-up criado (protótipo)') },
    { sep: true },
    { ic: 'move', rot: 'Mover para', sub: subEtapas((i) => {
      moverLeads([lead.id], i);
      renderBoard();
      avisar(`${lead.n} → ${ETAPAS[i].nome}`);
    }, etapaIdx) },
    { ic: 'user', rot: 'Responsável', sub: subResponsavel([lead]) },
    { ic: 'tag', rot: 'Tags', sub: subTags([lead]) },
    { sep: true },
    { ic: 'checksq', rot: marcado ? 'Tirar da seleção' : 'Selecionar',
      ao: () => alternarSelecao(lead.id, null, false) },
    { ic: 'down', rot: 'Exportar este', ao: () => baixarCSV(nomeArquivo('lead'), [lead]) },
    { sep: true },
    { ic: 'trash', rot: 'Remover do funil', perigo: true, ao: () => {
      const et = etapaDoLead(lead.id);
      if (!et) return;
      LEADS[et.i] = LEADS[et.i].filter((l) => l.id !== lead.id);
      ETAPAS[et.i].n = Math.max(0, ETAPAS[et.i].n - 1);
      selecao.delete(lead.id);
      renderBoard();
      avisar(`${lead.n} saiu do funil`);
    } },
  ], lead.n);
}

// ── Kebab da coluna ──────────────────────────────────────────
function abrirMenuColuna(ancora, idx) {
  const visiveis = ordenar(leadsDaEtapa(idx), ordemColuna[idx]);
  const jaTodos = visiveis.length > 0 && visiveis.every((l) => selecao.has(l.id));
  const criterio = ordemColuna[idx] || 'padrao';

  abrirMenuFlut(ancora, [
    { ic: 'checksq', rot: jaTodos ? `Tirar os ${visiveis.length} da seleção` : `Selecionar os ${visiveis.length}`,
      off: !visiveis.length,
      ao: () => {
        visiveis.forEach((l) => (jaTodos ? selecao.delete(l.id) : selecao.add(l.id)));
        renderBoard();
      } },
    { ic: 'sort', rot: 'Ordenar por', dir: CRITERIOS.find((c) => c.id === criterio).nome,
      sub: () => CRITERIOS.map((c) => ({
        rot: c.nome, on: c.id === criterio,
        ao: () => { ordemColuna[idx] = c.id; renderBoard(); },
      })) },
    { sep: true },
    { ic: 'move', rot: `Mover os ${visiveis.length} para`, off: !visiveis.length,
      sub: subEtapas((destino) => {
        const n = moverLeads(visiveis.map((l) => l.id), destino);
        renderBoard();
        avisar(`${n} ${n === 1 ? 'negócio movido' : 'negócios movidos'} para ${ETAPAS[destino].nome}`);
      }, idx) },
    { ic: 'down', rot: 'Exportar etapa', dir: `${visiveis.length} linhas`, off: !visiveis.length,
      ao: () => baixarCSV(nomeArquivo(norm(ETAPAS[idx].nome).replace(/\W+/g, '-')), visiveis) },
    ...(temFiltro() ? [{ nota: 'Exporta e move só o que passa nos filtros ativos.' }] : []),
    { sep: true },
    { ic: 'pencil', rot: 'Editar etapas', ao: () => { abaCfg = 'etapas'; renderConfig(); abrir('#ov-cfg'); } },
    { ic: 'plus', rot: 'Nova etapa aqui', ao: () => {
      ETAPAS.splice(idx + 1, 0, { nome: 'Nova etapa', cor: paleta[ETAPAS.length % paleta.length], n: 0 });
      LEADS.splice(idx + 1, 0, []);
      reindexarOrdem(idx + 1, +1);
      renderBoard();
      avisar('Etapa criada — renomeie em Configurações → Etapas');
    } },
  ], ETAPAS[idx].nome);
}

// ── Barra de ação em massa ───────────────────────────────────
function renderSelbar() {
  const barra = $('#selbar');
  barra.textContent = '';
  barra.hidden = selecao.size === 0;
  // Com algo selecionado as caixas ficam visíveis em todos os cards — senão
  // só aparecem no hover, e marcar o segundo item viraria caça ao pixel.
  document.body.classList.toggle('selecionando', selecao.size > 0);
  if (!selecao.size) return;

  const leads = leadsSelecionados();
  const soma = leads.reduce((s, l) => s + soNumero(l.v), 0);

  const cnt = el('div', 'sb-cnt');
  cnt.appendChild(el('b', null, String(leads.length)));
  cnt.appendChild(el('span', null, leads.length === 1 ? 'selecionado' : 'selecionados'));
  barra.appendChild(cnt);

  const val = el('span', 'sb-val', brl(soma));
  val.title = 'Soma do campo Valor dos negócios selecionados';
  barra.appendChild(val);

  barra.appendChild(el('span', 'sb-sep'));

  const acao = (ic, rot, montar) => {
    const b = el('button', 'sb-b');
    b.type = 'button';
    b.setAttribute('aria-haspopup', 'menu');
    b.appendChild(ico(ic));
    b.appendChild(el('span', null, rot));
    b.addEventListener('click', () => montar(b));
    barra.appendChild(b);
    return b;
  };

  acao('move', 'Mover para', (b) => abrirMenuFlut(b, subEtapas((destino) => {
    const n = moverLeads([...selecao], destino);
    limparSelecao();
    avisar(`${n} ${n === 1 ? 'negócio movido' : 'negócios movidos'} para ${ETAPAS[destino].nome}`);
  }), 'Mover para'));

  acao('user', 'Responsável', (b) => abrirMenuFlut(b, subResponsavel(leads), 'Responsável'));
  acao('tag', 'Tags', (b) => abrirMenuFlut(b, subTags(leads), 'Tags'));

  const disp = el('button', 'sb-b');
  disp.type = 'button';
  disp.appendChild(ico('send'));
  disp.appendChild(el('span', null, 'Disparo'));
  disp.addEventListener('click', () => avisar(`Disparo para ${leads.length} — decisão em aberto`));
  disp.title = 'Decisão em aberto: o Disparo sai só do cabeçalho ou também daqui?';
  barra.appendChild(disp);

  const exp = el('button', 'sb-b');
  exp.type = 'button';
  exp.appendChild(ico('down'));
  exp.appendChild(el('span', null, 'Exportar'));
  exp.addEventListener('click', () => baixarCSV(nomeArquivo('selecao'), leads));
  barra.appendChild(exp);

  const rm = el('button', 'sb-b sb-b--perigo');
  rm.type = 'button';
  rm.appendChild(ico('trash'));
  rm.appendChild(el('span', null, 'Remover'));
  rm.addEventListener('click', () => {
    const n = selecao.size;
    LEADS.forEach((col, i) => {
      const antes = col.length;
      LEADS[i] = col.filter((l) => !selecao.has(l.id));
      ETAPAS[i].n = Math.max(0, ETAPAS[i].n - (antes - LEADS[i].length));
    });
    limparSelecao();
    avisar(`${n} ${n === 1 ? 'negócio removido' : 'negócios removidos'} do funil`);
  });
  barra.appendChild(rm);

  const x = el('button', 'sb-x');
  x.type = 'button';
  x.setAttribute('aria-label', 'Limpar seleção');
  x.appendChild(ico('x'));
  x.addEventListener('click', limparSelecao);
  barra.appendChild(x);
}

// ─────────────────────────────────────────────────────────────
// Visão Lista
//
// A única visão do mobile hoje. Mostra numa linha o que o card compactado
// teve de cortar — e ordena por qualquer coluna, coisa que o kanban não faz.
// ─────────────────────────────────────────────────────────────
const COLS_LISTA = [
  { id: 'nome',   rot: 'Negócio',     val: (l) => norm(l.n) },
  { id: 'etapa',  rot: 'Etapa',       val: (l) => etapaDoLead(l.id)?.i ?? 99 },
  { id: 'resp',   rot: 'Responsável', val: (l) => norm(l.a[0] || 'zz') },
  { id: 'origem', rot: 'Origem',      val: (l) => norm(l.o) },
  { id: 'calor',  rot: 'Calor',       val: (l) => l.c,  num: true },
  { id: 'valor',  rot: 'Valor',       val: (l) => soNumero(l.v), num: true },
  { id: 'tempo',  rot: 'Parado há',   val: (l) => diasDe(l.d), num: true },
];

function renderLista() {
  const board = $('#board');
  board.textContent = '';

  const linhas = LEADS.flatMap((col, i) => col.filter(passa).map((l) => ({ l, i })));
  const col = COLS_LISTA.find((c) => c.id === ordemLista.col) || COLS_LISTA[0];
  linhas.sort((a, b) => {
    const va = col.val(a.l), vb = col.val(b.l);
    const d = col.num ? va - vb : String(va).localeCompare(String(vb));
    return ordemLista.asc ? d : -d;
  });

  $('#vazio-geral').hidden = linhas.length > 0 || !temFiltro();

  const tb = el('div', 'lst');
  const cab = el('div', 'lst-h');

  const ids = linhas.map((r) => r.l.id);
  const todos = ids.length > 0 && ids.every((id) => selecao.has(id));
  const chAll = el('button', 'lst-ck' + (todos ? ' lst-ck--on' : ''));
  chAll.type = 'button';
  chAll.setAttribute('role', 'checkbox');
  chAll.setAttribute('aria-checked', String(todos));
  chAll.setAttribute('aria-label', todos ? 'Desmarcar todos' : 'Marcar todos');
  chAll.appendChild(ico('check'));
  chAll.addEventListener('click', () => {
    ids.forEach((id) => (todos ? selecao.delete(id) : selecao.add(id)));
    renderBoard();
  });
  cab.appendChild(chAll);

  COLS_LISTA.forEach((c) => {
    const b = el('button', 'lst-th lst-th--' + c.id + (ordemLista.col === c.id ? ' lst-th--on' : ''));
    b.type = 'button';
    b.setAttribute('aria-sort', ordemLista.col === c.id ? (ordemLista.asc ? 'ascending' : 'descending') : 'none');
    b.appendChild(el('span', null, c.rot));
    if (ordemLista.col === c.id) {
      const seta = ico(ordemLista.asc ? 'up' : 'chev', 'lst-seta');
      b.appendChild(seta);
    }
    b.addEventListener('click', () => {
      if (ordemLista.col === c.id) ordemLista.asc = !ordemLista.asc;
      else ordemLista = { col: c.id, asc: !c.num };   // texto sobe, número desce
      renderBoard();
    });
    cab.appendChild(b);
  });
  cab.appendChild(el('span', 'lst-th lst-th--kb'));
  tb.appendChild(cab);

  const corpo = el('div', 'lst-b');
  linhas.forEach(({ l, i }) => {
    const marcado = selecao.has(l.id);
    const r = el('div', 'lst-r' + (marcado ? ' lst-r--sel' : ''));
    r.tabIndex = 0;
    r.setAttribute('role', 'button');
    r.dataset.lead = l.id;
    r.setAttribute('aria-label', `${l.n}, ${l.e}. Enter abre a ficha.`);

    const ck = el('button', 'lst-ck' + (marcado ? ' lst-ck--on' : ''));
    ck.type = 'button';
    ck.setAttribute('role', 'checkbox');
    ck.setAttribute('aria-checked', String(marcado));
    ck.setAttribute('aria-label', `Selecionar ${l.n}`);
    ck.appendChild(ico('check'));
    ck.addEventListener('click', (e) => { e.stopPropagation(); alternarSelecao(l.id, ids, e.shiftKey); });
    r.appendChild(ck);

    const nome = el('div', 'lst-c lst-c--nome');
    nome.appendChild(el('span', 'n', l.n));
    const emp = el('span', 'e');
    emp.appendChild(ico('build'));
    emp.appendChild(el('span', null, l.e));
    emp.appendChild(el('span', 'tel', l.t));
    nome.appendChild(emp);
    r.appendChild(nome);

    const et = el('div', 'lst-c lst-c--etapa');
    const pin = el('span', 'lst-et', ETAPAS[i].nome);
    pin.style.color = ETAPAS[i].cor;
    pin.style.background = ETAPAS[i].cor + '1c';
    pin.style.borderColor = ETAPAS[i].cor + '44';
    et.appendChild(pin);
    r.appendChild(et);

    const resp = el('div', 'lst-c lst-c--resp');
    if (l.a.length) {
      const avs = el('div', 'avs');
      l.a.forEach((ini) => {
        const s = el('span', null, ini);
        s.style.background = corIniciais(ini);
        s.title = EQUIPE.find((m) => m.ini === ini)?.nome || ini;
        avs.appendChild(s);
      });
      resp.appendChild(avs);
    } else {
      resp.appendChild(el('span', 'vazio-cel', '—'));
    }
    r.appendChild(resp);

    const org = ORIGEM[l.o];
    const oc = el('div', 'lst-c lst-c--origem');
    const bo = el('span', 'bdg', l.o);
    bo.style.color = org.fg;
    bo.style.background = org.bg;
    bo.style.borderColor = org.fg + '40';
    oc.appendChild(bo);
    r.appendChild(oc);

    const fx = faixaCalor(l.c);
    const cc = el('div', 'lst-c lst-c--calor');
    const ch = el('span', 'lst-calor');
    ch.style.color = fx.cor;
    ch.appendChild(ico('flame'));
    ch.appendChild(el('span', null, String(l.c)));
    ch.title = fx.nome;
    cc.appendChild(ch);
    r.appendChild(cc);

    const vc = el('div', 'lst-c lst-c--valor');
    vc.appendChild(el('span', 'val', l.v));
    r.appendChild(vc);

    const dias = diasDe(l.d);
    const tc = el('div', 'lst-c lst-c--tempo');
    const tt = el('span', 'lst-tempo' + (dias >= 8 ? ' lst-tempo--warn' : ''), l.d);
    tc.appendChild(tt);
    if (l.tg.length) {
      const tags = el('span', 'cd-tags');
      l.tg.forEach((id) => {
        const t = tagPorId(id);
        if (!t) return;
        const b = el('i');
        b.style.background = t.cor;
        b.title = t.nome;
        tags.appendChild(b);
      });
      tc.appendChild(tags);
    }
    r.appendChild(tc);

    const kb = el('button', 'lst-kb');
    kb.type = 'button';
    kb.setAttribute('aria-haspopup', 'menu');
    kb.setAttribute('aria-label', `Ações de ${l.n}`);
    kb.appendChild(ico('dots'));
    kb.addEventListener('click', (e) => { e.stopPropagation(); abrirMenuCard(e.currentTarget, l, i); });
    r.appendChild(kb);

    corpo.appendChild(r);
  });
  tb.appendChild(corpo);

  const soma = linhas.reduce((s, r) => s + soNumero(r.l.v), 0);
  const pe = el('div', 'lst-f');
  pe.appendChild(el('span', null, `${linhas.length} ${linhas.length === 1 ? 'negócio' : 'negócios'}${temFiltro() ? ' com os filtros ativos' : ''}`));
  pe.appendChild(el('span', 'lst-f-val', brl(soma)));
  tb.appendChild(pe);

  board.appendChild(tb);
}

// ─────────────────────────────────────────────────────────────
// Visão Analytics
// ─────────────────────────────────────────────────────────────
function tile(rot, valor, nota) {
  const t = el('div', 'an-tile');
  t.appendChild(el('div', 'an-rot', rot));
  t.appendChild(el('div', 'an-num', valor));
  if (nota) t.appendChild(el('div', 'an-nota', nota));
  return t;
}

function quebra(titulo, grupos, total) {
  const s = el('section', 'an-card');
  s.appendChild(el('h3', 'an-t', titulo));
  const lista = el('div', 'an-quebra');
  grupos.sort((a, b) => b.n - a.n).forEach((g) => {
    const r = el('div', 'an-qr');
    const rot = el('span', 'k');
    if (g.cor) {
      const d = el('span', 'an-dot');
      d.style.background = g.cor;
      rot.appendChild(d);
    }
    rot.appendChild(el('span', null, g.nome));
    r.appendChild(rot);
    const trilho = el('span', 'an-tr');
    const fill = el('i');
    fill.style.width = total ? (g.n / total) * 100 + '%' : '0';
    if (g.cor) fill.style.background = g.cor;
    trilho.appendChild(fill);
    r.appendChild(trilho);
    r.appendChild(el('span', 'q', String(g.n)));
    r.appendChild(el('span', 'v', brl(g.valor)));
    lista.appendChild(r);
  });
  s.appendChild(lista);
  return s;
}

function renderAnalytics() {
  const board = $('#board');
  board.textContent = '';
  $('#vazio-geral').hidden = true;

  const porEtapa = ETAPAS.map((et, i) => {
    const leads = leadsDaEtapa(i);
    return { et, leads, n: leads.length, valor: leads.reduce((s, l) => s + soNumero(l.v), 0) };
  });
  const todos = porEtapa.flatMap((e) => e.leads);
  const total = todos.length;
  const somaTotal = todos.reduce((s, l) => s + soNumero(l.v), 0);
  const parados = todos.filter((l) => diasDe(l.d) >= 8).length;
  const semDono = todos.filter((l) => !l.a.length).length;

  const wrap = el('div', 'an');

  const tiles = el('div', 'an-tiles');
  tiles.appendChild(tile('Negócios no funil', String(total), temFiltro() ? 'com os filtros ativos' : 'sem filtro'));
  tiles.appendChild(tile('Valor em aberto', brl(somaTotal), 'soma do campo Valor'));
  tiles.appendChild(tile('Ticket médio', total ? brl(Math.round(somaTotal / total)) : '—', 'valor ÷ negócios'));
  tiles.appendChild(tile('Parados 8+ dias', String(parados), total ? `${Math.round((parados / total) * 100)}% do funil` : '—'));
  tiles.appendChild(tile('Sem responsável', String(semDono), semDono ? 'ninguém está tocando' : 'todos atribuídos'));
  wrap.appendChild(tiles);

  // Funil de conversão — % em relação à primeira etapa, que é como o Torque
  // lê "quanto sobrou até aqui".
  const base = porEtapa[0]?.n || 0;
  const maior = Math.max(1, ...porEtapa.map((e) => e.n));
  const fun = el('section', 'an-card');
  fun.appendChild(el('h3', 'an-t', 'Distribuição por etapa'));
  const barras = el('div', 'an-funil');
  porEtapa.forEach((e) => {
    const r = el('div', 'an-fr');
    const rot = el('span', 'k');
    const d = el('span', 'an-dot');
    d.style.background = e.et.cor;
    rot.appendChild(d);
    rot.appendChild(el('span', null, e.et.nome));
    r.appendChild(rot);

    const trilho = el('span', 'an-tr');
    const fill = el('i');
    fill.style.width = (e.n / maior) * 100 + '%';
    fill.style.background = e.et.cor;
    trilho.appendChild(fill);
    r.appendChild(trilho);

    r.appendChild(el('span', 'q', String(e.n)));
    r.appendChild(el('span', 'p', base ? Math.round((e.n / base) * 100) + '%' : '—'));
    r.appendChild(el('span', 'v', brl(e.valor)));
    barras.appendChild(r);
  });
  fun.appendChild(barras);
  fun.appendChild(el('p', 'an-obs',
    'A coluna % compara com a primeira etapa. Não é taxa de conversão real — para isso é preciso ' +
    'a data de entrada e saída de cada etapa, que hoje só o histórico do lead guarda.'));
  wrap.appendChild(fun);

  const duplas = el('div', 'an-duplas');
  duplas.appendChild(quebra('Por origem', Object.keys(ORIGEM).map((o) => {
    const leads = todos.filter((l) => l.o === o);
    return { nome: o, cor: ORIGEM[o].fg, n: leads.length, valor: leads.reduce((s, l) => s + soNumero(l.v), 0) };
  }), total));
  duplas.appendChild(quebra('Por responsável', [
    ...EQUIPE.map((m) => {
      const leads = todos.filter((l) => l.a.includes(m.ini));
      return { nome: m.nome, cor: corIniciais(m.ini), n: leads.length, valor: leads.reduce((s, l) => s + soNumero(l.v), 0) };
    }),
    (() => {
      const leads = todos.filter((l) => !l.a.length);
      return { nome: 'Sem responsável', cor: '#57534e', n: leads.length, valor: leads.reduce((s, l) => s + soNumero(l.v), 0) };
    })(),
  ], total));
  wrap.appendChild(duplas);

  const aviso = el('div', 'an-aviso');
  aviso.appendChild(ico('warn'));
  const txt = el('div');
  txt.innerHTML =
    '<b>Onde este número mente hoje.</b> No Torque a receita só é contada em Propostas: ~15 RPCs somam ' +
    '<code>pipe_propostas.sale_value</code> com <code>status=\'vendido\'</code>. Valor lançado em qualquer ' +
    'outro funil não entra em nenhum painel — e nas orgs com a flag ' +
    '<code>exclude_custom_pipe_leads_from_metrics</code> o lead que só vive em funil custom é excluído de ' +
    'propósito. Além disso, a soma por coluna do board hoje só existe em Propostas e <b>soma errado acima ' +
    'de 20 cards</b>, porque soma a página carregada e não a etapa inteira. Aqui está somando tudo porque ' +
    'o protótipo tem a base na memória.';
  aviso.appendChild(txt);
  wrap.appendChild(aviso);

  board.appendChild(wrap);
}

// ─────────────────────────────────────────────────────────────
// Overlays
// ─────────────────────────────────────────────────────────────
let ultimoFoco = null;

function abrir(sel) {
  ultimoFoco = document.activeElement;
  const ov = $(sel);
  ov.hidden = false;
  const alvo = ov.querySelector('.sh-x');
  if (alvo) alvo.focus();
}

function fechar(ov) {
  ov.hidden = true;
  if (ov.id === 'ov-ficha') leadAberto = null;
  if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
}

function ligarOverlay(sel) {
  const ov = $(sel);
  ov.addEventListener('click', (e) => { if (e.target === ov) fechar(ov); });
  $$('[data-fechar]', ov).forEach((b) => b.addEventListener('click', () => fechar(ov)));
}

// ─────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────
Object.entries(FICHAS).forEach(([leadId, ficha]) => {
  ficha.entradas.forEach((ent) => {
    if (!ent.orcamento) return;
    recalcular(ent.orcamento);
    ent.valor = ent.orcamento.itens.length ? ent.orcamento.total : null;
    const lead = leadPorId(leadId);
    if (lead && ent.funil === funilAtual) lead.v = ent.valor;
  });
});

aplicarFiltros();

// A caixa de seleção e o kebab vivem dentro do card: sem esta guarda, apertar
// qualquer um dos dois começaria um arrasto de 8px em vez de acionar o botão.
const naoArrasta = (alvo) => alvo.closest('.cd-sel, .cd-kb');

$('#board').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const card = e.target.closest('.cd');
  if (!card || naoArrasta(e.target)) return;
  arrastou = false;
  iniciarArrasto(e, card);
  e.preventDefault();
});
document.addEventListener('mousemove', moverArrasto);
document.addEventListener('mouseup', soltarArrasto);

$('#board').addEventListener('click', (e) => {
  if (arrastou) { arrastou = false; return; }
  if (naoArrasta(e.target) || e.target.closest('.lst-ck, .lst-kb')) return;
  const alvo = e.target.closest('.cd, .lst-r');
  if (alvo) abrirFicha(alvo.dataset.lead);
});

$('#board').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  // Mesma guarda do clique. Faltando aqui, apertar Enter com o foco na caixa
  // de seleção ou no kebab abria a ficha — e o preventDefault ainda cancelava
  // o acionamento nativo do botão, deixando os dois inalcançáveis por teclado.
  if (naoArrasta(e.target) || e.target.closest('.lst-ck, .lst-kb')) return;
  const alvo = e.target.closest('.cd, .lst-r');
  if (!alvo) return;
  e.preventDefault();
  abrirFicha(alvo.dataset.lead);
});

// Sempre cai em Recursos. `abaCfg` é lembrado entre aberturas, e o item
// "Editar etapas" do menu da coluna o deixa em 'etapas' — sem este reset,
// o botão Configurações passava a abrir em Etapas para sempre e os toggles
// de produto/reunião/valor simplesmente sumiam da vista.
$('#btn-cfg').addEventListener('click', () => { abaCfg = 'recursos'; renderConfig(); abrir('#ov-cfg'); });
$('#btn-pick').addEventListener('click', () => alternarPop($('#menu-funis'), $('#btn-pick'), renderMenuFunis));
$('#btn-filtros').addEventListener('click', () => alternarPop($('#menu-filtros'), $('#btn-filtros'), renderMenuFiltros));
$('#btn-views').addEventListener('click', () => alternarPop($('#menu-views'), $('#btn-views'), renderMenuViews));

let debounce = null;
$('#busca').addEventListener('input', (e) => {
  clearTimeout(debounce);
  const v = e.target.value;
  debounce = setTimeout(() => { filtros.busca = v; aplicarFiltros(); }, 120);
});

ligarOverlay('#ov-ficha');
ligarOverlay('#ov-cfg');

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Ordem de desfazer: menu flutuante → popover da faixa → modal → seleção.
  if (menuFlut) { const a = menuFlut.ancora; fecharMenuFlut(); if (a.isConnected) a.focus(); return; }
  if (popAberto) { const b = popAberto.botao; fecharPop(); b.focus(); return; }
  const abertos = $$('.ov:not([hidden])');
  if (abertos.length) { abertos.forEach(fechar); return; }
  if (selecao.size) limparSelecao();
});

// Ctrl/⌘+A seleciona o que está visível, mas só quando o foco está no board —
// dentro de um campo de texto tem que continuar selecionando o texto.
// A checagem de modal é pelo DOM, não pelo alvo do evento: clicar numa área
// não-focável da ficha deixa o foco no <body>, e aí `closest('.ov')` não pega
// nada — o atalho selecionava o funil inteiro atrás do modal aberto.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'a' && e.key !== 'A') return;
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.target.closest('input, textarea')) return;
  if ($('.ov:not([hidden])')) return;
  e.preventDefault();
  LEADS.forEach((col, i) => leadsDaEtapa(i).forEach((l) => selecao.add(l.id)));
  ancoraSel = null;
  renderBoard();
});
