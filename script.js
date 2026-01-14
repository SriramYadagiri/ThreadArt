// ===============================
// Thread Art Website script.js
// Reverted core algorithm to your original:
// - residual error gain using currentGray vs targetGray
// - applyThread darkens currentGray and paints thread canvas pixels directly
// - step-through uses keyframe snapshots of currentGray
// ===============================

// ---------- UI refs ----------
const fileEl = document.getElementById("file");
const generateBtn = document.getElementById("generateBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const barEl = document.getElementById("bar");

const solveSizeEl = document.getElementById("solveSize");
const pinsEl = document.getElementById("pins");
const threadsEl = document.getElementById("threads");
const thicknessEl = document.getElementById("thickness");

// (kOptical exists in UI, but we ignore it in the reverted algorithm)
const kOpticalEl = document.getElementById("kOptical");

const openViewerBtn = document.getElementById("openViewerBtn");

const pathOut = document.getElementById("pathOut");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

// ---------- Canvases ----------
const threadCanvas = document.getElementById("threadCanvas");   // visible output
const previewCanvas = document.getElementById("previewCanvas"); // visible preview
const threadCtx = threadCanvas.getContext("2d", { willReadFrequently: true });
const previewCtx = previewCanvas.getContext("2d", { willReadFrequently: true });

// Offscreen solve canvas (we generate at solveW, display scales up)
const solveCanvas = document.createElement("canvas");
const solveCtx = solveCanvas.getContext("2d", { willReadFrequently: true });

// For direct pixel output (like your old code)
let threadImgData = null;
let threadPixels = null;

function setStatus(msg) { statusEl.textContent = msg; }
function setProgress(p01) {
  const p = Math.max(0, Math.min(1, p01));
  barEl.style.width = (p * 100) + "%";
}

function blitSolveToDisplay() {
  threadCtx.imageSmoothingEnabled = true;
  threadCtx.clearRect(0, 0, threadCanvas.width, threadCanvas.height);
  threadCtx.drawImage(solveCanvas, 0, 0, threadCanvas.width, threadCanvas.height);
}

// ---------- Algo params ----------
let numberOfPins = 120;
let maxThreads = 2500;
let THICKNESS_R = 2;
const DARKEN = 10;     // same feel as your old
let COOLDOWN = 6;      // scaled with pins

// Sizes
let solveW = 320;
let N = 0;

// Pins
let pins = [];

// Lazy line cache (fast startup)
let lineCache = [];
let seen = null;

// Target + current
let targetGray = null;   // Uint8Array brightness (0..255)
let currentGray = null;  // Uint8Array brightness (0..255)

// Path
let threadPath = [];
let running = false;

// Step-through keyframes (snapshots of currentGray)
const KEY_EVERY = 100; // store every 100 steps (increase if memory is high)
let keyframes = [];    // [{step, gray: Uint8Array}]
let lastRenderedStep = 0;


// ---------- Pins on circle ----------
function buildPins() {
  pins = [];
  const R = solveW / 2;
  for (let i = 0; i < numberOfPins; i++) {
    const ang = (i / numberOfPins) * 2 * Math.PI;
    pins.push({ x: R + R * Math.cos(ang), y: R - R * Math.sin(ang) });
  }
}

// ---------- Fast Bresenham + thickness disk ----------
function lineIndicesFast(p0, p1) {
  let x0 = Math.round(p0.x), y0 = Math.round(p0.y);
  let x1 = Math.round(p1.x), y1 = Math.round(p1.y);

  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  const out = [];

  const addDisk = (x, y) => {
    if (THICKNESS_R <= 0) {
      if (x < 0 || y < 0 || x >= solveW || y >= solveW) return;
      const p = y * solveW + x;
      if (!seen[p]) { seen[p] = 1; out.push(p); }
      return;
    }
    for (let yy = y - THICKNESS_R; yy <= y + THICKNESS_R; yy++) {
      if (yy < 0 || yy >= solveW) continue;
      const row = yy * solveW;
      for (let xx = x - THICKNESS_R; xx <= x + THICKNESS_R; xx++) {
        if (xx < 0 || xx >= solveW) continue;
        const ddx = xx - x, ddy = yy - y;
        if (ddx * ddx + ddy * ddy > THICKNESS_R * THICKNESS_R) continue;
        const p = row + xx;
        if (!seen[p]) { seen[p] = 1; out.push(p); }
      }
    }
  };

  while (true) {
    addDisk(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }

  for (let k = 0; k < out.length; k++) seen[out[k]] = 0;
  return out;
}

function resetCaches() {
  lineCache = Array.from({ length: numberOfPins }, () => Array(numberOfPins).fill(null));
  N = solveW * solveW;
  seen = new Uint8Array(N);

  targetGray = new Uint8Array(N);
  currentGray = new Uint8Array(N);

  threadPath = [0];
  keyframes = [{ step: 0, gray: new Uint8Array(currentGray) }];
  lastRenderedStep = 0;

  solveCanvas.width = solveW;
  solveCanvas.height = solveW;

  // init output pixels buffer (like your old threadArtCanvas)
  threadImgData = solveCtx.getImageData(0, 0, solveW, solveW);
  threadPixels = threadImgData.data;
  for (let i = 0; i < threadPixels.length; i += 4) {
    threadPixels[i] = 255;
    threadPixels[i + 1] = 255;
    threadPixels[i + 2] = 255;
    threadPixels[i + 3] = 255;
  }
  solveCtx.putImageData(threadImgData, 0, 0);
  blitSolveToDisplay();
}

function getLine(a, b) {
  let v = lineCache[a][b];
  if (v) return v;
  const idx = Int32Array.from(lineIndicesFast(pins[a], pins[b]));
  v = { idx };
  lineCache[a][b] = v;
  return v;
}

// ---------- Target build ----------
let img = null;

function buildTargetFromImage() {
  solveCtx.fillStyle = "white";
  solveCtx.fillRect(0, 0, solveW, solveW);

  const iw = img.naturalWidth, ih = img.naturalHeight;
  const s = Math.min(iw, ih);
  const sx = (iw - s) / 2;
  const sy = (ih - s) / 2;

  // draw to solve + preview
  solveCtx.drawImage(img, sx, sy, s, s, 0, 0, solveW, solveW);
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  previewCtx.drawImage(img, sx, sy, s, s, 0, 0, previewCanvas.width, previewCanvas.height);

  // extract target brightness
  const data = solveCtx.getImageData(0, 0, solveW, solveW).data;
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    targetGray[p] = (0.299 * R + 0.587 * G + 0.114 * B) | 0;
  }

  currentGray.fill(255);
}

// ---------- Your original scoring ----------
function lineGain(a, b) {
  const { idx } = getLine(a, b);
  let gain = 0;

  for (let k = 0; k < idx.length; k++) {
    const p = idx[k];
    const C = currentGray[p];
    const T = targetGray[p];

    if (C <= T) continue;

    const eff = (DARKEN * (C / 255)) | 0;
    const C2 = Math.max(0, C - eff);

    const e1 = (C - T) * (C - T);
    const e2 = (C2 - T) * (C2 - T);
    gain += (e1 - e2);
  }

  return gain;
}

function getNextPinIndex(currentPin) {
  let bestPin = -1;
  let bestGain = -Infinity;
  const recent = new Set(threadPath.slice(-COOLDOWN));

  for (let j = 0; j < numberOfPins; j++) {
    if (j === currentPin) continue;
    if (recent.has(j)) continue;

    const g = lineGain(currentPin, j);
    if (g > bestGain) {
      bestGain = g;
      bestPin = j;
    }
  }
  return bestPin;
}

// ---------- Apply thread (old style: directly paint pixels) ----------
function applyThread(fromIndex, toIndex) {
  const { idx } = getLine(fromIndex, toIndex);

  for (let k = 0; k < idx.length; k++) {
    const p = idx[k];
    const eff = (DARKEN * (currentGray[p] / 255)) | 0;
    const newVal = Math.max(0, currentGray[p] - eff);
    currentGray[p] = newVal;

    const i = p * 4;
    threadPixels[i] = newVal;
    threadPixels[i + 1] = newVal;
    threadPixels[i + 2] = newVal;
    threadPixels[i + 3] = 255;
  }

  solveCtx.putImageData(threadImgData, 0, 0);
  blitSolveToDisplay();
}

// ---------- Generation loop ----------
let currentPinIndex = 0;
let nextPinIndex = -1;

function finishGeneration() {
  running = false;
  stopBtn.disabled = true;
  generateBtn.disabled = false;

  setProgress(1);
  setStatus(`Done. Threads: ${threadPath.length - 1}. Use the slider to step through.`);

  // output path JSON
  const payload = {
    pins: numberOfPins,
    threads: threadPath.length - 1,
    solveSize: solveW,
    thickness: THICKNESS_R,
    darken: DARKEN,
    cooldown: COOLDOWN,
    path: threadPath
  };

  localStorage.setItem("threadArtData", JSON.stringify(payload));

  pathOut.value = JSON.stringify(payload, null, 2);
  copyBtn.disabled = false;
  downloadBtn.disabled = false;

  openViewerBtn.disabled = false;
}

function generateThreadArt() {
  if (!running) return;

  // a few per frame for speed
  const stepsPerFrame = 3;

  for (let it = 0; it < stepsPerFrame; it++) {
    if ((threadPath.length - 1) >= maxThreads || nextPinIndex === -1) {
      finishGeneration();
      return;
    }

    threadPath.push(nextPinIndex);
    applyThread(currentPinIndex, nextPinIndex);

    // keyframe snapshot
    const stepCount = threadPath.length - 1;
    if (stepCount % KEY_EVERY === 0) {
      keyframes.push({ step: stepCount, gray: new Uint8Array(currentGray) });
    }

    if (stepCount % 25 === 0) {
      setProgress(stepCount / maxThreads);
      setStatus(`Generating… ${stepCount}/${maxThreads} threads`);
    }

    currentPinIndex = nextPinIndex;
    nextPinIndex = getNextPinIndex(currentPinIndex);
  }

  requestAnimationFrame(generateThreadArt);
}

// ---------- Step-through rendering ----------
function findKeyframe(step) {
  let best = keyframes[0];
  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].step <= step) best = keyframes[i];
    else break;
  }
  return best;
}

