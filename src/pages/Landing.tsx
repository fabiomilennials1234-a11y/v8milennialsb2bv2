import { useEffect } from 'react';
import '@/styles/landing.css';
import { LandingNavbar } from '@/components/landing/LandingNavbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { LogosMarquee } from '@/components/landing/LogosMarquee';
import { FeatureShowcase } from '@/components/landing/FeatureShowcase';
import { SegmentsGrid } from '@/components/landing/SegmentsGrid';
import { TestimonialsGrid } from '@/components/landing/TestimonialsGrid';
import { PricingSection } from '@/components/landing/PricingSection';
import { FAQAccordion } from '@/components/landing/FAQAccordion';
import { CTAFinal } from '@/components/landing/CTAFinal';
import { LandingFooter } from '@/components/landing/LandingFooter';

const FA_HREF = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
const FA_LINK_ID = 'fa-landing-css';

export default function Landing() {
  useEffect(() => {
    if (document.getElementById(FA_LINK_ID)) return;
    const link = document.createElement('link');
    link.id = FA_LINK_ID;
    link.rel = 'stylesheet';
    link.href = FA_HREF;
    link.crossOrigin = 'anonymous';
    link.referrerPolicy = 'no-referrer';
    document.head.appendChild(link);
  }, []);

  return (
    <div className="landing-page">
      <LandingNavbar />
      <HeroSection />
      <LogosMarquee />
      <FeatureShowcase />
      <SegmentsGrid />
      <TestimonialsGrid />
      <PricingSection />
      <FAQAccordion />
      <CTAFinal />
      <LandingFooter />

      {/* WhatsApp floating button */}
      <a
        href="https://wa.me/5500000000000"
        className="wa"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
      >
        <i className="fab fa-whatsapp"></i>
      </a>
    </div>
  );
}
