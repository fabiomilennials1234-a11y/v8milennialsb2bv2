import { useState } from 'react';

const PAGES = ['comando', 'chat', 'funis', 'turbo', 'agenda', 'ranking', 'comissoes'] as const;
type PageId = typeof PAGES[number];

const PAGE_LABELS: Record<PageId, string> = {
  comando: 'Comando',
  chat: 'Chat',
  funis: 'Funis',
  turbo: 'Turbo',
  agenda: 'Agenda',
  ranking: 'Ranking',
  comissoes: 'Comissões',
};

function PageComando() {
  return (
    <div>
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <div>
          <div className="font-display text-base sm:text-lg font-semibold text-cream">Bom dia, Gabriel.</div>
          <div className="text-mute text-[11px] mt-0.5">Aqui está o panorama do seu mês.</div>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-7 h-7 rounded-md flex items-center justify-center text-mute hover:text-cream" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="px-4 py-1.5 rounded-md text-[11px] font-medium" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>Maio 2026</div>
          <button className="w-7 h-7 rounded-md flex items-center justify-center text-mute hover:text-cream" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-5 px-5 mt-3 border-b border-white/5 text-[11px]">
        <div className="pb-2 -mb-px font-medium text-cream border-b-2" style={{ borderColor: '#ed9326' }}>Visão Geral</div>
        <div className="pb-2 text-mute hover:text-cream cursor-pointer">Performance</div>
        <div className="pb-2 text-mute hover:text-cream cursor-pointer">Inteligência</div>
        <div className="pb-2 text-mute hover:text-cream cursor-pointer">Analytics</div>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 px-5 mt-4">
        <div className="rounded-xl p-2.5 relative" style={{ background: 'rgba(237,147,38,0.04)', border: '1px solid rgba(237,147,38,0.35)', boxShadow: '0 0 24px rgba(237,147,38,0.08) inset' }}>
          <div className="flex items-start justify-between mb-1">
            <div className="text-[8.5px] text-mute uppercase tracking-wider leading-tight">Receita<br />do Mês</div>
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: 'rgba(237,147,38,0.15)' }}>
              <span className="text-[9px] font-bold text-orange">$</span>
            </div>
          </div>
          <div className="font-display text-base font-semibold text-cream mt-1">R$ 2K</div>
        </div>
        <KpiCard label={<>Leads<br />Captados</>} value="777" icon={<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8a857a" strokeWidth="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6M23 11h-6" /></svg>} />
        <KpiCard label={<>Ticket<br />Médio</>} value="R$ 1K" icon={<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8a857a" strokeWidth="2.2"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>} />
        <KpiCard label={<>Propostas<br />Enviadas</>} value="19" icon={<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8a857a" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /></svg>} />
        <KpiCard label={<>Taxa de<br />Conversão</>} value="11%" icon={<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8a857a" strokeWidth="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>} />
        <KpiCard label={<>Tempo de<br />Resposta</>} value="0min" icon={<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#8a857a" strokeWidth="2.2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 px-5 pt-4 pb-5">
        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="text-[9.5px] text-mute uppercase tracking-wider font-medium">Meta do Mês</div>
          <div className="flex items-center justify-center mt-2">
            <svg viewBox="0 0 220 130" className="w-full max-w-[260px]">
              <defs>
                <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#22c55e" />
                  <stop offset="60%" stopColor="#facc15" />
                  <stop offset="100%" stopColor="#ed9326" />
                </linearGradient>
              </defs>
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="14" strokeLinecap="round" />
              <path d="M 20 110 A 90 90 0 0 1 200 110" fill="none" stroke="url(#gaugeGrad)" strokeWidth="14" strokeLinecap="round" opacity="0.85" />
              <text x="22" y="125" fontSize="7" fill="#636156" fontFamily="Inter">20%</text>
              <text x="48" y="60" fontSize="7" fill="#636156" fontFamily="Inter">40%</text>
              <text x="103" y="38" fontSize="7" fill="#636156" fontFamily="Inter">60%</text>
              <text x="160" y="60" fontSize="7" fill="#636156" fontFamily="Inter">80%</text>
              <text x="184" y="125" fontSize="7" fill="#636156" fontFamily="Inter">100%</text>
              <line x1="110" y1="110" x2="158" y2="42" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
              <line x1="110" y1="110" x2="62" y2="100" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
              <circle cx="110" cy="110" r="6" fill="#1c1c1c" stroke="#3b82f6" strokeWidth="2" />
              <text x="110" y="100" fontSize="20" fontWeight="700" fill="#f8f5e7" textAnchor="middle" fontFamily="Space Grotesk">1%</text>
            </svg>
          </div>
          <div className="flex items-center justify-center gap-4 text-[9px] mt-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-0.5 bg-red-500 rounded-full" />
              <span className="text-mute">Meta esperada</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-0.5 bg-blue-500 rounded-full" />
              <span className="text-mute">Realizado</span>
            </div>
          </div>
          <div className="grid grid-cols-3 mt-3 pt-3 border-t border-white/5 text-center">
            <div>
              <div className="text-[8.5px] text-mute uppercase tracking-wider">Meta</div>
              <div className="font-display text-[11px] font-semibold text-cream mt-0.5">R$ 210K</div>
            </div>
            <div>
              <div className="text-[8.5px] text-mute uppercase tracking-wider">Realizado</div>
              <div className="font-display text-[11px] font-semibold text-cream mt-0.5">R$ 2K</div>
            </div>
            <div>
              <div className="text-[8.5px] text-mute uppercase tracking-wider">Progresso</div>
              <div className="font-display text-[11px] font-semibold text-cream mt-0.5">22 / 31</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="text-[9.5px] text-mute uppercase tracking-wider font-medium mb-4">Funil de Vendas</div>
          <div className="rounded-lg flex items-center justify-between px-3 py-2.5" style={{ background: 'linear-gradient(90deg, #3b82f6, #2563eb)', boxShadow: '0 4px 16px rgba(59,130,246,0.25)' }}>
            <div className="flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /></svg>
              <span className="text-[11px] font-semibold text-white">Leads</span>
            </div>
            <span className="text-[11px] font-bold text-white">777</span>
          </div>
          <div className="flex items-center justify-end pr-3 mt-1 mb-1"><span className="text-[9px] text-mute">&darr; 3%</span></div>
          <div className="ml-6 rounded-lg flex items-center justify-between px-3 py-2.5" style={{ background: 'linear-gradient(90deg, #a855f7, #9333ea)', boxShadow: '0 4px 16px rgba(168,85,247,0.25)' }}>
            <div className="flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /></svg>
              <span className="text-[11px] font-semibold text-white">Reuniões</span>
            </div>
            <span className="text-[11px] font-bold text-white">26</span>
          </div>
          <div className="flex items-center justify-end pr-3 mt-1 mb-1"><span className="text-[9px] text-mute">&darr; 73%</span></div>
          <div className="ml-12 rounded-lg flex items-center justify-between px-3 py-2.5" style={{ background: 'linear-gradient(90deg, #ed9326, #f5a93f)', boxShadow: '0 4px 16px rgba(237,147,38,0.3)' }}>
            <div className="flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#1c1c1c" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <span className="text-[11px] font-semibold text-ink">Propostas</span>
            </div>
            <span className="text-[11px] font-bold text-ink">19</span>
          </div>
          <div className="flex items-center justify-end pr-3 mt-1 mb-1"><span className="text-[9px] text-mute">&darr; 11%</span></div>
          <div className="ml-20 rounded-lg flex items-center justify-between px-3 py-2.5" style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)', boxShadow: '0 4px 16px rgba(34,197,94,0.3)' }}>
            <div className="flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M6 9l6-6 6 6" /><path d="M6 9v9a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9" /></svg>
              <span className="text-[11px] font-semibold text-white">Vendas</span>
            </div>
            <span className="text-[11px] font-bold text-white">2</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon }: { label: React.ReactNode; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-start justify-between mb-1">
        <div className="text-[8.5px] text-mute uppercase tracking-wider leading-tight">{label}</div>
        <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)' }}>{icon}</div>
      </div>
      <div className="font-display text-base font-semibold text-cream mt-1">{value}</div>
    </div>
  );
}