function renderGrayToCanvas(grayArr) {
  for (let p = 0; p < grayArr.length; p++) {
    const v = grayArr[p];
    const i = p * 4;
    threadPixels[i] = v;
    threadPixels[i + 1] = v;
    threadPixels[i + 2] = v;
    threadPixels[i + 3] = 255;
  }
  solveCtx.putImageData(threadImgData, 0, 0);
  blitSolveToDisplay();
}

function reconstructGray(step) {
  const kf = findKeyframe(step);
  const g = new Uint8Array(kf.gray);

  // replay from keyframe step -> step
  for (let t = kf.step; t < step; t++) {
    const from = threadPath[t];
    const to = threadPath[t + 1];
    const { idx } = getLine(from, to);

    for (let k = 0; k < idx.length; k++) {
      const p = idx[k];
      const eff = (DARKEN * (g[p] / 255)) | 0;
      g[p] = Math.max(0, g[p] - eff);
    }
  }

  return g;
}

let stepRenderQueued = null;
function renderStep(step) {
  if (stepRenderQueued) cancelAnimationFrame(stepRenderQueued);
  stepRenderQueued = requestAnimationFrame(() => {
    stepRenderQueued = null;
    const steps = threadPath.length - 1;
    const s = Math.max(0, Math.min(steps, step | 0));

    const g = reconstructGray(s);
    renderGrayToCanvas(g);
  });
}

