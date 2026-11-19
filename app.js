const STORAGE_KEY = "drinkwithme_state_v7";

function getCurrentWeekTime() {
  const now = new Date();
  return {
    day: (now.getDay() + 6) % 7, // Mo=0 ... So=6
    hour: now.getHours(),
  };
}

const DEFAULT_STATE = {
  activeProfileId: "p1",
  profiles: [
    { id: "p1", name: "Ich", gender: "m", age: 24, heightCm: 180, weightKg: 75, tolerance: "normal", smoker: false },
    { id: "p2", name: "Kollegin", gender: "f", age: 23, heightCm: 168, weightKg: 60, tolerance: "low", smoker: false },
  ],
  range: { startDay: 3, startHour: 18, endDay: 6, endHour: 18 },
  events: [],
  history: [],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

let state = loadState();
let liveMode = true;
const initNow = getCurrentWeekTime();
let selectedDay = initNow.day;
let selectedHour = initNow.hour;
let activePreset = { name: "Bier", icon: "🍺", dur: 0.5, dark: false, carb: true };
let selectedSleepDur = 7.5;
let bacChart = null;
let scoreChart = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveProfile() {
  return state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0];
}

// Prüft, ob ein Zeitpunkt im aktuellen Simulations-Zeitraum liegt; falls nicht, passt er ihn im Live-Modus an
function ensureTimeInRange(day, hour) {
  const startT = state.range.startDay * 24 + state.range.startHour;
  let rawEndT = state.range.endDay * 24 + state.range.endHour;
  if (rawEndT <= startT) rawEndT += 168;
  const endT = Math.max(startT + 6, rawEndT);

  let targetT = day * 24 + hour;
  if (targetT < startT) targetT += 168;

  if (targetT < startT || targetT > endT) {
    state.range = {
      startDay: day,
      startHour: hour,
      endDay: (day + 2) % 7,
      endHour: 18,
    };
    saveState();
    renderProfileUI();
  }
}

// --- Navigation ---
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
    if (btn.dataset.target === "view-plan" && liveMode) {
      syncLiveTime();
    }
  });
});

document.getElementById("go-plan-btn").addEventListener("click", () => {
  document.querySelector('.nav-btn[data-target="view-plan"]').click();
});

// --- Profile Switcher & Verwaltung ---
function renderProfileUI() {
  const switcher = document.getElementById("profile-switcher");
  switcher.innerHTML = "";
  state.profiles.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `👤 ${p.name}`;
    opt.selected = p.id === state.activeProfileId;
    switcher.appendChild(opt);
  });

  const p = getActiveProfile();
  document.getElementById("profile-name").value = p.name;
  document.getElementById("gender").value = p.gender;
  document.getElementById("age").value = p.age;
  document.getElementById("height").value = p.heightCm;
  document.getElementById("weight").value = p.weightKg;

  document.querySelectorAll("#tolerance-control .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tol === (p.tolerance || "normal"));
  });

  document.querySelectorAll("#smoker-control .seg-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn.dataset.smoker === "true") === Boolean(p.smoker));
  });

  document.getElementById("start-day").value = state.range.startDay;
  document.getElementById("start-hour").value = state.range.startHour;
  document.getElementById("end-day").value = state.range.endDay;
  document.getElementById("end-hour").value = state.range.endHour;
}

document.getElementById("profile-switcher").addEventListener("change", (e) => {
  state.activeProfileId = e.target.value;
  saveState();
  renderProfileUI();
  updateSimulation();
});

document.getElementById("add-profile-btn").addEventListener("click", () => {
  const name = prompt("Name der neuen Person:", "Freund/in");
  if (!name || !name.trim()) return;
  const newP = {
    id: "p" + Date.now(),
    name: name.trim(),
    gender: "m",
    age: 24,
    heightCm: 175,
    weightKg: 70,
    tolerance: "normal",
    smoker: false,
  };
  state.profiles.push(newP);
  state.activeProfileId = newP.id;
  saveState();
  renderProfileUI();
  updateSimulation();
});

