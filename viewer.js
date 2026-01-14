// viewer.js
// Loads thread-art path data from (1) localStorage, (2) uploaded JSON file, or (3) pasted JSON,
// then provides step-through with pin-to-pin display + highlighted current segment.

const jsonFile = document.getElementById("jsonFile");
const loadDemo = document.getElementById("loadDemo");
const jsonText = document.getElementById("jsonText");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const playBtn = document.getElementById("playBtn");
const stepSlider = document.getElementById("stepSlider");
const stepText = document.getElementById("stepText");
const moveText = document.getElementById("moveText");

const sizeEl = document.getElementById("size");
const showPinsEl = document.getElementById("showPins");
const showHistoryEl = document.getElementById("showHistory");
const toggleUploadBtn = document.getElementById("toggleUploadBtn");
const manualUploadCard = document.getElementById("manualUploadCard");

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const mapViewport = document.getElementById("mapViewport");
const backBtn = document.getElementById("backBtn");

const STORAGE_KEY = "threadArtData";

const margin = 24;
const MIN_CANVAS = 300;
const MAX_CANVAS = 2000;
const ZOOM_SENSITIVITY = 0.015;

let data = null;     // normalized data: { pins, path, threads, ... }
let pins = [];       // positions for each pin
let step = 1;
let playTimer = null;
let isDragging = false;
let dragStart = {x:0,y:0};
let pan = {x:0,y:0};

// ---------- UI helpers ----------
function setCanvasSize(px) {
  canvas.width = px;
  canvas.height = px;
}

function clampCanvasSize(px) {
  const n = Math.round(Number(px) || 0);
  return Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, n || 900));
}

function minPanX() {
  if (!mapViewport) return 0;
  return Math.min(0, mapViewport.clientWidth - canvas.width);
}
function minPanY() {
  if (!mapViewport) return 0;
  return Math.min(0, mapViewport.clientHeight - canvas.height);
}

function applyPan() {
  canvas.style.transform = `translate(${Math.round(pan.x)}px, ${Math.round(pan.y)}px)`;
}

function clampPan() {
  pan.x = Math.max(minPanX(), Math.min(0, pan.x));
  pan.y = Math.max(minPanY(), Math.min(0, pan.y));
}

function updatePanState(preservePan = false) {
  if (!mapViewport) return;
  if (canvas.width > 600) {
    mapViewport.classList.add('pan-enabled');
    if (preservePan) {
      clampPan();
    } else {
      // initial center (clamped)
      const centerX = Math.floor((mapViewport.clientWidth - canvas.width) / 2);
      const centerY = Math.floor((mapViewport.clientHeight - canvas.height) / 2);
      pan.x = Math.max(minPanX(), Math.min(0, centerX));
      pan.y = Math.max(minPanY(), Math.min(0, centerY));
    }
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    applyPan();
  } else {
    mapViewport.classList.remove('pan-enabled');
    pan.x = 0; pan.y = 0;
    canvas.style.transform = '';
    canvas.style.cursor = '';
    canvas.style.touchAction = '';
  }
}

function applyCanvasSize(newSize, options = {}) {
  if (!data) return;
  const size = clampCanvasSize(newSize);
  const oldSize = canvas.width || size;

  let nx = 0.5;
  let ny = 0.5;
  if (options.anchor && mapViewport) {
    const localX = options.anchor.x - pan.x;
    const localY = options.anchor.y - pan.y;
    nx = Math.max(0, Math.min(1, localX / oldSize));
    ny = Math.max(0, Math.min(1, localY / oldSize));
  }

  setCanvasSize(size);
  buildPins(data.pins);

  if (options.anchor && mapViewport) {
    pan.x = options.anchor.x - (nx * size);
    pan.y = options.anchor.y - (ny * size);
  }

  updatePanState(Boolean(options.anchor || options.preservePan));
  sizeEl.value = String(size);
  render();
}

function stopPlay() {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  playBtn.textContent = "Play";
}

function setNotice(msg) {
  // Reuse status area if you added one; otherwise just use title text subtly.
  // You can replace this with a proper banner if you want.
  // Here we append to stepText in a light way if no other notice element exists.
  // (Safe + doesn't require HTML changes.)
  if (!msg) return;
  alert(msg);
}