// ---------- UI wiring ----------
fileEl.addEventListener("change", () => {
  const f = fileEl.files && fileEl.files[0];
  if (!f) return;

  img = new Image();
  img.onload = () => {
    generateBtn.disabled = false;
    setStatus("Image loaded. Configure settings and click Generate.");
    setProgress(0);

    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCtx.drawImage(img, 0, 0, previewCanvas.width, previewCanvas.height);
  };
  img.src = URL.createObjectURL(f);
});

generateBtn.addEventListener("click", () => {
  if (!img) return;

  // settings
  solveW = Number(solveSizeEl.value) || 320;
  numberOfPins = Number(pinsEl.value) || 120;
  maxThreads = Number(threadsEl.value) || 2500;
  THICKNESS_R = Number(thicknessEl.value) || 2;

  COOLDOWN = Math.max(3, Math.floor(numberOfPins / 25));

  // ignore kOptical input (kept for layout)
  kOpticalEl.value = kOpticalEl.value;

  buildPins();
  resetCaches();
  buildTargetFromImage();

  running = true;

  // disable UI during generation
  generateBtn.disabled = true;
  stopBtn.disabled = false;

  pathOut.value = "";
  copyBtn.disabled = true;
  downloadBtn.disabled = true;

  setProgress(0);
  setStatus("Generating…");

  currentPinIndex = 0;
  nextPinIndex = getNextPinIndex(currentPinIndex);

  requestAnimationFrame(generateThreadArt);
});

stopBtn.addEventListener("click", () => {
  running = false;
  stopBtn.disabled = true;
  generateBtn.disabled = false;
  setStatus("Stopped.");
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(pathOut.value);
    setStatus("Copied path JSON to clipboard.");
  } catch {
    setStatus("Copy failed (browser blocked). You can manually copy from the box.");
  }
});

downloadBtn.addEventListener("click", () => {
  const blob = new Blob([pathOut.value], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "thread_art_path.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

setStatus("Upload an image to begin.");
setProgress(0);

generateBtn.disabled = true;
stopBtn.disabled = true;
copyBtn.disabled = true;
downloadBtn.disabled = true;
openViewerBtn.disabled = true;
openViewerBtn.onclick = () => window.open("viewer.html", "_blank");
