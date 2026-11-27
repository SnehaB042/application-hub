(() => {
  'use strict';
  const canvas = document.getElementById('bg');
  const ctx = canvas.getContext('2d');
  const COUNT = 80, LINK = 120, REPEL = 120;
  const COLORS = ['255,255,255', '186,230,253', '224,242,254', '165,216,255'];
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = mq.matches;
  let w = 0, h = 0, raf = 0, particles = [];
  const mouse = { x: -9999, y: -9999 };
  const rand = (a, b) => a + Math.random() * (b - a);

  function make() {
    const a = Math.random() * Math.PI * 2, s = rand(0.08, 0.28);
    return {
      x: rand(0, w), y: rand(0, h), vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      r: rand(0.8, 2.1), c: COLORS[(Math.random() * COLORS.length) | 0],
      ph: rand(0, Math.PI * 2), ts: rand(0.0005, 0.0016)
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!particles.length) particles = Array.from({ length: COUNT }, make);
    for (const p of particles) { p.x = Math.min(p.x, w); p.y = Math.min(p.y, h); }
    draw(performance.now());
  }

  function step() {
    for (const p of particles) {
      const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
      if (d < REPEL && d > 0.01) {
        const f = (1 - d / REPEL) * 1.6;
        p.x += (dx / d) * f; p.y += (dy / d) * f;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
    }
  }

  function draw(t) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#090A0F';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h * 1.08, 0, w / 2, h * 1.08, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(56, 100, 170, 0.34)');
    g.addColorStop(0.5, 'rgba(40, 64, 120, 0.12)');
    g.addColorStop(1, 'rgba(9, 10, 15, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < LINK) {
          ctx.globalAlpha = 1 - d / LINK;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (const p of particles) {
      ctx.globalAlpha = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(t * p.ts + p.ph) * 0.9;
      ctx.fillStyle = `rgb(${p.c})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(t) {
    step(); draw(t);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    cancelAnimationFrame(raf);
    if (reduced || document.hidden) { draw(performance.now()); return; }
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  document.addEventListener('mouseleave', () => { mouse.x = mouse.y = -9999; });
  document.addEventListener('visibilitychange', start);
  const onMq = (e) => { reduced = e.matches; start(); };
  if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);

  resize();
  start();
})();
