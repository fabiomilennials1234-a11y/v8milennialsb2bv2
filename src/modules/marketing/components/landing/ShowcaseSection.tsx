export function ShowcaseSection() {
  return (
    <section id="showcase" className="py-24 lg:py-32 relative z-10">
      <div className="max-w-7xl mx-auto px-6">

        <div className="text-center max-w-3xl mx-auto reveal">
          <div className="pill mb-5">
            <span className="dot"></span>
            <span className="text-cream/90">Por dentro do produto</span>
          </div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
            A interface que vendedores<br /><span className="gradient-text-orange">pedem para usar</span>.
          </h2>
          <p className="text-mute text-lg mt-5 leading-relaxed">
            Cada tela foi desenhada com obsessão por velocidade, clareza visual
            e zero fricção. Veja o sistema operando.
          </p>
        </div>

        {/* Showcase stack */}
        <div className="mt-20 showcase-stack space-y-24">

          {/* Screen 1: Pipeline */}
          <div className="reveal">
            <div className="flex flex-col lg:flex-row items-start gap-10">
              <div className="lg:w-1/3 lg:sticky lg:top-32">
                <div className="pill mb-4">
                  <span className="text-orange">01</span>
                  <span className="text-cream/90">Pipeline</span>
                </div>
                <h3 className="font-display text-3xl lg:text-4xl font-semibold leading-tight">
                  Kanban inteligente com previsão de receita.
                </h3>
                <p className="text-mute mt-4 leading-relaxed">
                  Arraste cards entre etapas, edite valores inline e veja o forecast
                  recalcular em tempo real. Cada coluna mostra valor consolidado
                  e probabilidade ponderada.
                </p>
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">Múltiplos funis por produto/equipe</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">Drag-and-drop com regras automáticas</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">Forecast ponderado por estágio</span>
                  </div>
                </div>
              </div>

              <div className="lg:w-2/3">
                <div className="showcase-screen mock-window">
                  <div className="mock-titlebar">
                    <span className="mock-dot bg-red-500/60"></span>
                    <span className="mock-dot bg-yellow-500/60"></span>
                    <span className="mock-dot bg-green-500/60"></span>
                    <div className="ml-4 text-xs text-mute">Pipeline · Vendas Outbound</div>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-4 gap-2">
                      {/* Column 1 */}
                      <div className="pipeline-col p-2.5">
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                            <span className="text-[11px] font-medium">Prospect</span>
                          </div>
                          <span className="text-[9px] text-mute">28</span>
                        </div>
                        <div className="text-[10px] text-mute mb-2">R$ 142k</div>
                        <div className="space-y-1.5">
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="font-medium text-cream mb-1">Zenith S.A.</div>
                            <div className="flex justify-between"><span className="text-mute">R$ 18k</span><span className="text-mute">3d</span></div>
                          </div>
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="font-medium text-cream mb-1">Polaris Mídia</div>
                            <div className="flex justify-between"><span className="text-mute">R$ 8k</span><span className="text-mute">1d</span></div>
                          </div>
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="font-medium text-cream mb-1">Atlas Distrib.</div>
                            <div className="flex justify-between"><span className="text-mute">R$ 24k</span><span className="text-mute">5h</span></div>
                          </div>
                        </div>
                      </div>
                      {/* Column 2 */}
                      <div className="pipeline-col p-2.5">
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                            <span className="text-[11px] font-medium">Qualificado</span>
                          </div>
                          <span className="text-[9px] text-mute">17</span>
                        </div>
                        <div className="text-[10px] text-mute mb-2">R$ 218k</div>
                        <div className="space-y-1.5">
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="font-medium text-cream mb-1">Helix Corp</div>
                            <div className="flex justify-between"><span className="text-mute">R$ 38k</span><span className="text-mute">2d</span></div>
                          </div>
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(237,147,38,0.3)', boxShadow: '0 0 16px rgba(237,147,38,0.15)' }}>
                            <div className="font-medium text-cream mb-1">Vortex Tech</div>
                            <div className="flex justify-between"><span className="text-orange font-semibold">R$ 72k</span><span className="text-mute">4h</span></div>
                          </div>
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="font-medium text-cream mb-1">Mira Saúde</div>
                            <div className="flex justify-between"><span className="text-mute">R$ 14k</span><span className="text-mute">2h</span></div>
                          </div>
                        </div>
                      </div>
                      {/* Column 3 */}
                      <div className="pipeline-col p-2.5">
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange"></span>
                            <span className="text-[11px] font-medium">Proposta</span>
                          </div>
                          <span className="text-[9px] text-mute">9</span>
                        </div>
                        <div className="text-[10px] text-mute mb-2">R$ 324k</div>
                        <div className="space-y-1.5">
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="font-medium text-cream mb-1">Acme Logística</div>
                            <div className="flex justify-between"><span className="text-mute">R$ 48k</span><span className="text-mute">1d</span></div>
                          </div>
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="font-medium text-cream mb-1">Norden Ind.</div>
                            <div className="flex justify-between"><span className="text-mute">R$ 124k</span><span className="text-mute">6h</span></div>
                          </div>
                        </div>
                      </div>
                      {/* Column 4 */}
                      <div className="pipeline-col p-2.5">
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                            <span className="text-[11px] font-medium">Fechado</span>
                          </div>
                          <span className="text-[9px] text-mute">12</span>
                        </div>
                        <div className="text-[10px] text-mute mb-2">R$ 487k</div>
                        <div className="space-y-1.5">
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
                            <div className="font-medium text-cream mb-1">Quanta SaaS</div>
                            <div className="flex justify-between"><span className="text-green-400 font-semibold">R$ 96k</span><span className="text-mute">&#10003;</span></div>
                          </div>
                          <div className="rounded p-2 text-[10px]" style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)' }}>
                            <div className="font-medium text-cream mb-1">Stratus Cloud</div>
                            <div className="flex justify-between"><span className="text-green-400 font-semibold">R$ 56k</span><span className="text-mute">&#10003;</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Screen 2: Automações (reversed layout) */}
          <div className="reveal">
            <div className="flex flex-col lg:flex-row-reverse items-start gap-10">
              <div className="lg:w-1/3 lg:sticky lg:top-32">
                <div className="pill mb-4">
                  <span className="text-orange">02</span>
                  <span className="text-cream/90">Automações</span>
                </div>
                <h3 className="font-display text-3xl lg:text-4xl font-semibold leading-tight">
                  Construa fluxos que vendem<br />enquanto você dorme.
                </h3>
                <p className="text-mute mt-4 leading-relaxed">
                  Editor visual no-code, gatilhos por evento ou tempo,
                  ramificações condicionais e integração nativa com WhatsApp,
                  e-mail, Slack e mais de 200 ferramentas.
                </p>
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">200+ integrações nativas</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">Editor visual no-code</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">IA para qualificação automática</span>
                  </div>
                </div>
              </div>

              <div className="lg:w-2/3">
                <div className="showcase-screen mock-window">
                  <div className="mock-titlebar">
                    <span className="mock-dot bg-red-500/60"></span>
                    <span className="mock-dot bg-yellow-500/60"></span>
                    <span className="mock-dot bg-green-500/60"></span>
                    <div className="ml-4 text-xs text-mute">Automação · Boas-vindas e qualificação</div>
                  </div>
                  <div className="p-8">
                    {/* Flow builder mockup */}
                    <div className="flex flex-col items-center gap-3">
                      {/* Trigger */}
                      <div className="rounded-xl p-3 w-72 flex items-center gap-3" style={{ background: 'rgba(237,147,38,0.08)', border: '1px solid rgba(237,147,38,0.3)' }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center gradient-orange">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1c1c1c" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-mute uppercase tracking-wider">Gatilho</div>
                          <div className="text-sm font-medium">Lead criado via formulário</div>
                        </div>
                      </div>
                      <div className="w-px h-6 bg-white/10"></div>
                      {/* Action 1 */}
                      <div className="rounded-xl p-3 w-72 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-mute uppercase tracking-wider">Ação</div>
                          <div className="text-sm font-medium">Enviar e-mail de boas-vindas</div>
                        </div>
                      </div>
                      <div className="w-px h-6 bg-white/10"></div>
                      {/* Condition */}
                      <div className="rounded-xl p-3 w-72 flex items-center gap-3" style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)' }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c084fc" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-mute uppercase tracking-wider">Condição IA</div>
                          <div className="text-sm font-medium">Score ≥ 80?</div>
                        </div>
                      </div>
                      {/* Branches */}
                      <div className="grid grid-cols-2 gap-4 w-full max-w-xl">
                        <div>
                          <div className="text-center text-[10px] text-green-400 mb-2 font-medium">SIM</div>
                          <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(237,147,38,0.15)', border: '1px solid rgba(237,147,38,0.3)' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f5a93f" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                            </div>
                            <div className="text-[12px] font-medium leading-tight">Mover para<br />&quot;Quente&quot;</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-center text-[10px] text-mute mb-2 font-medium">NÃO</div>
                          <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)' }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                            </div>
                            <div className="text-[12px] font-medium leading-tight">Agendar<br />follow-up 3d</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Screen 3: Analytics */}
          <div className="reveal">
            <div className="flex flex-col lg:flex-row items-start gap-10">
              <div className="lg:w-1/3 lg:sticky lg:top-32">
                <div className="pill mb-4">
                  <span className="text-orange">03</span>
                  <span className="text-cream/90">Analytics</span>
                </div>
                <h3 className="font-display text-3xl lg:text-4xl font-semibold leading-tight">
                  Insights que viram<br />decisão imediata.
                </h3>
                <p className="text-mute mt-4 leading-relaxed">
                  Funil completo, taxa de conversão por etapa, ciclo médio,
                  cohort de retenção e atribuição multi-touch.
                  Sua receita explicada em segundos.
                </p>
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">Dashboards customizáveis</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">Drill-down por qualquer dimensão</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-orange"></div>
                    <span className="text-cream/90">Forecasting com IA</span>
                  </div>
                </div>
              </div>

              <div className="lg:w-2/3">
                <div className="showcase-screen mock-window">
                  <div className="mock-titlebar">
                    <span className="mock-dot bg-red-500/60"></span>
                    <span className="mock-dot bg-yellow-500/60"></span>
                    <span className="mock-dot bg-green-500/60"></span>
                    <div className="ml-4 text-xs text-mute">Analytics · Performance Comercial</div>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-3 gap-3 mb-5">
                      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="text-[10px] text-mute uppercase">Ciclo médio</div>
                        <div className="font-display text-xl font-semibold mt-1">14d</div>
                        <div className="text-[10px] text-green-400">-3d vs mês anterior</div>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="text-[10px] text-mute uppercase">LTV</div>
                        <div className="font-display text-xl font-semibold mt-1">R$ 28.4k</div>
                        <div className="text-[10px] text-green-400">+12%</div>
                      </div>
                      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div className="text-[10px] text-mute uppercase">CAC</div>
                        <div className="font-display text-xl font-semibold mt-1">R$ 1.842</div>
                        <div className="text-[10px] text-green-400">-R$ 280</div>
                      </div>
                    </div>

                    {/* Funnel */}
                    <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="flex items-center justify-between mb-4">
                        <div className="font-display text-sm font-semibold">Funil de conversão</div>
                        <div className="text-[10px] text-mute">38,4% taxa final</div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="w-24 text-[11px] text-mute">Visitantes</div>
                          <div className="flex-1 h-7 rounded-lg overflow-hidden flex items-center px-2 text-[10px] font-medium" style={{ background: 'linear-gradient(90deg,#ed9326,#ed9326cc)', width: '100%' }}>8.420</div>
                          <div className="w-12 text-[10px] text-mute text-right">100%</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 text-[11px] text-mute">Leads</div>
                          <div className="flex-1 h-7 rounded-lg overflow-hidden flex items-center px-2 text-[10px] font-medium" style={{ background: 'linear-gradient(90deg,#ed932699,#ed932666)', width: '78%' }}>6.580</div>
                          <div className="w-12 text-[10px] text-mute text-right">78%</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 text-[11px] text-mute">Qualificados</div>
                          <div className="flex-1 h-7 rounded-lg overflow-hidden flex items-center px-2 text-[10px] font-medium" style={{ background: 'linear-gradient(90deg,#ed932680,#ed932640)', width: '54%' }}>4.547</div>
                          <div className="w-12 text-[10px] text-mute text-right">54%</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 text-[11px] text-mute">Propostas</div>
                          <div className="flex-1 h-7 rounded-lg overflow-hidden flex items-center px-2 text-[10px] font-medium" style={{ background: 'linear-gradient(90deg,#ed932660,#ed932630)', width: '32%' }}>2.694</div>
                          <div className="w-12 text-[10px] text-mute text-right">32%</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-24 text-[11px] text-mute">Fechados</div>
                          <div className="flex-1 h-7 rounded-lg overflow-hidden flex items-center px-2 text-[10px] font-medium text-cream" style={{ background: 'linear-gradient(90deg,#4ade80,#4ade8060)', width: '19%' }}>1.595</div>
                          <div className="w-12 text-[10px] text-green-400 text-right">19%</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