document.getElementById("del-profile-btn").addEventListener("click", () => {
  if (state.profiles.length <= 1) {
    alert("Mindestens eine Person muss bestehen bleiben.");
    return;
  }
  state.profiles = state.profiles.filter((p) => p.id !== state.activeProfileId);
  state.activeProfileId = state.profiles[0].id;
  saveState();
  renderProfileUI();
  updateSimulation();
});

document.querySelectorAll("#tolerance-control .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    getActiveProfile().tolerance = btn.dataset.tol;
    saveState();
    renderProfileUI();
    updateSimulation();
  });
});

document.querySelectorAll("#smoker-control .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    getActiveProfile().smoker = btn.dataset.smoker === "true";
    saveState();
    renderProfileUI();
    updateSimulation();
  });
});

["profile-name", "gender", "age", "height", "weight"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    const p = getActiveProfile();
    p.name = document.getElementById("profile-name").value.trim() || "Person";
    p.gender = document.getElementById("gender").value;
    p.age = Number(document.getElementById("age").value) || 24;
    p.heightCm = Number(document.getElementById("height").value) || 175;
    p.weightKg = Number(document.getElementById("weight").value) || 70;
    saveState();
    const opt = document.querySelector(`#profile-switcher option[value="${p.id}"]`);
    if (opt) opt.textContent = `👤 ${p.name}`;
    updateSimulation();
  });
});

["start-day", "start-hour", "end-day", "end-hour"].forEach((id) => {
  document.getElementById(id).addEventListener("input", () => {
    state.range = {
      startDay: Number(document.getElementById("start-day").value),
      startHour: Number(document.getElementById("start-hour").value) || 0,
      endDay: Number(document.getElementById("end-day").value),
      endHour: Number(document.getElementById("end-hour").value) || 0,
    };
    saveState();
    updateSimulation();
  });
});

// --- Planen: Live-Modus & Zeit ---
function updateTimeLabel() {
  const h = String(selectedHour).padStart(2, "0");
  document.getElementById("plan-time-label").textContent = `${DAYS[selectedDay]}, ${h}:00 Uhr`;
  document.querySelectorAll("#plan-day-pills .pill").forEach((p) => {
    p.classList.toggle("active", Number(p.dataset.day) === selectedDay);
  });

  const liveBtn = document.getElementById("live-toggle-btn");
  liveBtn.classList.toggle("active", liveMode);
  liveBtn.innerHTML = liveMode
    ? `<span class="live-dot"></span> LIVE · Jetzt`
    : `<span class="live-dot"></span> Jetzt setzen`;
}

function syncLiveTime() {
  const now = getCurrentWeekTime();
  selectedDay = now.day;
  selectedHour = now.hour;
  liveMode = true;
  updateTimeLabel();
}

document.getElementById("live-toggle-btn").addEventListener("click", () => {
  syncLiveTime();
  ensureTimeInRange(selectedDay, selectedHour);
  updateSimulation();
});

document.querySelectorAll("#plan-day-pills .pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    liveMode = false;
    selectedDay = Number(pill.dataset.day);
    updateTimeLabel();
  });
});

document.getElementById("hour-minus").addEventListener("click", () => {
  liveMode = false;
  selectedHour--;
  if (selectedHour < 0) { selectedHour = 23; selectedDay = Math.max(0, selectedDay - 1); }
  updateTimeLabel();
});

document.getElementById("hour-plus").addEventListener("click", () => {
  liveMode = false;
  selectedHour++;
  if (selectedHour > 23) { selectedHour = 0; selectedDay = Math.min(6, selectedDay + 1); }
  updateTimeLabel();
});

// --- Drinks & Trinkdauer ---
const dlSlider = document.getElementById("drink-dl");
const abvSlider = document.getElementById("drink-abv");

