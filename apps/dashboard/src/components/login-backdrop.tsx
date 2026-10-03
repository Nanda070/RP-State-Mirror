"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
  speed: number;
  ember: boolean;
  spark: boolean;
};

const STAR_RGB = "214, 226, 255";
const EMBER_RGB = "255, 150, 60";
const LINK_DISTANCE = 105;
const EDGE = 24;

/** Pre-rendered soft dot: cheaper than shadowBlur on every frame. */
function glowSprite(rgb: string, size: number): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, `rgba(${rgb}, 1)`);
    gradient.addColorStop(0.25, `rgba(${rgb}, 0.35)`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return sprite;
}

function spawn(width: number, height: number): Particle {
  const ember = Math.random() < 0.22;
  const angle = Math.random() * Math.PI * 2;
  const velocity = 2 + Math.random() * 5;
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    // Embers float up, stars wander.
    vx: ember ? (Math.random() - 0.5) * 4 : Math.cos(angle) * velocity,
    vy: ember ? -(4 + Math.random() * 6) : Math.sin(angle) * velocity,
    r: ember ? 0.6 + Math.random() * 0.8 : 0.5 + Math.random() * 0.9,
    phase: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 1.1,
    ember,
    spark: !ember && Math.random() < 0.16,
  };
}

function StarField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const starSprite = glowSprite(STAR_RGB, 64);
    const emberSprite = glowSprite(EMBER_RGB, 160);

    let width = 0;
    let height = 0;
    const particles: Particle[] = [];
    let frame = 0;
    let last = 0;

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, width, height);

      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.phase += p.speed * dt;
        if (p.x < -EDGE) p.x = width + EDGE;
        else if (p.x > width + EDGE) p.x = -EDGE;
        if (p.y < -EDGE) p.y = height + EDGE;
        else if (p.y > height + EDGE) p.y = -EDGE;
      }

      const stars = particles.filter((p) => !p.ember);
      ctx.lineWidth = 1;
      for (let i = 0; i < stars.length; i++) {
        const a = stars[i]!;
        for (let j = i + 1; j < stars.length; j++) {
          const b = stars[j]!;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance >= LINK_DISTANCE) continue;
          ctx.strokeStyle = `rgba(${STAR_RGB}, ${(1 - distance / LINK_DISTANCE) * 0.15})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const p of particles) {
        const twinkle = 0.55 + 0.45 * Math.sin(p.phase);
        const size = p.ember ? p.r * 17 : p.r * 7;
        ctx.globalAlpha = p.ember ? 0.75 * twinkle : twinkle;
        ctx.drawImage(p.ember ? emberSprite : starSprite, p.x - size / 2, p.y - size / 2, size, size);
        if (p.spark) {
          const arm = p.r * 6 * twinkle;
          ctx.globalAlpha = 0.7 * twinkle;
          ctx.strokeStyle = `rgb(${STAR_RGB})`;
          ctx.beginPath();
          ctx.moveTo(p.x - arm, p.y);
          ctx.lineTo(p.x + arm, p.y);
          ctx.moveTo(p.x, p.y - arm);
          ctx.lineTo(p.x, p.y + arm);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const nextWidth = canvas.clientWidth;
      const nextHeight = canvas.clientHeight;
      if (!nextWidth || !nextHeight) return;

      // Keep the field in place on resize (mobile URL bar) instead of reseeding.
      if (width && height) {
        for (const p of particles) {
          p.x *= nextWidth / width;
          p.y *= nextHeight / height;
        }
      }
      width = nextWidth;
      height = nextHeight;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(110, Math.round((width * height) / 11000));
      while (particles.length < count) particles.push(spawn(width, height));
      particles.length = count;

      if (reduced) draw(0);
    };

    const tick = (now: number) => {
      draw(Math.min((now - last) / 1000, 0.05));
      last = now;
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (reduced || frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="login-bg-stars" />;
}

/** Layered ambient backdrop for the login screen: gradients, drifting blobs, beams, star field. */
export function LoginBackdrop() {
  return (
    <div className="login-bg" aria-hidden>
      <div className="login-bg-base" />
      <div className="login-bg-blob login-bg-blob-a" />
      <div className="login-bg-blob login-bg-blob-b" />
      <div className="login-bg-blob login-bg-blob-c" />
      <div className="login-bg-sweep" />
      <div className="login-bg-beam login-bg-beam-warm" />
      <div className="login-bg-beam login-bg-beam-cool" />
      <svg className="login-bg-mark" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 3.5 19 8v8l-7 4.5L5 16V8l7-4.5Z" />
      </svg>
      <StarField />
      <div className="login-bg-horizon" />
      {/* Los Santos against the glow: two rows of buildings, the far one lighter. */}
      <svg className="login-bg-skyline login-bg-skyline-far" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">
        <path d="M0 200V150h40v-22h26v22h30v-46h18v-14h22v14h16v60h34v-34h40v34h22v-72h14v-18h26v18h12v72h30v-50h44v50h20v-96h10v-22h14v-16h10v16h14v22h10v96h36v-58h38v58h22v-40h46v40h18v-84h16v-16h28v16h14v84h32v-52h40v52h24v-30h50v30h20v-66h34v66h28v-44h44v44h30v50Z" />
      </svg>
      <svg className="login-bg-skyline" viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice">
        <path d="M0 200V168h56v-26h34v26h22v-58h20v-12h30v12h18v70h40v-40h52v40h26v-92h16v-20h34v20h14v92h38v-64h48v64h30v-124h12v-26h16v-22h12v22h16v26h12v124h44v-78h46v78h26v-50h58v50h22v-104h20v-18h36v18h16v104h40v-66h50v66h28v-38h62v38h24v-84h42v84h30v32Z" />
      </svg>
      <div className="login-bg-horizon-line" />
      <div className="login-bg-vignette" />
      <div className="login-bg-grain" />
    </div>
  );
}