function PageChat() {
  return (
    <div className="flex h-[440px]">
      <div className="w-[36%] border-r border-white/5 flex flex-col">
        <div className="px-4 py-3 border-b border-white/5">
          <div className="font-display text-sm font-semibold">Conversas</div>
          <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8a857a" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <span className="text-[10px] text-mute">Buscar contato...</span>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer relative" style={{ background: 'rgba(237,147,38,0.06)', borderLeft: '2px solid #ed9326' }}>
            <div className="relative shrink-0">
              <div className="avatar w-9 h-9 text-[11px]" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)' }}>ML</div>
              <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-400 border-2" style={{ borderColor: '#131110' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-medium text-cream truncate">Marina Lopes</span>
                <span className="text-[9px] text-mute">14:32</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px] text-mute truncate">Pode me mandar a proposta?</span>
                <span className="w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center text-ink shrink-0" style={{ background: '#ed9326' }}>3</span>
              </div>
            </div>
          </div>
          {[
            { initials: 'CA', name: 'Carlos Andrade', msg: 'Perfeito, fechado!', time: '13:08', grad: '#a855f7,#7c3aed', online: true },
            { initials: 'FS', name: 'Felipe Souza', msg: 'Vou avaliar e te retorno', time: '11:45', grad: '#3b82f6,#1d4ed8' },
            { initials: 'PR', name: 'Patrícia Rocha', msg: 'Quando podemos marcar?', time: '10:21', grad: '#22c55e,#16a34a', badge: 1 },
            { initials: 'LM', name: 'Lucas Martins', msg: 'Obrigado pela atenção', time: 'ontem', grad: '#ef4444,#dc2626' },
          ].map((c) => (
            <div key={c.initials} className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition">
              <div className="relative shrink-0">
                <div className="avatar w-9 h-9 text-[11px]" style={{ background: `linear-gradient(135deg,${c.grad})` }}>{c.initials}</div>
                {c.online && <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-green-400 border-2" style={{ borderColor: '#131110' }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-cream truncate">{c.name}</span>
                  <span className="text-[9px] text-mute">{c.time}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[10px] text-mute truncate">{c.msg}</span>
                  {c.badge && <span className="w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center text-ink shrink-0" style={{ background: '#ed9326' }}>{c.badge}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="avatar w-9 h-9 text-[11px]" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)' }}>ML</div>
            <div>
              <div className="text-[12px] font-semibold text-cream">Marina Lopes</div>
              <div className="text-[9.5px] text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                online &middot; Acme Logística
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button className="w-7 h-7 rounded-md flex items-center justify-center text-mute hover:text-cream hover:bg-white/5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1.12.37 2.22.72 3.27a2 2 0 0 1-.45 2.11L8.09 10.41a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c1.05.35 2.15.59 3.27.72A2 2 0 0 1 22 16.92z" /></svg>
            </button>
            <button className="w-7 h-7 rounded-md flex items-center justify-center text-mute hover:text-cream hover:bg-white/5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            </button>
            <button className="w-7 h-7 rounded-md flex items-center justify-center text-mute hover:text-cream hover:bg-white/5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 px-4 py-4 space-y-2.5 overflow-hidden">
          <div className="flex gap-2">
            <div className="avatar w-6 h-6 text-[9px] shrink-0" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)' }}>ML</div>
            <div className="max-w-[80%]">
              <div className="rounded-2xl rounded-tl-md px-3 py-2 text-[11px] text-cream/90 leading-relaxed" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)' }}>
                Oi Gabriel, tudo bem? Adorei a apresentação ontem.
              </div>
              <div className="text-[9px] text-mute mt-1 ml-2">14:28</div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <div className="max-w-[80%]">
              <div className="rounded-2xl rounded-tr-md px-3 py-2 text-[11px] leading-relaxed text-ink font-medium" style={{ background: 'linear-gradient(135deg,#ed9326,#f5a93f)', boxShadow: '0 4px 12px rgba(237,147,38,0.25)' }}>
                Que bom Marina! Posso te mandar a proposta personalizada agora?
              </div>
              <div className="text-[9px] text-mute mt-1 mr-2 text-right">14:30 ✓✓</div>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="avatar w-6 h-6 text-[9px] shrink-0" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)' }}>ML</div>
            <div className="max-w-[80%]">
              <div className="rounded-2xl rounded-tl-md px-3 py-2 text-[11px] text-cream/90 leading-relaxed" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)' }}>
                Sim! Pode me mandar a proposta? Vou analisar com o time hoje.
              </div>
              <div className="text-[9px] text-mute mt-1 ml-2">14:32 &middot; digitando...</div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <div className="max-w-[85%] rounded-xl px-3 py-2.5" style={{ background: 'rgba(168,85,247,0.08)', border: '1px dashed rgba(168,85,247,0.35)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="#c084fc"><path d="M12 2l2.4 7.4H22l-6 4.4 2.4 7.4L12 16.8 5.6 21.2 8 13.8l-6-4.4h7.6z" /></svg>
                <span className="text-[9.5px] font-medium" style={{ color: '#c084fc' }}>Sugestão do Oráculo</span>
              </div>
              <div className="text-[10.5px] text-cream/85 leading-relaxed">&quot;Claro! Vou enviar a proposta com o desconto que conversamos. Posso agendar uma call amanhã às 10h para revisarmos juntas?&quot;</div>
              <div className="flex items-center gap-2 mt-2">
                <button className="text-[9.5px] px-2.5 py-1 rounded-md font-medium" style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', color: '#fff' }}>Usar resposta</button>
                <button className="text-[9.5px] px-2.5 py-1 rounded-md text-mute hover:text-cream">Editar</button>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <button className="text-mute hover:text-cream shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
            <span className="flex-1 text-[11px] text-mute">Digite uma mensagem...</span>
            <button className="text-mute hover:text-cream shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
            </button>
            <button className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,#ed9326,#f5a93f)', boxShadow: '0 4px 12px rgba(237,147,38,0.3)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="#1c1c1c"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineCard({ name, value, days }: { name: string; value: string; days: string }) {
  return (
    <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="font-medium text-cream mb-1">{name}</div>
      <div className="flex justify-between"><span className="text-mute">{value}</span><span className="text-mute">{days}</span></div>
    </div>
  );
}

function PageFunis() {
  return (
    <div>
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <div>
          <div className="font-display text-base font-semibold text-cream">Funis de Venda</div>
          <div className="text-mute text-[11px]">Pipeline outbound &middot; 66 negócios &middot; R$ 1.172k</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-2.5 py-1 rounded-md text-[10px] text-cream" style={{ background: 'rgba(237,147,38,0.12)', border: '1px solid rgba(237,147,38,0.25)' }}>Outbound</div>
          <div className="px-2.5 py-1 rounded-md text-[10px] text-mute" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>Inbound</div>
          <button className="text-[10px] px-3 py-1.5 rounded-md font-medium" style={{ background: 'linear-gradient(135deg,#ed9326,#ffb347)', color: '#1c1c1c' }}>+ Negócio</button>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="grid grid-cols-4 gap-2.5">
          <div className="pipeline-col p-2.5">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /><span className="text-[11px] font-medium">Prospect</span></div>
              <span className="text-[9px] text-mute">28</span>
            </div>
            <div className="text-[10px] text-mute mb-2">R$ 142k</div>
            <div className="space-y-1.5">
              <PipelineCard name="Zenith S.A." value="R$ 18k" days="3d" />
              <PipelineCard name="Polaris Mídia" value="R$ 8k" days="1d" />
              <PipelineCard name="Atlas Distrib." value="R$ 24k" days="5h" />
            </div>
          </div>
          <div className="pipeline-col p-2.5">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-purple-400" /><span className="text-[11px] font-medium">Qualificado</span></div>
              <span className="text-[9px] text-mute">17</span>
            </div>
            <div className="text-[10px] text-mute mb-2">R$ 218k</div>
            <div className="space-y-1.5">
              <PipelineCard name="Helix Corp" value="R$ 38k" days="2d" />
              <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(237,147,38,0.3)', boxShadow: '0 0 16px rgba(237,147,38,0.15)' }}>
                <div className="font-medium text-cream mb-1">Vortex Tech</div>
                <div className="flex justify-between"><span className="text-orange font-semibold">R$ 72k</span><span className="text-mute">4h</span></div>
              </div>
              <PipelineCard name="Mira Saúde" value="R$ 14k" days="2h" />
            </div>
          </div>
          <div className="pipeline-col p-2.5">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-orange" /><span className="text-[11px] font-medium">Proposta</span></div>
              <span className="text-[9px] text-mute">9</span>
            </div>
            <div className="text-[10px] text-mute mb-2">R$ 324k</div>
            <div className="space-y-1.5">
              <PipelineCard name="Acme Logística" value="R$ 48k" days="1d" />
              <PipelineCard name="Norden Ind." value="R$ 124k" days="6h" />
              <PipelineCard name="Vega Soluções" value="R$ 86k" days="2d" />
            </div>
          </div>
          <div className="pipeline-col p-2.5">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[11px] font-medium">Fechado</span></div>
              <span className="text-[9px] text-mute">12</span>
            </div>
            <div className="text-[10px] text-mute mb-2">R$ 487k</div>
            <div className="space-y-1.5">
              {[
                { name: 'Quanta SaaS', value: 'R$ 96k' },
                { name: 'Stratus Cloud', value: 'R$ 56k' },
                { name: 'Proton AI', value: 'R$ 42k' },
              ].map((d) => (
                <div key={d.name} className="rounded p-2 text-[10px]" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
                  <div className="font-medium text-cream mb-1">{d.name}</div>
                  <div className="flex justify-between"><span className="text-green-400 font-semibold">{d.value}</span><span className="text-mute">&#10003;</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AutomationCard({ icon, iconBg, iconBorder, iconStroke, title, desc, execs, rate, active = true }: {
  icon: React.ReactNode; iconBg: string; iconBorder: string; iconStroke: string; title: string; desc: string; execs: string; rate: string; active?: boolean;
}) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: iconBg, border: `1px solid ${iconBorder}` }}>{icon}</div>
          <span className="text-[12px] font-medium">{title}</span>
        </div>
        <div className={`flex items-center gap-1 text-[9px] ${active ? 'text-green-400' : 'text-mute'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-green-400 animate-pulse' : 'bg-warm'}`} />{active ? 'Ativa' : 'Pausada'}
        </div>
      </div>
      <div className="text-[10.5px] text-mute leading-relaxed">{desc}</div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5 text-[10px]">
        <span className="text-mute">{execs}</span>
        <span className={active ? 'text-green-400' : 'text-mute'}>{rate}</span>
      </div>
    </div>
  );
}

