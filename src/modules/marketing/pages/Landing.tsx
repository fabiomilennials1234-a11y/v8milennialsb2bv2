import { useRef } from 'react';
import '@/styles/landing.css';
import { LandingBackground } from '@/modules/marketing/components/landing/LandingBackground';
import { LandingNavbar } from '@/modules/marketing/components/landing/LandingNavbar';
import { HeroSection } from '@/modules/marketing/components/landing/HeroSection';
import { MockupShowcase } from '@/modules/marketing/components/landing/MockupShowcase';
import { BrandsMarquee } from '@/modules/marketing/components/landing/BrandsMarquee';
import { BenefitsGrid } from '@/modules/marketing/components/landing/BenefitsGrid';
import { ShowcaseSection } from '@/modules/marketing/components/landing/ShowcaseSection';
import { SocialProof } from '@/modules/marketing/components/landing/SocialProof';
import { FinalCTA } from '@/modules/marketing/components/landing/FinalCTA';
import { LandingFooter } from '@/modules/marketing/components/landing/LandingFooter';
import { useLandingAnimations } from '@/modules/marketing/hooks/useLandingAnimations';

export default function Landing() {
  const containerRef = useRef<HTMLDivElement>(null);
  useLandingAnimations(containerRef);

  return (
    <div className="landing-page font-sans antialiased" ref={containerRef}>
      <LandingBackground />
      <LandingNavbar />
      <HeroSection />
      <MockupShowcase />
      <BrandsMarquee />
      <BenefitsGrid />
      <div className="divider-line max-w-7xl mx-auto" />
      <ShowcaseSection />
      <SocialProof />
      <div className="divider-line max-w-7xl mx-auto" />
      <FinalCTA />
      <LandingFooter />
    </div>
  );
}