// ---------- Validation + normalization ----------
function normalizeThreadArtData(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Data is not an object.");
  if (!Array.isArray(obj.path)) throw new Error("Missing path[] array.");
  if (typeof obj.pins !== "number") throw new Error("Missing pins count.");

  const pinsCount = obj.pins | 0;
  const path = obj.path.map((x) => x | 0);

  if (pinsCount < 3) throw new Error("pins must be >= 3.");
  if (path.length < 2) throw new Error("path is too short.");
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (p < 0 || p >= pinsCount) {
      throw new Error(`path[${i}] out of range: ${p} (pins=${pinsCount})`);
    }
  }

  const threads = (obj.threads != null ? (obj.threads | 0) : (path.length - 1));
  return {
    pins: pinsCount,
    path,
    threads,
    thickness: obj.thickness ?? null,
    solveSize: obj.solveSize ?? null,
    displaySize: obj.displaySize ?? null,
    darken: obj.darken ?? null,
    cooldown: obj.cooldown ?? null,
    meta: obj.meta ?? null,
  };
}

// ---------- Geometry ----------
function buildPins(numPins) {
  pins = [];
  const R = canvas.width / 2 - margin;
  for (let i = 0; i < numPins; i++) {
    const ang = (i / numPins) * 2 * Math.PI;
    pins.push({
      x: R + R * Math.cos(ang)+margin,
      y: R - R * Math.sin(ang)+margin,
    });
  }
}

// ---------- Drawing ----------
function drawLine(a, b) {
  const p0 = pins[a], p1 = pins[b];
  if (!p0 || !p1) return;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

function drawPin(i, radius, color) {
  const p = pins[i];
  if (!p) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawPinLabel(i, color = "rgba(0,0,0,0.85)") {
  const p = pins[i];
  if (!p) return;

  ctx.save();
  ctx.font = "600 14px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // small white halo so it reads on dark lines
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.fillStyle = color;

  if (p.x < canvas.width / 2) {
    var dx = 12;
    var dy = 0;
  } else {
    var dx = -20;
    var dy = 0;
  }

  if (p.y < canvas.height / 2) dy += 20;
  else dy -= 12;

  const x = p.x + dx;
  const y = p.y + dy;

  const text = String(i);
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}


function render() {
  if (!data) return;

  const totalSteps = Math.max(0, data.path.length - 1);
  step = Math.max(1, Math.min(totalSteps, step | 0));

  stepText.textContent = `Step: ${step} / ${totalSteps}`;

  const from = step > 0 ? data.path[step - 1] : null;
  const to = step > 0 ? data.path[step] : null;
  moveText.textContent = step === 0 ? "Pin ? → ?" : `Pin ${from} → ${to}`;

  // background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // boundary circle (subtle)
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, (canvas.width-margin*2) * 0.48, 0, Math.PI * 2);
  ctx.stroke();

  // history
  if (showHistoryEl.checked) {
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    const end = Math.max(0, step - 1);
    for (let t = 0; t < end; t++) {
      drawLine(data.path[t], data.path[t + 1]);
    }
  }

  // highlight current segment
  if (step > 0) {
    // glow underlay
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 7;
    drawLine(from, to);

    // main highlight
    ctx.strokeStyle = "rgba(99,102,241,0.95)";
    ctx.lineWidth = 3;
    drawLine(from, to);

    // highlight the two pins (from green, to purple)
    drawPin(from, 9, "rgba(16,185,129,0.95)");
    drawPin(to, 9, "rgba(99,102,241,0.95)");

    // label offsets so text doesn't sit on the circle
    drawPinLabel(from, "rgba(16,185,129,0.95)");
    drawPinLabel(to, "rgba(99,102,241,0.95)");
  }

  // pins
  if (showPinsEl.checked) {
    for (let i = 0; i < pins.length; i++) {
      drawPin(i, 4, "rgba(0,0,0,0.55)");
    }
  }
}

// ---------- Loading ----------
function loadJSON(obj, sourceLabel = "") {
  data = normalizeThreadArtData(obj);

  const px = clampCanvasSize(sizeEl.value || 900);
  setCanvasSize(px);
  buildPins(data.pins);
  // enable/disable panning depending on canvas size
  updatePanState();
  sizeEl.value = String(px);

  const totalSteps = Math.max(0, data.path.length - 1);

  stepSlider.min = "1";
  stepSlider.max = String(totalSteps);
  stepSlider.disabled = false;

  // set step to start by default
  step = 1;
  stepSlider.value = String(step);

  prevBtn.disabled = false;
  nextBtn.disabled = false;
  playBtn.disabled = false;

  render();

  // Save back to localStorage so refresh works
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }

  if (sourceLabel) setNotice(`Loaded from ${sourceLabel}`);
}

