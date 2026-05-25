export function BrandsMarquee() {
  return (
    <section className="py-16 relative z-10">
      <div className="max-w-7xl mx-auto px-6">
        <p className="text-center text-xs uppercase tracking-[0.2em] text-mute mb-8">
          Operações comerciais que confiam no TorqueCRM
        </p>
        <div className="marquee-mask overflow-hidden">
          <div className="marquee">
            {/* Loop 1 */}
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">VORTEX</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition italic">Helix.</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition tracking-[0.3em]">NORDEN</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition font-bold">&#9670; Acme</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">Quanta<span className="text-orange">.</span></span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">PROTON</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">Stratus</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">&#9650; Pinnacle</span>
            {/* Loop 2 (duplicate for seamless scroll) */}
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">VORTEX</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition italic">Helix.</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition tracking-[0.3em]">NORDEN</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition font-bold">&#9670; Acme</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">Quanta<span className="text-orange">.</span></span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">PROTON</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">Stratus</span>
            <span className="font-display text-2xl text-warm/60 hover:text-cream transition">&#9650; Pinnacle</span>
          </div>
        </div>
      </div>
    </section>
  );
}
