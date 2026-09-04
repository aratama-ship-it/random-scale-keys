import { fieldAt, lerpColor, marchingSquares, roleElevation } from "./ui-core.mjs";

const VISUAL = Object.freeze({
  pressRadiusStart: 8,
  pressRadiusEnd: 40,
  pressDurationMs: 700,
  answerRadiusStart: 6,
  answerRadiusEnd: 24,
  bloomWhiteMix: 0.12,
  endingReturnMs: 1500,
  pressRiseFactor: 2,
  drawingLineWidth: 1.5,
  contourGridPx: 8,
  contourSigmaFactor: 1.2,
  contourFlatThreshold: 0.04,
  contourLevels: Object.freeze([-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]),
  ridgeMinimum: 0.6,
});

function cssColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createTerrain(canvas) {
  const context = canvas.getContext("2d");
  const contourCanvas = document.createElement("canvas");
  const contourContext = contourCanvas.getContext("2d");
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
  let pixelRatio = 1;
  let contourSources = [];
  let contourTop = 0;
  let contourBottom = 0;

  function numericToken(name) {
    return Number.parseFloat(cssColor(name));
  }

  function rebuildContours() {
    contourCanvas.width = Math.round(width * pixelRatio);
    contourCanvas.height = Math.round(height * pixelRatio);
    contourContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    contourContext.clearRect(0, 0, width, height);
    if (!contourSources.length || contourBottom <= contourTop) return;

    const cellSize = VISUAL.contourGridPx;
    const cols = Math.ceil(width / cellSize) + 1;
    const rows = Math.ceil((contourBottom - contourTop) / cellSize) + 1;
    const sigma = numericToken("--key-size") * VISUAL.contourSigmaFactor;
    const localSources = contourSources.map((source) => ({
      x: source.x,
      y: source.y - contourTop,
      elevation: roleElevation(source.role),
    }));
    const grid = new Float64Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        grid[row * cols + col] = fieldAt(col * cellSize, row * cellSize, localSources, sigma);
      }
    }

    contourContext.lineWidth = numericToken("--contour-width");
    VISUAL.contourLevels.forEach((level) => {
      const ridge = level >= VISUAL.ridgeMinimum;
      contourContext.beginPath();
      marchingSquares(grid, cols, rows, level, cellSize, VISUAL.contourFlatThreshold).forEach(([start, end]) => {
        contourContext.moveTo(start.x, start.y + contourTop);
        contourContext.lineTo(end.x, end.y + contourTop);
      });
      contourContext.strokeStyle = cssColor(ridge ? "--ink-tension" : "--text");
      contourContext.globalAlpha = numericToken(ridge ? "--contour-alpha-ridge" : "--contour-alpha");
      contourContext.stroke();
    });
    contourContext.globalAlpha = 1;
  }

  function resize() {
    pixelRatio = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    rebuildContours();
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
    context.lineWidth = VISUAL.drawingLineWidth;
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
      context.drawImage(contourCanvas, 0, 0, width, height);
      effects = effects.filter((effect) => drawEffect(effect, now));
    }
    frame = requestAnimationFrame(draw);
  }

  function setWorld() {
    tensionFrom = tensionTarget;
    displayedTension = tensionTarget;
    rebuildContours();
  }

  function setContours(sources, { top, bottom }) {
    contourSources = sources.map(({ x, y, role }) => ({ x, y, role }));
    contourTop = Math.max(0, top);
    contourBottom = Math.min(height, bottom);
    rebuildContours();
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

  return { answer, bloom, end, press, setContours, setTension, setWorld };
}