function getDrinkDuration() {
  const dl = Number(dlSlider.value);
  return dl <= 0.6 ? 0 : activePreset.dur;
}

function updateDrinkButton() {
  const dl = Number(dlSlider.value);
  const abv = Number(abvSlider.value);
  const grams = calcAlcoholGrams(dl, abv);
  const dur = getDrinkDuration();

  document.getElementById("dl-val").textContent = dl.toFixed(1);
  document.getElementById("abv-val").textContent = abv.toFixed(1);
  document.getElementById("drink-pace-badge").textContent = dur > 0 ? "⏱ ~30 Min" : "⏱ Sofort";
  document.getElementById("add-drink-btn").textContent =
    `+ ${activePreset.icon} ${activePreset.name} (${grams.toFixed(1)}g) eintragen`;
}

document.querySelectorAll("#drink-presets .tile").forEach((tile) => {
  tile.addEventListener("click", () => {
    document.querySelectorAll("#drink-presets .tile").forEach((t) => t.classList.remove("active"));
    tile.classList.add("active");
    activePreset = {
      name: tile.dataset.name,
      icon: tile.dataset.icon,
      dur: Number(tile.dataset.dur),
      dark: tile.dataset.dark === "true",
      carb: tile.dataset.carb === "true",
    };
    dlSlider.value = tile.dataset.dl;
    abvSlider.value = tile.dataset.abv;
    updateDrinkButton();
  });
});

dlSlider.addEventListener("input", updateDrinkButton);
abvSlider.addEventListener("input", updateDrinkButton);

function addEvent(ev) {
  if (liveMode) {
    const now = getCurrentWeekTime();
    selectedDay = now.day;
    selectedHour = now.hour;
    updateTimeLabel();
    ensureTimeInRange(selectedDay, selectedHour);
  }

  state.events.push({ id: Date.now() + Math.random(), day: selectedDay, hour: selectedHour, ...ev });
  saveState();
  renderEventList();
  updateSimulation();
}

document.getElementById("add-drink-btn").addEventListener("click", () => {
  const dl = Number(dlSlider.value);
  const abv = Number(abvSlider.value);
  const carbonated = activePreset.carb;
  const dark = activePreset.dark;
  const drinkDuration = getDrinkDuration();

  addEvent({
    type: "drink",
    icon: activePreset.icon,
    label: `${activePreset.name} ${dl.toFixed(1)} dl (${abv.toFixed(1)}%)`,
    grams: calcAlcoholGrams(dl, abv),
    carbonated,
    dark,
    drinkDuration,
  });
});

// Konter, Tanzen & Schlaf
document.getElementById("btn-water").addEventListener("click", () => addEvent({ type: "water", icon: "💧", label: "Wasser 3 dl", dl: 3 }));
document.getElementById("btn-electro").addEventListener("click", () => addEvent({ type: "electro", icon: "⚡", label: "Elektrolyte" }));
document.getElementById("btn-food").addEventListener("click", () => addEvent({ type: "food", icon: "🍕", label: "Essen" }));
document.getElementById("btn-dance").addEventListener("click", () => addEvent({ type: "dance", icon: "💃", label: "Tanzen (1h)", duration: 1 }));
document.getElementById("btn-caffeine").addEventListener("click", () => addEvent({ type: "caffeine", icon: "☕", label: "Koffein (~90mg)", mg: 90 }));

document.querySelectorAll("#sleep-duration-pills .sleep-pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#sleep-duration-pills .sleep-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    selectedSleepDur = Number(pill.dataset.dur);
    document.getElementById("add-sleep-btn").textContent = `+ 😴 Schlaf (${selectedSleepDur}h) eintragen`;
  });
});

document.getElementById("add-sleep-btn").addEventListener("click", () => {
  addEvent({
    type: "sleep",
    icon: "😴",
    label: `Schlaf (${selectedSleepDur}h)`,
    duration: selectedSleepDur,
  });
});

