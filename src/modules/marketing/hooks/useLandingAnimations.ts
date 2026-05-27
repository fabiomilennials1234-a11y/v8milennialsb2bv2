import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function useLandingAnimations(containerRef: React.RefObject<HTMLDivElement | null>) {
  const rafIds = useRef<number[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const ctx = gsap.context(() => {
      // --- Hero entrance ---
      const HERO_SELECTORS = '.hero-pill, .hero-title .line, .hero-sub, .hero-cta > *, .hero-trust > *';
      const heroTL = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => {
          gsap.set(HERO_SELECTORS, { clearProps: 'opacity,transform,translate,rotate,scale' });
        },
      });
      heroTL
        .from('.hero-pill', { y: 20, opacity: 0, duration: 0.8 })
        .from('.hero-title .line', { y: 40, opacity: 0, duration: 1, stagger: 0.12 }, '-=0.4')
        .from('.hero-sub', { y: 20, opacity: 0, duration: 0.8 }, '-=0.5')
        .from('.hero-cta > *', { y: 20, opacity: 0, duration: 0.6 }, '-=0.4')
        .from('.hero-trust > *', { opacity: 0, duration: 0.6, stagger: 0.05 }, '-=0.3');

      const failsafeTimer = setTimeout(() => {
        root.querySelectorAll(HERO_SELECTORS).forEach((el) => {
          const htmlEl = el as HTMLElement;
          if (parseFloat(getComputedStyle(htmlEl).opacity) < 0.9) {
            gsap.killTweensOf(htmlEl);
            gsap.set(htmlEl, { opacity: 1, y: 0, scale: 1, clearProps: 'transform,translate,rotate,scale' });
          }
        });
      }, 1500);
      timers.current.push(failsafeTimer);

      // --- Scroll reveal ---
      root.querySelectorAll('.reveal').forEach((el) => {
        ScrollTrigger.create({
          trigger: el,
          start: 'top 88%',
          onEnter: () => el.classList.add('visible'),
        });
      });

      // --- Mockup parallax ---
      const mockupSection = root.querySelector('#mockup-showcase') as HTMLElement | null;
      const mockupTilt = mockupSection?.querySelector('.hero-mockup') as HTMLElement | null;
      if (mockupSection && mockupTilt) {
        const onMockupMove = (e: MouseEvent) => {
          const rect = mockupSection.getBoundingClientRect();
          const cx = rect.width / 2;
          const cy = rect.height / 2;
          const dx = (e.clientX - rect.left - cx) / cx;
          const dy = (e.clientY - rect.top - cy) / cy;
          gsap.to(mockupTilt, {
            rotateY: -4 + dx * 3,
            rotateX: 8 - dy * 3,
            duration: 0.6,
            ease: 'power2.out',
            overwrite: 'auto',
          });
          mockupSection.querySelectorAll('.float-card').forEach((el, i) => {
            gsap.to(el, {
              x: dx * (i + 1) * 8,
              y: dy * (i + 1) * 6,
              duration: 0.8,
              ease: 'power2.out',
              overwrite: 'auto',
            });
          });
        };
        mockupSection.addEventListener('mousemove', onMockupMove);
      }

      // --- Benefit card hover gradient ---
      root.querySelectorAll('.benefit-card').forEach((card) => {
        const htmlCard = card as HTMLElement;
        htmlCard.addEventListener('mousemove', (e: MouseEvent) => {
          const rect = htmlCard.getBoundingClientRect();
          htmlCard.style.setProperty('--mx', `${e.clientX - rect.left}px`);
          htmlCard.style.setProperty('--my', `${e.clientY - rect.top}px`);
        });
      });

      // --- Logo stage: hover tilt + drag rotate ---
      const logoStage = root.querySelector('#hero-logo-stage') as HTMLElement | null;
      if (logoStage) {
        let hoverX = 0, hoverY = 0;
        let dragRotX = 0, dragRotY = 0;
        let curX = 0, curY = 0;
        let isDragging = false;
        let lastX = 0, lastY = 0;
        const AMPL = 28;

        const sensor = root.querySelector('#hero') || logoStage;

        const getPoint = (e: MouseEvent | TouchEvent) => {
          const t = 'touches' in e ? e.touches[0] : null;
          return t ? { x: t.clientX, y: t.clientY } : { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
        };

        const onSensorMove = (e: MouseEvent) => {
          if (isDragging) return;
          const r = sensor.getBoundingClientRect();
          const x = (e.clientX - r.left - r.width / 2) / r.width;
          const y = (e.clientY - r.top - r.height / 2) / r.height;
          hoverY = x * AMPL;
          hoverX = -y * AMPL;
        };
        const onSensorLeave = () => {
          if (isDragging) return;
          hoverX = 0;
          hoverY = 0;
        };

        sensor.addEventListener('mousemove', onSensorMove as EventListener);
        sensor.addEventListener('mouseleave', onSensorLeave);

        const onDown = (e: MouseEvent | TouchEvent) => {
          isDragging = true;
          const p = getPoint(e);
          lastX = p.x;
          lastY = p.y;
          logoStage.style.cursor = 'grabbing';
          e.preventDefault();
        };
        logoStage.addEventListener('mousedown', onDown as EventListener);
        logoStage.addEventListener('touchstart', onDown as EventListener, { passive: false });

        const onDragMove = (e: MouseEvent | TouchEvent) => {
          if (!isDragging) return;
          const p = getPoint(e);
          dragRotY += (p.x - lastX) * 0.5;
          dragRotX -= (p.y - lastY) * 0.5;
          dragRotX = Math.max(-55, Math.min(55, dragRotX));
          dragRotY = Math.max(-55, Math.min(55, dragRotY));
          lastX = p.x;
          lastY = p.y;
          if ('cancelable' in e && e.cancelable) e.preventDefault();
        };
        window.addEventListener('mousemove', onDragMove as EventListener);
        window.addEventListener('touchmove', onDragMove as EventListener, { passive: false });

        const onUp = () => {
          if (!isDragging) return;
          isDragging = false;
          logoStage.style.cursor = 'grab';
        };
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        window.addEventListener('touchcancel', onUp);

        const tiltLoop = () => {
          if (!isDragging) {
            dragRotX *= 0.92;
            dragRotY *= 0.92;
            if (Math.abs(dragRotX) < 0.05) dragRotX = 0;
            if (Math.abs(dragRotY) < 0.05) dragRotY = 0;
          }
          const targetX = isDragging ? dragRotX : dragRotX + hoverX;
          const targetY = isDragging ? dragRotY : dragRotY + hoverY;
          const k = isDragging ? 0.45 : 0.12;
          curX += (targetX - curX) * k;
          curY += (targetY - curY) * k;
          logoStage.style.setProperty('--tilt-x', curX.toFixed(2) + 'deg');
          logoStage.style.setProperty('--tilt-y', curY.toFixed(2) + 'deg');
          const id = requestAnimationFrame(tiltLoop);
          rafIds.current.push(id);
        };
        const tiltId = requestAnimationFrame(tiltLoop);
        rafIds.current.push(tiltId);
      }

      // --- Navbar scroll ---
      const nav = root.querySelector('#navbar') as HTMLElement | null;
      if (nav) {
        const onScroll = () => {
          if (window.scrollY > 20) {
            nav.classList.add('shadow-2xl', 'py-3');
            nav.classList.remove('py-5');
          } else {
            nav.classList.remove('shadow-2xl', 'py-3');
            nav.classList.add('py-5');
          }
        };
        window.addEventListener('scroll', onScroll, { passive: true });
      }
    }, root);

    return () => {
      ctx.revert();
      rafIds.current.forEach(cancelAnimationFrame);
      timers.current.forEach(clearTimeout);
      rafIds.current = [];
      timers.current = [];
    };
  }, [containerRef]);
}