function PageTurbo() {
  return (
    <div>
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <div>
          <div className="font-display text-base font-semibold text-cream flex items-center gap-2">
            Turbo
            <span className="text-[9px] px-2 py-0.5 rounded font-semibold" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)', color: '#1c1c1c' }}>PRO</span>
          </div>
          <div className="text-mute text-[11px]">8 automações ativas &middot; 1.247 execuções hoje</div>
        </div>
        <button className="text-[10px] px-3 py-1.5 rounded-md font-medium" style={{ background: 'linear-gradient(135deg,#ed9326,#ffb347)', color: '#1c1c1c' }}>+ Nova automação</button>
      </div>
      <div className="px-5 py-4 grid grid-cols-2 gap-3">
        <AutomationCard
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>}
          iconBg="rgba(74,222,128,0.12)" iconBorder="rgba(74,222,128,0.3)" iconStroke="#4ade80"
          title="Boas-vindas automático" desc="Quando lead chegar via formulário → enviar e-mail + WhatsApp + atribuir vendedor."
          execs="247 execuções hoje" rate="94% sucesso"
        />
        <AutomationCard
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
          iconBg="rgba(168,85,247,0.12)" iconBorder="rgba(168,85,247,0.3)" iconStroke="#c084fc"
          title="Score IA > 80" desc='Lead pontuou alto → mover para "Quente" + notificar gestor + agendar reunião.'
          execs="38 execuções hoje" rate="100% sucesso"
        />
        <AutomationCard
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f5a93f" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
          iconBg="rgba(237,147,38,0.12)" iconBorder="rgba(237,147,38,0.3)" iconStroke="#f5a93f"
          title="Follow-up de 3 dias" desc="Sem resposta em 3 dias → enviar lembrete personalizado + criar tarefa."
          execs="102 execuções hoje" rate="87% sucesso"
        />
        <AutomationCard
          icon={<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
          iconBg="rgba(59,130,246,0.12)" iconBorder="rgba(59,130,246,0.3)" iconStroke="#60a5fa"
          title="Pós-venda 7 dias" desc="Após fechar → enviar pesquisa NPS + pedir indicação + atualizar status."
          execs="0 execuções hoje" rate="Última: ontem" active={false}
        />
      </div>
    </div>
  );
}