document.getElementById("clear-all-btn").addEventListener("click", () => {
  state.events = [];
  saveState();
  renderEventList();
  updateSimulation();
});

window.removeEvent = function (id) {
  state.events = state.events.filter((e) => e.id !== id);
  saveState();
  renderEventList();
  updateSimulation();
};

function renderEventList() {
  const list = document.getElementById("event-list");
  list.innerHTML = "";
  const sorted = [...state.events].sort((a, b) => (a.day * 24 + a.hour) - (b.day * 24 + b.hour));

  if (sorted.length === 0) {
    list.innerHTML = `<li style="color:#94a3b8;justify-content:center;">Noch nichts geplant</li>`;
    return;
  }

  sorted.forEach((ev) => {
    const li = document.createElement("li");
    const tStr = `${DAYS[ev.day]} ${String(ev.hour).padStart(2, "0")}:00`;
    const paceTag = ev.type === "drink" && (ev.drinkDuration ?? 0.5) > 0 ? " · ~30m" : "";
    li.innerHTML = `
      <div><span class="ev-time">${tStr}</span> ${ev.icon} ${ev.label}<span style="color:#94a3b8;font-size:0.74rem;">${paceTag}</span></div>
      <button class="del-btn" onclick="removeEvent(${ev.id})">✕</button>
    `;
    list.appendChild(li);
  });
}

// --- Historie ---
document.getElementById("save-history-btn").addEventListener("click", () => {
  if (state.events.length === 0) return;
  const title = prompt("Name für diesen Abend / dieses Wochenende:", "Freitagabend");
  if (!title || !title.trim()) return;

  const res = runSimulation({ profile: getActiveProfile(), range: state.range, events: state.events });
  state.history.unshift({
    id: Date.now(),
    title: title.trim(),
    date: new Date().toLocaleDateString("de-CH"),
    maxBac: res.stats.maxBac.toFixed(2),
    maxHangover: res.stats.maxHangover.toFixed(1),
    events: structuredClone(state.events),
  });
  saveState();
  renderHistory();
});

window.loadHistory = function (id) {
  const item = state.history.find((h) => h.id === id);
  if (!item) return;
  state.events = structuredClone(item.events);
  saveState();
  renderEventList();
  updateSimulation();
};

window.deleteHistory = function (id) {
  state.history = state.history.filter((h) => h.id !== id);
  saveState();
  renderHistory();
};

function renderHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";
  if (state.history.length === 0) {
    list.innerHTML = `<li style="color:#94a3b8;justify-content:center;">Noch keine Abende gespeichert</li>`;
    return;
  }

  state.history.forEach((h) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="hist-info" onclick="loadHistory(${h.id})" title="Tippen zum Laden">
        <strong>${h.title}</strong>
        <span class="hist-meta">${h.date} · Peak ${h.maxBac} ‰ · Kater ${h.maxHangover}/10</span>
      </div>
      <button class="del-btn" onclick="deleteHistory(${h.id})">✕</button>
    `;
    list.appendChild(li);
  });
}

// --- Simulation & Charts (inkl. Touch-Inspektor) ---
let latestSimRes = null;
let inspectorIndex = null;

function updateInspectorReadout(idx) {
  const bar = document.getElementById("inspector-bar");
  const line = document.getElementById("touch-guide-line");

  if (!latestSimRes || idx === null || idx < 0 || idx >= latestSimRes.labels.length) {
    bar.classList.add("hidden");
    if (line) line.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");
  document.getElementById("insp-time").textContent = latestSimRes.labels[idx];
  document.getElementById("insp-bac").textContent = `${latestSimRes.bacSeries[idx].toFixed(2)} ‰`;
  document.getElementById("insp-hangover").textContent = `Kater ${latestSimRes.hangoverSeries[idx].toFixed(1)}`;
  document.getElementById("insp-hydration").textContent = `Hydr. ${latestSimRes.hydrationSeries[idx].toFixed(1)}`;

  if (bacChart && line) {
    const meta = bacChart.getDatasetMeta(0);
    const pt = meta?.data?.[idx];
    const wrap = document.getElementById("chart-wrap");
    if (pt && wrap) {
      const canvasRect = bacChart.canvas.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const xPos = (canvasRect.left - wrapRect.left) + pt.x;
      line.style.left = `${xPos}px`;
      line.classList.remove("hidden");
    }
  }
}

function setInspectorIndex(idx) {
  if (!latestSimRes || latestSimRes.labels.length === 0) return;
  const clamped = Math.max(0, Math.min(latestSimRes.labels.length - 1, idx));
  inspectorIndex = clamped;

  if (bacChart && scoreChart) {
    const activeBac = [{ datasetIndex: 0, index: clamped }];
    const activeScore = [
      { datasetIndex: 0, index: clamped },
      { datasetIndex: 1, index: clamped },
    ];
    bacChart.setActiveElements(activeBac);
    scoreChart.setActiveElements(activeScore);
    bacChart.tooltip.setActiveElements(activeBac, { x: 0, y: 0 });
    scoreChart.tooltip.setActiveElements(activeScore, { x: 0, y: 0 });
    bacChart.update("none");
    scoreChart.update("none");
  }

  updateInspectorReadout(clamped);
}

function attachChartTouchInspector() {
  const wrap = document.getElementById("chart-wrap");
  if (!wrap || wrap.dataset.inspectorBound === "true") return;
  wrap.dataset.inspectorBound = "true";

  const guide = document.createElement("div");
  guide.id = "touch-guide-line";
  guide.className = "touch-guide-line hidden";
  wrap.appendChild(guide);

  const pickIndexFromClientX = (clientX) => {
    if (!bacChart || !latestSimRes || latestSimRes.labels.length === 0) return;
    const area = bacChart.chartArea;
    const rect = bacChart.canvas.getBoundingClientRect();
    if (!area) return;

    const relX = clientX - rect.left;
    const clampedX = Math.max(area.left, Math.min(area.right, relX));
    const ratio = (clampedX - area.left) / Math.max(1, area.right - area.left);
    const idx = Math.round(ratio * (latestSimRes.labels.length - 1));
    setInspectorIndex(idx);
  };

  wrap.addEventListener("pointerdown", (e) => {
    wrap.setPointerCapture(e.pointerId);
    pickIndexFromClientX(e.clientX);
  });

  wrap.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && e.buttons === 0 && inspectorIndex === null) return;
    if (wrap.hasPointerCapture(e.pointerId) || e.pointerType === "touch") {
      pickIndexFromClientX(e.clientX);
    }
  });

  const releasePointer = (e) => {
    if (wrap.hasPointerCapture(e.pointerId)) {
      wrap.releasePointerCapture(e.pointerId);
    }
  };

  wrap.addEventListener("pointerup", releasePointer);
  wrap.addEventListener("pointercancel", releasePointer);
}

function updateSimulation() {
  const profile = getActiveProfile();
  const range = state.range;

  document.getElementById("header-range").textContent =
    `${formatTotalHour(range.startDay * 24 + range.startHour)} – ${formatTotalHour(range.endDay * 24 + range.endHour)}`;

  const res = runSimulation({ profile, range, events: state.events });
  latestSimRes = res;

  document.getElementById("tbw-val").textContent = `${res.tbw.toFixed(1)} L`;
  document.getElementById("elim-val").textContent = `${res.elimRate.toFixed(2)} ‰/h`;
  document.getElementById("kpi-max-bac").textContent = `${res.stats.maxBac.toFixed(2)} ‰`;
  document.getElementById("kpi-max-hangover").textContent = `${res.stats.maxHangover.toFixed(1)} / 10`;
  document.getElementById("kpi-sober").textContent =
    res.stats.soberTime !== null ? formatTotalHour(res.stats.soberTime) : "–";
  document.getElementById("water-deficit-badge").textContent =
    `💧 −${Math.round(res.stats.maxFluidDeficitMl)} ml`;

  // Sicherheits- & Plausibilitäts-Check (Grenze: 3.0 ‰ oder 600 mg Koffein)
  const isBacDanger = res.stats.maxBac >= 3.0;
  const isCaffDanger = res.stats.maxCaffeineMg >= 600;
  const chartWrap = document.getElementById("chart-wrap");
  const dangerBox = document.getElementById("danger-warning");
  const dangerText = document.getElementById("danger-text");

  if (isBacDanger || isCaffDanger) {
    chartWrap.classList.add("hidden");
    dangerBox.classList.remove("hidden");
    updateInspectorReadout(null);

    if (isBacDanger) {
      dangerText.textContent =
        `Simulierter Peak: ${res.stats.maxBac.toFixed(2)} ‰. Ab 3.0 ‰ besteht akute Lebensgefahr (Alkoholvergiftung / Koma) – eine Grafik wird hier bewusst nicht mehr angezeigt.`;
    } else {
      dangerText.textContent =
        `Über ${Math.round(res.stats.maxCaffeineMg)} mg aktives Koffein gleichzeitig. Das liegt weit über der sicheren Tagesdosis (400 mg) und führt zu starken Kreislaufproblemen.`;
    }
  } else {
    chartWrap.classList.remove("hidden");
    dangerBox.classList.add("hidden");
    renderChart(res);
    attachChartTouchInspector();
    if (inspectorIndex !== null) {
      setInspectorIndex(inspectorIndex);
    }
  }

  // Mood, Coach & Haupttreiber
  const h = res.stats.maxHangover;
  const moodEl = document.getElementById("mood-pill");
  const coachEl = document.getElementById("coach-text");
  const pillsEl = document.getElementById("driver-pills");

  const wakeNote = res.stats.wakeUp && res.stats.wakeUp.bac >= 0.05
    ? ` Beim Aufwachen (${formatTotalHour(res.stats.wakeUp.time)}) noch ${res.stats.wakeUp.bac.toFixed(2)} ‰ Restalkohol.`
    : "";

const d = res.stats.peakDrivers;
  const hasCaffeine = (res.stats.maxCaffeineMg || 0) >= 25;
  const needsWater = (res.stats.maxFluidDeficitMl || 0) >= 250 || d.fluid > 1.0;
  const needsSleep = d.sleep > 1.0;
  const needsFood = d.glucose > 0.6;

  if (isBacDanger) {
    moodEl.textContent = "🚨 Gefahr";
    coachEl.textContent = "Dieser Plan ist medizinisch extrem gefährlich. Reduziere die Anzahl Drinks oder verteile sie über mehr Stunden.";
  } else if (isCaffDanger) {
    moodEl.textContent = "⚡ Koffein-Limit";
    coachEl.textContent = "Zu viel Koffein auf einmal – das belastet Herz und Kreislauf stark und verhindert erholsamen Schlaf.";
  } else if (h < 1.5) {
    moodEl.textContent = "😎 Fit";
    coachEl.textContent = `Alles im grünen Bereich – morgen früh bist du topfit.${wakeNote}`;
  } else if (h < 4.0) {
    moodEl.textContent = "😐 Leicht müde";
    const tips = [];
    if (needsWater) tips.push("ein bis zwei Gläser Wasser (3 dl)");
    if (hasCaffeine) tips.push("weniger spätes Koffein");
    if (needsFood) tips.push("etwas Essen");
    if (needsSleep) tips.push("etwas mehr Schlaf");
    if (tips.length === 0) tips.push("etwas weniger Alkohol oder mehr Zeit dazwischen");

    coachEl.textContent = `Spürbare Belastung. ${tips.join(" sowie ")} helfen hier am ehesten.${wakeNote}`;
  } else if (h < 6.8) {
    moodEl.textContent = "😵‍💫 Kater-Alarm";
    coachEl.textContent = `Ordentlicher Kater programmiert! Achte auf die rot markierten Haupttreiber unten.${wakeNote}`;
  } else {
    moodEl.textContent = "💀 Schwerer Kater";
    coachEl.textContent = `Hohe Belastung durch Alkohol, Dehydration & Schlafverlust. Essen vorab, Wasser und Elektrolyte helfen am stärksten.${wakeNote}`;
  }

  if (h >= 0.5 && !isBacDanger && !isCaffDanger) {
    pillsEl.innerHTML = `
      <span class="driver-pill ${d.fluid > 1.2 ? "warn" : ""}">💧 Zu wenig Wasser: ${d.fluid.toFixed(1)}</span>
      <span class="driver-pill ${d.alcohol > 1.5 ? "warn" : ""}">🍺 Alkoholmenge: ${d.alcohol.toFixed(1)}</span>
      <span class="driver-pill ${d.sleep > 1.0 ? "warn" : ""}">😴 Zu wenig Schlaf: ${d.sleep.toFixed(1)}</span>
      <span class="driver-pill ${d.glucose > 0.6 ? "warn" : ""}">📉 Tiefer Blutzucker: ${d.glucose.toFixed(1)}</span>
    `;
  } else {
    pillsEl.innerHTML = "";
  }
}

function renderChart(res) {
  const bacCtx = document.getElementById("bacChart").getContext("2d");
  const scoreCtx = document.getElementById("scoreChart").getContext("2d");

  const alignLeftAxis = (axis) => { axis.width = 34; };

  if (bacChart && scoreChart) {
    bacChart.data.labels = res.labels;
    bacChart.data.datasets[0].data = res.bacSeries;
    bacChart.update("none");

    scoreChart.data.labels = res.labels;
    scoreChart.data.datasets[0].data = res.hangoverSeries;
    scoreChart.data.datasets[1].data = res.hydrationSeries;
    scoreChart.update("none");
    return;
  }

  // 1. Oberes Diagramm: Blutalkohol (‰)
  bacChart = new Chart(bacCtx, {
    type: "line",
    data: {
      labels: res.labels,
      datasets: [
        {
          label: "Promille (‰)",
          data: res.bacSeries,
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.16)",
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2.2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      events: [],
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#cbd5e1", boxWidth: 10, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Promille: ${ctx.parsed.y.toFixed(2)} ‰`,
          },
        },
      },
      scales: {
        x: { display: false },
        y: {
          min: 0,
          suggestedMax: 1.5,
          afterFit: alignLeftAxis,
          ticks: { color: "#38bdf8", maxTicksLimit: 4, font: { size: 10 } },
          grid: { color: "rgba(51,65,85,0.4)" },
        },
      },
    },
  });

  // 2. Unteres Diagramm: Kater & Hydration (0–10)
  scoreChart = new Chart(scoreCtx, {
    type: "line",
    data: {
      labels: res.labels,
      datasets: [
        {
          label: "Kater (0–10)",
          data: res.hangoverSeries,
          borderColor: "#fb7185",
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 2.5,
        },
        {
          label: "Hydration (0–10)",
          data: res.hydrationSeries,
          borderColor: "#2dd4bf",
          tension: 0.35,
          pointRadius: 0,
          borderWidth: 1.8,
          borderDash: [2, 3],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      events: [],
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#cbd5e1", boxWidth: 10, font: { size: 11 } } },
      },
      scales: {
        x: {
          ticks: { color: "#94a3b8", maxTicksLimit: 6, font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          min: 0,
          max: 10,
          afterFit: alignLeftAxis,
          ticks: { color: "#94a3b8", stepSize: 2, font: { size: 10 } },
          grid: { color: "rgba(51,65,85,0.4)" },
        },
      },
    },
  });
}

// Start
renderProfileUI();
syncLiveTime();
updateDrinkButton();
renderEventList();
renderHistory();
updateSimulation();