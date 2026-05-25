import { useRef } from 'react';
import '@/styles/landing.css';
import { LandingBackground } from '@/components/landing/LandingBackground';
import { LandingNavbar } from '@/components/landing/LandingNavbar';
import { HeroSection } from '@/components/landing/HeroSection';
import { MockupShowcase } from '@/components/landing/MockupShowcase';
import { BrandsMarquee } from '@/components/landing/BrandsMarquee';
import { BenefitsGrid } from '@/components/landing/BenefitsGrid';
import { ShowcaseSection } from '@/components/landing/ShowcaseSection';
import { SocialProof } from '@/components/landing/SocialProof';
import { FinalCTA } from '@/components/landing/FinalCTA';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { useLandingAnimations } from '@/hooks/useLandingAnimations';

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