const CAL_DAYS = [27,28,29,30,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31];
const CAL_DOTS = [4,7,11,15,23,26];

function PageAgenda() {
  return (
    <div>
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <div>
          <div className="font-display text-base font-semibold text-cream">Agenda</div>
          <div className="text-mute text-[11px]">Quinta-feira, 22 de Maio &middot; 6 compromissos hoje</div>
        </div>
        <div className="flex items-center gap-1">
          <div className="px-2.5 py-1 rounded-md text-[10px] text-cream" style={{ background: 'rgba(237,147,38,0.12)', border: '1px solid rgba(237,147,38,0.25)' }}>Hoje</div>
          <div className="px-2.5 py-1 rounded-md text-[10px] text-mute" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>Semana</div>
          <div className="px-2.5 py-1 rounded-md text-[10px] text-mute" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>Mês</div>
        </div>
      </div>
      <div className="px-5 py-4 grid grid-cols-5 gap-3">
        <div className="col-span-2 rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-display text-[12px] font-semibold">Maio 2026</div>
            <div className="flex items-center gap-0.5">
              <button className="w-5 h-5 flex items-center justify-center text-mute hover:text-cream"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg></button>
              <button className="w-5 h-5 flex items-center justify-center text-mute hover:text-cream"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[9px] text-mute mb-1.5 text-center">
            {['D','S','T','Q','Q','S','S'].map((d, i) => <div key={i}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1 text-[10px] text-center">
            {CAL_DAYS.map((day, i) => {
              const isPrev = i < 4;
              const isToday = day === 22 && i === 24;
              const hasDot = CAL_DOTS.includes(day) && !isPrev;
              if (isToday) {
                return (
                  <div key={i} className="aspect-square flex items-center justify-center rounded-full font-semibold text-ink" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)', boxShadow: '0 0 12px rgba(237,147,38,0.4)' }}>22</div>
                );
              }
              return (
                <div key={i} className={`aspect-square flex items-center justify-center relative ${isPrev ? 'text-warm' : 'text-cream'}`}>
                  {day}
                  {hasDot && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-orange" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="col-span-3 rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="text-[10px] text-mute uppercase tracking-wider font-medium mb-3">Hoje &middot; 22 de Maio</div>
          <div className="space-y-2.5">
            {[
              { time: '09:00', title: 'Daily com o time comercial', sub: '8 participantes', color: '#3b82f6' },
              { time: '10:30', title: 'Call de proposta · Vortex Tech', sub: 'R$ 72k · Marina Lopes', color: '#ed9326' },
              { time: '13:00', title: 'Almoço com Helix Corp', sub: 'Restaurante Fasano · Av. Vieira de Carvalho', color: '#a855f7' },
              { time: '15:00', title: 'Fechamento · Norden Indústria', sub: 'R$ 124k · Patrícia Alves', color: '#ed9326' },
              { time: '17:00', title: '1:1 com Felipe Souza', sub: 'Review de performance', color: '#22c55e' },
            ].map((e) => (
              <div key={e.time} className="flex gap-3">
                <div className="text-[10px] text-mute pt-0.5 w-10 shrink-0">{e.time}</div>
                <div className="flex-1 rounded-lg pl-3 pr-2 py-2 border-l-2" style={{ background: `${e.color}0F`, borderColor: e.color }}>
                  <div className="text-[11px] font-medium text-cream">{e.title}</div>
                  <div className="text-[10px] text-mute">{e.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const RANKING_DATA = [
  { pos: 1, initials: 'CR', name: 'Carlos Reis', role: 'SDR Sênior · Outbound', revenue: 'R$ 142k', delta: '+ R$ 38k vs meta', pct: 137, grad: '#ed9326,#ffd400', barGrad: '#ed9326,#ffd400', barW: '100%', highlight: true, crown: true },
  { pos: 2, initials: 'PA', name: 'Patrícia Alves', role: 'Closer · Enterprise', revenue: 'R$ 124k', delta: '+ R$ 20k vs meta', pct: 119, grad: '#a855f7,#7c3aed', barGrad: '#a855f7,#c084fc', barW: '95%' },
  { pos: 3, initials: 'FS', name: 'Felipe Souza', role: 'SDR · Inbound', revenue: 'R$ 96k', delta: '+ R$ 11k vs meta', pct: 113, grad: '#3b82f6,#1d4ed8', barGrad: '#3b82f6,#60a5fa', barW: '82%' },
  { pos: 4, initials: 'ML', name: 'Marina Lopes', role: 'Closer · SMB', revenue: 'R$ 52k', delta: '− R$ 32k vs meta', pct: 62, grad: '#22c55e,#16a34a', barGrad: '#22c55e,#4ade80', barW: '62%', negative: true },
  { pos: 5, initials: 'LM', name: 'Lucas Martins', role: 'SDR Júnior · Outbound', revenue: 'R$ 38k', delta: '− R$ 28k vs meta', pct: 58, grad: '#ef4444,#dc2626', barGrad: '#ef4444,#f87171', barW: '48%', negative: true },
];

function PageRanking() {
  return (
    <div>
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <div>
          <div className="font-display text-base font-semibold text-cream">Ranking de Vendedores</div>
          <div className="text-mute text-[11px]">Maio 2026 &middot; 8 vendedores &middot; R$ 487k total</div>
        </div>
        <div className="flex items-center gap-1">
          <div className="px-2.5 py-1 rounded-md text-[10px] text-cream" style={{ background: 'rgba(237,147,38,0.12)', border: '1px solid rgba(237,147,38,0.25)' }}>Receita</div>
          <div className="px-2.5 py-1 rounded-md text-[10px] text-mute" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>Negócios</div>
          <div className="px-2.5 py-1 rounded-md text-[10px] text-mute" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>Conv. %</div>
        </div>
      </div>
      <div className="px-5 py-4 space-y-2">
        {RANKING_DATA.map((r) => (
          <div key={r.pos} className="rounded-xl p-3 flex items-center gap-3" style={r.highlight ? { background: 'linear-gradient(90deg, rgba(237,147,38,0.08), rgba(255,212,0,0.04))', border: '1px solid rgba(237,147,38,0.3)', boxShadow: '0 0 24px rgba(237,147,38,0.1)' } : { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className={`font-display text-xl font-bold w-6 text-center ${r.highlight ? 'gradient-text-orange' : 'text-cream/70'}`}>{r.pos}</div>
            <div className="avatar w-9 h-9 text-[11px]" style={{ background: `linear-gradient(135deg,${r.grad})` }}>{r.initials}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-semibold text-cream flex items-center gap-1.5">
                    {r.name}
                    {r.crown && <svg width="11" height="11" viewBox="0 0 24 24" fill="#ed9326"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5m14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" /></svg>}
                  </div>
                  <div className="text-[10px] text-mute">{r.role}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-sm font-semibold text-cream">{r.revenue}</div>
                  <div className={`text-[10px] ${r.negative ? 'text-mute' : 'text-green-400'}`}>{r.delta}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: r.barW, background: `linear-gradient(90deg,${r.barGrad})` }} />
                </div>
                <span className={`text-[10px] font-${r.highlight ? 'semibold' : 'medium'} ${r.highlight ? 'text-orange' : r.negative ? 'text-mute' : 'text-cream/80'}`}>{r.pct}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const COMISSAO_ROWS = [
  { initials: 'CR', grad: '#ed9326,#ffd400', name: 'Carlos Reis', receita: 'R$ 142.000', pct: '8%', comissao: 'R$ 11.360' },
  { initials: 'PA', grad: '#a855f7,#7c3aed', name: 'Patrícia Alves', receita: 'R$ 124.000', pct: '8%', comissao: 'R$ 9.920' },
  { initials: 'FS', grad: '#3b82f6,#1d4ed8', name: 'Felipe Souza', receita: 'R$ 96.000', pct: '7%', comissao: 'R$ 6.720' },
  { initials: 'ML', grad: '#22c55e,#16a34a', name: 'Marina Lopes', receita: 'R$ 52.000', pct: '6%', comissao: 'R$ 3.120' },
  { initials: 'LM', grad: '#ef4444,#dc2626', name: 'Lucas Martins', receita: 'R$ 38.000', pct: '5%', comissao: 'R$ 1.900' },
];

function PageComissoes() {
  return (
    <div>
      <div className="px-5 pt-5 pb-2 flex items-center justify-between">
        <div>
          <div className="font-display text-base font-semibold text-cream">Comissões</div>
          <div className="text-mute text-[11px]">Maio 2026 &middot; R$ 38.490 a pagar</div>
        </div>
        <button className="text-[10px] px-3 py-1.5 rounded-md font-medium" style={{ background: 'linear-gradient(135deg,#ed9326,#ffb347)', color: '#1c1c1c' }}>Fechar mês</button>
      </div>
      <div className="px-5 py-4">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-[10px] text-mute uppercase">Total a pagar</div>
            <div className="font-display text-xl font-semibold gradient-text-orange mt-1">R$ 38.490</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-[10px] text-mute uppercase">% Receita</div>
            <div className="font-display text-xl font-semibold mt-1">7,9%</div>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-[10px] text-mute uppercase">Pagas</div>
            <div className="font-display text-xl font-semibold mt-1">0 / 5</div>
          </div>
        </div>
        <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[9.5px] text-mute uppercase tracking-wider border-b border-white/5">
            <div className="col-span-4">Vendedor</div>
            <div className="col-span-3">Receita</div>
            <div className="col-span-2">%</div>
            <div className="col-span-3 text-right">Comissão</div>
          </div>
          {COMISSAO_ROWS.map((r, i) => (
            <div key={r.initials} className={`grid grid-cols-12 gap-2 px-3 py-2 text-[11px] items-center ${i < COMISSAO_ROWS.length - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="col-span-4 flex items-center gap-2">
                <div className="avatar w-6 h-6 text-[9px]" style={{ background: `linear-gradient(135deg,${r.grad})` }}>{r.initials}</div>
                {r.name}
              </div>
              <div className="col-span-3 text-cream">{r.receita}</div>
              <div className="col-span-2 text-mute">{r.pct}</div>
              <div className="col-span-3 text-right text-orange font-semibold">{r.comissao}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OraculoPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [showResponse, setShowResponse] = useState(false);

  if (!open) return null;

  return (
    <div className="absolute bottom-16 right-4 z-40">
      <div className="oraculo-card rounded-2xl w-[280px] sm:w-[320px] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-md opacity-60" style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)' }} />
              <div className="relative w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', border: '1px solid rgba(255,255,255,0.18)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l2.4 7.4H22l-6 4.4 2.4 7.4L12 16.8 5.6 21.2 8 13.8l-6-4.4h7.6z" /></svg>
              </div>
            </div>
            <div>
              <div className="text-[12px] font-semibold text-cream flex items-center gap-1.5">
                Oráculo Comercial
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              </div>
              <div className="text-[9.5px] text-mute">3 consultas restantes hoje</div>
            </div>
          </div>
          <button onClick={onClose} className="text-mute hover:text-cream transition w-6 h-6 rounded flex items-center justify-center hover:bg-white/5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="oraculo-msg rounded-xl p-3 text-[11px] text-cream/90 leading-relaxed">
          <span className="block">Olá, Gabriel.</span>
          <span className="block mt-1">Posso analisar seus dados de vendas, performance da equipe e sugerir estratégias. <span className="text-cream font-medium">O que quer saber?</span></span>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {['Como está meu mês?', 'Quem precisa de atenção?', 'Qual produto focar?'].map((chip) => (
            <button key={chip} className="oraculo-chip" onClick={() => setShowResponse(true)}>{chip}</button>
          ))}
        </div>

        {showResponse && (
          <div className="oraculo-msg rounded-xl p-3 text-[11px] text-cream/90 leading-relaxed mt-3">
            <div className="flex items-center gap-1.5 mb-2">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#c084fc"><path d="M12 2l2.4 7.4H22l-6 4.4 2.4 7.4L12 16.8 5.6 21.2 8 13.8l-6-4.4h7.6z" /></svg>
              <span className="text-[10px] font-medium" style={{ color: '#c084fc' }}>Análise do Oráculo</span>
            </div>
            <div>Seu mês está <strong className="text-cream">1% da meta</strong>. Carlos Reis lidera com R$ 142k (137%). Marina Lopes precisa de atenção — 62% da meta. Foque em fechar Vortex Tech (R$ 72k) e Norden (R$ 124k) esta semana.</div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 oraculo-input rounded-xl px-3 py-2">
          <span className="flex-1 text-[11px] text-mute">Pergunte ao Oráculo...</span>
          <button className="w-7 h-7 rounded-lg flex items-center justify-center hover:scale-105 transition-transform" style={{ background: 'linear-gradient(135deg,#a855f7,#7c3aed)', boxShadow: '0 4px 12px rgba(168,85,247,0.4)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>
          </button>
        </div>

        <div className="mt-2.5 flex items-center justify-center gap-1 text-[9px] text-mute">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
          Powered by TorqueAI &middot; seus dados nunca saem do CRM
        </div>
      </div>
    </div>
  );
}

const PAGE_COMPONENTS: Record<PageId, () => JSX.Element> = {
  comando: PageComando,
  chat: PageChat,
  funis: PageFunis,
  turbo: PageTurbo,
  agenda: PageAgenda,
  ranking: PageRanking,
  comissoes: PageComissoes,
};

export function MockupShowcase() {
  const [activePage, setActivePage] = useState<PageId>('comando');
  const [oraculoOpen, setOraculoOpen] = useState(false);

  const ActivePageComponent = PAGE_COMPONENTS[activePage];

  return (
    <section id="mockup-showcase" className="py-20 lg:py-28 relative z-10">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center max-w-3xl mx-auto mb-14 reveal">
          <div className="pill mb-4 inline-flex">
            <span className="dot" />
            <span className="text-cream/90">Veja o sistema operando</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight leading-[1.05]">
            O TorqueCRM <span className="gradient-text-orange">por dentro</span>.
          </h2>
          <p className="text-mute text-base lg:text-lg mt-4 leading-relaxed">
            Clique nas abas do topo (Comando &middot; Chat &middot; Funis...) para navegar entre as telas do sistema.
          </p>
        </div>

        <div className="relative mt-20 hero-mockup mockup-tilt">
          {/* Floating card: Notification */}
          <div className="float-card absolute -top-6 -left-4 sm:-left-12 z-20 hidden md:block">
            <div className="glass-strong glass-card-border rounded-2xl px-4 py-3 w-[280px] glow-soft">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center gradient-orange shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1c1c1c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-cream font-medium">
                    Carlos Andrade <span className="text-mute font-normal">fechou negócio</span>
                  </div>
                  <div className="text-[11px] text-mute mt-0.5">
                    <span className="tag-green inline-block px-1.5 py-0.5 rounded text-[10px]">R$ 24.800</span>
                    <span className="ml-1.5">há 2 segundos</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Floating card: Automation */}
          <div className="float-card delay-1 absolute -top-2 -right-2 sm:-right-10 z-20 hidden md:block">
            <div className="glass-strong glass-card-border rounded-2xl p-4 w-[260px] glow-soft">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                </div>
                <div className="text-[12px] font-medium text-cream">Automação ativada</div>
              </div>
              <div className="text-[11px] text-mute leading-relaxed">
                Quando lead pontuar <span className="text-cream">80+</span>, mover para &quot;Quente&quot; e atribuir a Marina.
              </div>
              <div className="flex items-center gap-1 mt-3 pt-3 border-t border-white/5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] text-mute">Executando &middot; 247 leads processados hoje</span>
              </div>
            </div>
          </div>

          {/* Floating card: Metric */}
          <div className="float-card delay-2 absolute -bottom-4 -left-6 sm:-left-16 z-20 hidden lg:block">
            <div className="glass-strong glass-card-border rounded-2xl p-4 w-[220px] glow-soft">
              <div className="text-[11px] text-mute uppercase tracking-wider mb-2">Taxa de Conversão</div>
              <div className="flex items-end gap-2">
                <div className="font-display text-3xl font-semibold gradient-text-orange">38,4%</div>
                <div className="text-[11px] text-green-400 font-medium mb-1">+12,3%</div>
              </div>
              <svg viewBox="0 0 200 40" className="mt-2 w-full">
                <defs>
                  <linearGradient id="miniGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ed9326" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#ed9326" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M0,30 L20,25 L40,28 L60,18 L80,22 L100,14 L120,16 L140,8 L160,12 L180,5 L200,8 L200,40 L0,40 Z" fill="url(#miniGrad)" />
                <path d="M0,30 L20,25 L40,28 L60,18 L80,22 L100,14 L120,16 L140,8 L160,12 L180,5 L200,8" stroke="#ed9326" strokeWidth="2" fill="none" />
              </svg>
            </div>
          </div>

          {/* MAIN MOCKUP WINDOW */}
          <div className="mock-window relative z-10">
            {/* Titlebar */}
            <div className="mock-titlebar">
              <span className="mock-dot bg-red-500/60" />
              <span className="mock-dot bg-yellow-500/60" />
              <span className="mock-dot bg-green-500/60" />
              <div className="ml-4 flex-1 flex items-center gap-2 text-xs text-mute">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <span>app.torquecrm.com.br</span>
                <span className="text-warm">/ dashboard</span>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-xs text-mute">
                <span className="kbd">&#8984;</span><span className="kbd">K</span>
              </div>
            </div>

            {/* Top nav */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/5" style={{ background: 'rgba(255,255,255,0.015)' }}>
              <div className="flex items-center gap-1">
                <img src="/landing/TORQUE_Logo_Icone.png" className="w-6 h-6 mr-3" alt="" />
                <span className="font-display text-[11px] font-semibold text-cream mr-4 tracking-wide">TORQUE</span>
                {PAGES.map((page) => (
                  <button
                    key={page}
                    onClick={() => setActivePage(page)}
                    className={`nav-link px-2.5 py-1.5 text-[11px] transition cursor-pointer ${activePage === page ? 'active' : ''} ${page === 'comissoes' ? 'hidden lg:inline' : ''}`}
                  >
                    {PAGE_LABELS[page]}
                  </button>
                ))}
                <span className="nav-link px-2.5 py-1.5 text-[11px] transition cursor-pointer hidden xl:flex items-center gap-1">&middot;&middot;&middot; Mais</span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-mute" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                  Basic4u
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>SHADOW</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                  Master
                </div>
                <button className="w-7 h-7 rounded-md flex items-center justify-center text-mute hover:text-cream" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                </button>
                <div className="avatar w-7 h-7 text-[9px]" style={{ background: 'linear-gradient(135deg,#ed9326,#ffd400)' }}>G</div>
              </div>
            </div>

            {/* Pages */}
            <div className="dash-pages">
              <ActivePageComponent />
            </div>

            {/* Oráculo FAB */}
            <div className="absolute bottom-4 right-4 z-30">
              <div className="relative">
                <div className="absolute inset-0 rounded-full blur-xl opacity-60" style={{ background: 'linear-gradient(135deg,#a855f7,#ed9326)' }} />
                <span className="ai-pulse-ring" />
                <span className="ai-pulse-ring" style={{ animationDelay: '0.8s' }} />
                <button onClick={() => setOraculoOpen(!oraculoOpen)} className="relative h-11 pl-1.5 pr-4 rounded-full flex items-center gap-2 cursor-pointer ai-fab-btn" aria-label="Abrir Oráculo IA">
                  <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.15)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l2.4 7.4H22l-6 4.4 2.4 7.4L12 16.8 5.6 21.2 8 13.8l-6-4.4h7.6z" /></svg>
                  </span>
                  <span className="text-[11.5px] font-semibold text-white whitespace-nowrap tracking-wide">Oráculo IA</span>
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center text-white" style={{ background: '#ed9326', boxShadow: '0 0 10px rgba(237,147,38,0.7)' }}>3</span>
                </button>
                {!oraculoOpen && (
                  <div className="absolute right-0 bottom-full mb-3 whitespace-nowrap px-3 py-1.5 rounded-xl text-[11px] font-medium ai-bubble" style={{ background: 'linear-gradient(135deg,#fff,#f8f5e7)', color: '#1c1c1c', boxShadow: '0 8px 24px rgba(168,85,247,0.35), 0 0 0 1px rgba(168,85,247,0.2)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#a855f7"><path d="M12 2l2.4 7.4H22l-6 4.4 2.4 7.4L12 16.8 5.6 21.2 8 13.8l-6-4.4h7.6z" /></svg>
                      Clique e experimente
                    </span>
                    <span className="absolute -bottom-1 right-7 w-2.5 h-2.5 rotate-45" style={{ background: '#f8f5e7', boxShadow: '1px 1px 0 rgba(168,85,247,0.2)' }} />
                  </div>
                )}
              </div>
            </div>

            <OraculoPanel open={oraculoOpen} onClose={() => setOraculoOpen(false)} />
          </div>

          <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[80%] h-32 bg-orange/20 blur-3xl opacity-40 pointer-events-none" />
        </div>
      </div>
    </section>
  );
}
