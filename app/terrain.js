import { lerpColor } from "./ui-core.mjs";

const VISUAL = Object.freeze({
  pressRadiusStart: 8,
  pressRadiusEnd: 40,
  pressDurationMs: 700,
  answerRadiusStart: 6,
  answerRadiusEnd: 24,
  bloomWhiteMix: 0.12,
  endingReturnMs: 1500,
  pressRiseFactor: 2,
});

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createTerrain(canvas) {
  const context = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0;
  let height = 0;
  let displayedTension = 0;
  let tensionFrom = 0;
  let tensionTarget = 0;
  let tensionStartedAt = performance.now();
  let tensionDurationMs;
  let bloomStartedAt = -Infinity;
  let effects = [];
  let frame;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function duration(name) {
    const raw = cssColor(name);
    return raw.endsWith("ms") ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
  }

  function setTension(value, customDurationMs) {
    const next = Math.min(1, Math.max(0, value));
    if (Math.abs(next - tensionTarget) < 0.001 && customDurationMs === undefined) return;
    if (reducedMotion.matches) displayedTension = next;
    tensionFrom = displayedTension;
    tensionTarget = next;
    tensionStartedAt = performance.now();
    tensionDurationMs = customDurationMs;
  }

  function press(rect, role) {
    if (reducedMotion.matches) return;
    effects.push({
      kind: "press",
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      color: cssColor(`--ink-${role}`),
      startedAt: performance.now(),
    });
  }

  function answer() {
    if (reducedMotion.matches) return;
    effects.push({
      kind: "answer",
      x: width / 2,
      y: height,
      color: cssColor("--ink-stable"),
      startedAt: performance.now(),
    });
  }

  function bloom() {
    if (!reducedMotion.matches) bloomStartedAt = performance.now();
  }

  function drawEffect(effect, now) {
    const elapsed = now - effect.startedAt;
    const progress = Math.min(1, elapsed / VISUAL.pressDurationMs);
    const isAnswer = effect.kind === "answer";
    const startRadius = isAnswer ? VISUAL.answerRadiusStart : VISUAL.pressRadiusStart;
    const endRadius = isAnswer ? VISUAL.answerRadiusEnd : VISUAL.pressRadiusEnd;
    const radius = startRadius + (endRadius - startRadius) * progress;
    const rise = isAnswer ? radius : radius * VISUAL.pressRiseFactor;
    context.beginPath();
    context.arc(effect.x, effect.y - rise, radius, 0, Math.PI * 2);
    context.strokeStyle = effect.color;
    context.globalAlpha = 1 - progress;
    context.lineWidth = 1.5;
    context.stroke();
    context.globalAlpha = 1;
    return progress < 1;
  }

  function draw(now) {
    if (!document.hidden) {
      const tenseDuration = tensionDurationMs ?? duration("--duration-tense");
      const progress = reducedMotion.matches ? 1 : Math.min(1, (now - tensionStartedAt) / tenseDuration);
      displayedTension = tensionFrom + (tensionTarget - tensionFrom) * progress;
      let background = lerpColor(cssColor("--bg"), cssColor("--bg-tense"), displayedTension);
      const bloomProgress = (now - bloomStartedAt) / duration("--duration-bloom");
      if (bloomProgress >= 0 && bloomProgress < 1) {
        const lightToken = document.documentElement.dataset.world === "night" ? "--btn" : "--btn-text";
        background = lerpColor(background, cssColor(lightToken), Math.sin(bloomProgress * Math.PI) * VISUAL.bloomWhiteMix);
      }
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      effects = effects.filter((effect) => drawEffect(effect, now));
    }
    frame = requestAnimationFrame(draw);
  }

  function setWorld() {
    tensionFrom = tensionTarget;
    displayedTension = tensionTarget;
  }

  function end() {
    setTension(0, reducedMotion.matches ? 0 : VISUAL.endingReturnMs);
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !frame) frame = requestAnimationFrame(draw);
  });
  resize();
  frame = requestAnimationFrame(draw);

  return { answer, bloom, end, press, setTension, setWorld };
}