async function loadFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  loadJSON(parsed, "file");
}

function loadFromTextarea() {
  const parsed = JSON.parse(jsonText.value);
  loadJSON(parsed, "textarea");
}

function tryAutoLoadFromLocalStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    loadJSON(parsed, "localStorage");
    return true;
  } catch (e) {
    console.warn("Invalid localStorage threadArtData:", e);
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

// If generator writes while viewer is open in another tab, auto-update.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try {
      const parsed = JSON.parse(e.newValue);
      loadJSON(parsed, "localStorage (updated)");
    } catch {}
  }
});

// ---------- Events ----------
jsonFile.addEventListener("change", async () => {
  const f = jsonFile.files && jsonFile.files[0];
  if (!f) return;
  stopPlay();
  try {
    await loadFromFile(f);
  } catch (e) {
    alert("Invalid JSON file: " + (e?.message || e));
  }
});

loadDemo.addEventListener("click", () => {
  stopPlay();
  try {
    loadFromTextarea();
  } catch (e) {
    alert("Invalid pasted JSON: " + (e?.message || e));
  }
});

stepSlider.addEventListener("input", () => {
  step = Number(stepSlider.value) || 1;
  render();
});

prevBtn.addEventListener("click", () => {
  step = Math.max(1, step - 1);
  stepSlider.value = String(step);
  render();
});

nextBtn.addEventListener("click", () => {
  if (!data) return;
  const totalSteps = Math.max(0, data.path.length - 1);
  step = Math.min(totalSteps, step + 1);
  stepSlider.value = String(step);
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") {
    prevBtn.click();
  } else if (e.key === "ArrowRight") {
    nextBtn.click();
  }
});

playBtn.addEventListener("click", () => {
  if (!data) return;

  if (playTimer) {
    stopPlay();
    return;
  }

  playBtn.textContent = "Pause";
  playTimer = setInterval(() => {
    const totalSteps = Math.max(0, data.path.length - 1);
    step++;
    if (step > totalSteps) step = 1;
    stepSlider.value = String(step);
    render();
  }, 40);
});

sizeEl.addEventListener("change", () => {
  if (!data) return;
  stopPlay();
  applyCanvasSize(sizeEl.value, { preservePan: false });
});

showPinsEl.addEventListener("change", render);
showHistoryEl.addEventListener("change", render);
if (toggleUploadBtn && manualUploadCard) {
  toggleUploadBtn.addEventListener("click", () => {
    const isOpen = manualUploadCard.classList.toggle("is-open");
    toggleUploadBtn.textContent = isOpen ? "Upload JSON ▴" : "Upload JSON ▾";
  });
}

// pointer drag handlers for panning when map is enabled
canvas.addEventListener('pointerdown', (e) => {
  if (!mapViewport || !mapViewport.classList.contains('pan-enabled')) return;
  isDragging = true;
  dragStart.x = e.clientX - pan.x;
  dragStart.y = e.clientY - pan.y;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  pan.x = e.clientX - dragStart.x;
  pan.y = e.clientY - dragStart.y;
  // clamp
  pan.x = Math.max(minPanX(), Math.min(0, pan.x));
  pan.y = Math.max(minPanY(), Math.min(0, pan.y));
  applyPan();
});
canvas.addEventListener('pointerup', (e) => {
  if (!isDragging) return;
  isDragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  canvas.style.cursor = 'grab';
});
canvas.addEventListener('pointercancel', () => {
  isDragging = false; canvas.style.cursor = 'grab';
});

// zoom with mouse wheel at cursor
if (mapViewport) {
  mapViewport.addEventListener('wheel', (e) => {
    if (!data) return;
    e.preventDefault();
    stopPlay();
    const rect = mapViewport.getBoundingClientRect();
    const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const scale = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
    applyCanvasSize(canvas.width * scale, { anchor });
  }, { passive: false });
}

// Back button navigation
if (backBtn) {
  backBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
}

// update pan on window resize
window.addEventListener('resize', () => updatePanState(true));

// ---------- Init ----------
prevBtn.disabled = true;
nextBtn.disabled = true;
playBtn.disabled = true;
stepSlider.disabled = true;

// attempt auto-load
window.addEventListener("load", () => {
  const ok = tryAutoLoadFromLocalStorage();
  if (!ok) {
    setNotice("No saved build found. Upload or paste JSON.");
  }
});
