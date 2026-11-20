// ============================================================
// model.js – drinkwithme
// Vereinfachtes pharmakokinetisches 1-Kompartiment-Modell
// + wissenschaftliche Wissensbasis & Eingabevalidierung
// ============================================================

const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Enzym- & Sensitivitäts-Profile (Keys low/normal/high bleiben kompatibel zu app.js)
// Hinweis: Modelliert individuelles ADH/ALDH-Abbautempo – kein Schutz vor Organschäden.
const TOLERANCE_PARAMS = {
  low:    { vMax: 0.13, aldhRate: 0.78, hangoverMult: 1.18, label: "Langsamer Abbau" },
  normal: { vMax: 0.16, aldhRate: 1.00, hangoverMult: 1.00, label: "Normaler Abbau" },
  high:   { vMax: 0.19, aldhRate: 1.22, hangoverMult: 0.85, label: "Schneller Abbau" },
};

// ============================================================
// 1. WISSENSCHAFTLICHE WISSENSBASIS (EVIDENZ, QUELLEN, SYSTEME)
// ============================================================

const EVIDENCE = Object.freeze({
  established: "Gut belegter biologischer Mechanismus",
  supported: "Durch Forschung gestützter Zusammenhang",
  contextDependent: "Kontextabhängig; nicht pauschal verallgemeinerbar",
  uncertain: "Individuell unterschiedlich oder noch nicht abschliessend geklärt",
});

const SOURCES = Object.freeze({
  watson1980: Object.freeze({
    id: "watson1980",
    authors: "Watson PE, Watson ID, Batt RD",
    year: 1980,
    title: "Total body water volumes for adult males and females estimated from simple anthropometric measurements",
    journal: "Am J Clin Nutr",
    doi: "10.1093/ajcn/33.1.27",
    url: "https://pubmed.ncbi.nlm.nih.gov/6986753/",
  }),
  wilkinson1977: Object.freeze({
    id: "wilkinson1977",
    authors: "Wilkinson PK, Sedman AJ, Sakmar E, Kay DR, Wagner JG",
    year: 1977,
    title: "Pharmacokinetics of ethanol after oral administration in the fasting state",
    journal: "J Pharmacokinet Biopharm",
    doi: "10.1007/BF01065396",
    url: "https://pubmed.ncbi.nlm.nih.gov/881642/",
  }),
  maughan2016: Object.freeze({
    id: "maughan2016",
    authors: "Maughan RJ, Watson P, Cordery PA et al.",
    year: 2016,
    title: "A randomized trial to assess the potential of different beverages to affect hydration status: development of a beverage hydration index",
    journal: "Am J Clin Nutr",
    doi: "10.3945/ajcn.115.114769",
    url: "https://pubmed.ncbi.nlm.nih.gov/26702122/",
  }),
  niaaaMetabolism: Object.freeze({
    id: "niaaaMetabolism",
    authors: "NIAAA",
    year: 2024,
    title: "Alcohol Metabolism",
    journal: "National Institute on Alcohol Abuse and Alcoholism",
    url: "https://www.niaaa.nih.gov/publications/alcohol-metabolism",
  }),
  niaaaHangover: Object.freeze({
    id: "niaaaHangover",
    authors: "NIAAA",
    year: 2024,
    title: "Hangovers",
    journal: "National Institute on Alcohol Abuse and Alcoholism",
    url: "https://www.niaaa.nih.gov/publications/brochures-and-fact-sheets/hangovers",
  }),
  sleepReview2025: Object.freeze({
    id: "sleepReview2025",
    authors: "Gardiner C et al.",
    year: 2025,
    title: "The effect of alcohol on subsequent sleep in healthy adults: A systematic review and meta-analysis",
    journal: "Sleep Medicine Reviews",
    url: "https://pubmed.ncbi.nlm.nih.gov/39631226/",
  }),
  cdcCaffeine: Object.freeze({
    id: "cdcCaffeine",
    authors: "CDC",
    year: 2024,
    title: "Effects of Mixing Alcohol and Caffeine",
    journal: "Centers for Disease Control and Prevention",
    url: "https://www.cdc.gov/alcohol/about-alcohol-use/alcohol-caffeine.html",
  }),
  hangoverReview: Object.freeze({
    id: "hangoverReview",
    authors: "Palmer E, Tyacke R, Sastre M et al.",
    year: 2019,
    title: "Alcohol Hangover: Mechanisms and Mediators",
    journal: "Alcohol and Alcoholism",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6761819/",
  }),
});

const METABOLISM_PATHWAY = Object.freeze([
  Object.freeze({
    id: "ethanol-to-acetaldehyde",
    order: 1,
    substrate: "Ethanol",
    enzyme: "Alkoholdehydrogenase (ADH)",
    product: "Acetaldehyd",
    description: "ADH oxidiert Ethanol zu dem reaktiven Zwischenprodukt Acetaldehyd.",
    evidence: EVIDENCE.established,
    sourceIds: ["niaaaMetabolism"],
  }),
  Object.freeze({
    id: "acetaldehyde-to-acetate",
    order: 2,
    substrate: "Acetaldehyd",
    enzyme: "Aldehyddehydrogenase (ALDH)",
    product: "Acetat",
    description: "ALDH baut Acetaldehyd weiter zu Acetat ab. Genetische Varianten beeinflussen das Tempo.",
    evidence: EVIDENCE.established,
    sourceIds: ["niaaaMetabolism"],
  }),
  Object.freeze({
    id: "acetate-further-metabolism",
    order: 3,
    substrate: "Acetat",
    enzyme: "Zelluläre Stoffwechselwege",
    product: "CO2 & Wasser",
    description: "Acetat wird in nachgelagerten Stoffwechselwegen weiterverarbeitet.",
    evidence: EVIDENCE.established,
    sourceIds: ["niaaaMetabolism"],
  }),
]);

const PHYSIOLOGICAL_SYSTEMS = Object.freeze([
  Object.freeze({
    id: "liver",
    name: "Leber & Stoffwechsel (ADH/ALDH)",
    summary: "Baut Ethanol schrittweise über Acetaldehyd zu Acetat ab.",
    evidence: EVIDENCE.established,
    sourceIds: ["niaaaMetabolism", "wilkinson1977"],
  }),
  Object.freeze({
    id: "fluid-regulation",
    name: "Nieren & Flüssigkeitshaushalt (AVP)",
    summary: "Alkohol beeinflusst Vasopressin (AVP) und kann die Wasserausscheidung erhöhen. Elektrolytlösungen (ORS) zeigen gegenüber Wasser eine leicht höhere Flüssigkeitsretention.",
    evidence: EVIDENCE.supported,
    sourceIds: ["maughan2016", "niaaaHangover", "hangoverReview"],
  }),
  Object.freeze({
    id: "sleep",
    name: "Schlaf & Erholung",
    summary: "Alkohol stört die Schlafkontinuität und verkürzt den REM-Schlaf bei Erwachsenen.",
    evidence: EVIDENCE.supported,
    sourceIds: ["sleepReview2025", "niaaaHangover"],
  }),
  Object.freeze({
    id: "glucose-regulation",
    name: "Blutzuckerregulation",
    summary: "Der Ethanolstoffwechsel kann die Glukosebereitstellung der Leber kontextabhängig hemmen.",
    evidence: EVIDENCE.contextDependent,
    sourceIds: ["niaaaMetabolism"],
  }),
  Object.freeze({
    id: "caffeine-interaction",
    name: "Koffein & subjektive Wachheit",
    summary: "Koffein kann Müdigkeit überdecken, hebt die Alkoholwirkung aber nicht auf und reduziert keinen Kater.",
    evidence: EVIDENCE.established,
    sourceIds: ["cdcCaffeine"],
  }),
  Object.freeze({
    id: "immune-system",
    name: "Immunsystem & Entzündung",
    summary: "Alkohol und Abbauprodukte modulieren entzündliche Signalwege, die zum Katergefühl beitragen.",
    evidence: EVIDENCE.supported,
    sourceIds: ["niaaaHangover", "hangoverReview"],
  }),
]);

function getPhysiologicalSystems() {
  return PHYSIOLOGICAL_SYSTEMS.map((s) => ({ ...s, sourceIds: [...s.sourceIds] }));
}

function getPhysiologicalSystem(systemId) {
  const sys = PHYSIOLOGICAL_SYSTEMS.find((s) => s.id === systemId);
  return sys ? { ...sys, sourceIds: [...sys.sourceIds] } : null;
}

function getSourcesForSystem(systemId) {
  const sys = getPhysiologicalSystem(systemId);
  if (!sys) return [];
  return sys.sourceIds.map((id) => SOURCES[id]).filter(Boolean);
}

// ============================================================
// 2. VALIDIERUNG & PHARMAKOKINETISCHE HILFSFUNKTIONEN
// ============================================================

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function sanitizeProfile(raw = {}) {
  const gender = raw.gender === "f" ? "f" : "m";
  const age = clamp(Number.isFinite(Number(raw.age)) ? Number(raw.age) : 24, 18, 95);
  const heightCm = clamp(Number.isFinite(Number(raw.heightCm)) ? Number(raw.heightCm) : 175, 135, 225);
  const weightKg = clamp(Number.isFinite(Number(raw.weightKg)) ? Number(raw.weightKg) : 70, 38, 180);
  const tolerance = TOLERANCE_PARAMS[raw.tolerance] ? raw.tolerance : "normal";
  const smoker = Boolean(raw.smoker);
  return { gender, age, heightCm, weightKg, tolerance, smoker };
}

function sanitizeEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return [];
  const allowedTypes = new Set(["drink", "water", "electro", "food", "caffeine", "nicotine", "sleep", "dance"]);
  return rawEvents
    .filter((ev) => ev && typeof ev === "object" && allowedTypes.has(ev.type))
    .map((ev) => ({
      ...ev,
      day: ((Math.floor(Number(ev.day) || 0) % 7) + 7) % 7,
      hour: clamp(Number.isFinite(Number(ev.hour)) ? Number(ev.hour) : 0, 0, 23.9),
      grams: Math.max(0, Number(ev.grams) || 0),
      dl: ev.dl !== undefined ? Math.max(0, Number(ev.dl) || 0) : undefined,
      mg: ev.mg !== undefined ? Math.max(0, Number(ev.mg) || 0) : undefined,
      duration: ev.duration !== undefined ? Math.max(0, Number(ev.duration) || 0) : undefined,
      drinkDuration: ev.drinkDuration !== undefined ? Math.max(0, Number(ev.drinkDuration) || 0) : undefined,
    }));
}

// Watson-Formel (1980) für erwachsene Personen (TBW in Litern)
// Original-Koeffizient Männer: 0.09516 * age
function calcTBW(profile) {
  const { gender, age, heightCm, weightKg } = sanitizeProfile(profile);
  if (gender === "m") {
    return Math.max(20, 2.447 - 0.09516 * age + 0.1074 * heightCm + 0.3362 * weightKg);
  }
  return Math.max(18, -2.097 + 0.1069 * heightCm + 0.2466 * weightKg);
}

// Exakte Ethanolmasse in Gramm (Dichte = 0.789 g/ml)
function calcAlcoholGrams(dl, abv) {
  const safeDl = Math.max(0, Number(dl) || 0);
  const safeAbv = clamp(Number(abv) || 0, 0, 100);
  return safeDl * 100 * (safeAbv / 100) * 0.789;
}

// Formatiert Stunden im 168-Stunden-Wochenzyklus (Mo 00:00 bis So 23:00)
function formatTotalHour(totalH) {
  const normH = ((Math.floor(totalH) % 168) + 168) % 168;
  const d = Math.floor(normH / 24);
  const h = normH % 24;
  return `${DAYS[d]} ${String(h).padStart(2, "0")}:00`;
}

// ============================================================
// 3. NUMERISCHE SIMULATION (1-Kompartiment-Näherung)
// ============================================================

function runSimulation({ profile: rawProfile, range: rawRange, events: rawEvents }) {
  const stepsPerHour = 10; // 6-Minuten-Schritte (ganzzahlig, kein Fliesskomma-Drift)
  const dt = 1 / stepsPerHour;
  const weekSteps = 168 * stepsPerHour;

  const profile = sanitizeProfile(rawProfile);
  const events = sanitizeEvents(rawEvents);

  const startDay = ((Math.floor(Number(rawRange?.startDay) || 0) % 7) + 7) % 7;
  const startHour = clamp(Math.floor(Number(rawRange?.startHour) || 0), 0, 23);
  const endDay = ((Math.floor(Number(rawRange?.endDay) || 0) % 7) + 7) % 7;
  const endHour = clamp(Math.floor(Number(rawRange?.endHour) || 0), 0, 23);

  const startT = startDay * 24 + startHour;
  let rawEndT = endDay * 24 + endHour;
  if (rawEndT === startT) {
    rawEndT = startT + 24; // Gleiche Start-/Endzeit -> 24h-Fenster statt 168h
  } else if (rawEndT < startT) {
    rawEndT += 168;
  }
  const endT = Math.max(startT + 6, rawEndT);

  const startStep = startT * stepsPerHour;
  const endStep = endT * stepsPerHour;

  const tbw = calcTBW(profile);
  const tol = TOLERANCE_PARAMS[profile.tolerance];
  const Km = 0.12; // Michaelis-Menten-Konstante (‰)

  // Zustandsvariablen (Stocks)
  let stomachAlc = 0;        // Ethanol im Magen (g)
  let foodLoad = 0;          // Magenfüllung als Resorptionsbremse (0..1)
  let carbBoost = 0;         // Kohlensäure-Effekt (0..1)
  let bac = 0;               // Blutalkohol (‰, 1-Kompartiment-Näherung)

  let acetaldehydeLoad = 0;  // Schritt 1 (ADH): Zwischenprodukt Acetaldehyd (rel. Einheit)
  let hangoverMediator = 0;  // Schritt 2 (nachgelagerte metabolische/entzündliche Kater-Last)

  let waterBufferMl = 0;     // Stilles Wasser im Magen/Darm (max. 600 ml, ~70 % Retention)
  let orsBufferMl = 0;       // Elektrolyt-Lösung/ORS im Magen/Darm (max. 600 ml, ~85 % Retention)
  let fluidDeficitMl = 0;    // Netto-Flüssigkeitsdefizit in ml (AVP-Diurese)
  let bloodGlucose = 90;     // Blutzucker-Index (45..100, vereinfacht)
  let caffeineMg = 0;        // Koffein im Körper (mg)
  let nicotineLoad = 0;      // Nikotin-Belastung (0..10)
  let sleepDebtH = 0;        // Vereinfachtes Schlafdefizit (Stunden)

  const labels = [];
  const bacSeries = [];
  const hangoverSeries = [];
  const hydrationSeries = [];

  let maxBac = 0;
  let maxHangover = 0;
  let maxFluidDeficitMl = 0;
  let maxCaffeineMg = 0;
  let minGlucose = 90;
  let peakDrivers = { fluid: 0, sleep: 0, alcohol: 0, glucose: 0 };
  let lastDrinkingTime = -1;
  let soberTime = null;
  let wasSleeping = false;
  let wakeUp = null;

  for (let step = startStep; step <= endStep; step++) {
    const tClean = step / stepsPerHour;
    const stepWeek = ((step % weekSteps) + weekSteps) % weekSteps;
    const hourOfDay = (stepWeek / stepsPerHour) % 24;

    // 1. Events exakt über ganzzahlige Schritte verarbeiten (100% Massenerhaltung)
    for (const ev of events) {
      const evStep = Math.round((ev.day * 24 + ev.hour) * stepsPerHour) % weekSteps;
      const stepDiff = (stepWeek - evStep + weekSteps) % weekSteps;

      if (ev.type === "drink") {
        const durH = ev.drinkDuration ?? 0.5;
        const durSteps = durH <= 0 ? 1 : Math.max(1, Math.round(durH * stepsPerHour));

        if (stepDiff >= 0 && stepDiff < durSteps) {
          const frac = 1 / durSteps;
          const gramsStep = ev.grams * frac;
          stomachAlc += gramsStep;
          lastDrinkingTime = tClean;
          if (ev.carbonated) carbBoost = Math.min(1.0, carbBoost + 0.85 * frac);

          const matchDl = (ev.label || "").match(/([\d.]+)\s*dl/i);
          const drinkMl = matchDl ? parseFloat(matchDl[1]) * 100 : 150;
          const abvEst = drinkMl > 0 ? ev.grams / (drinkMl * 0.00789) : 12;
          if (abvEst <= 6.5) {
            waterBufferMl = Math.min(600, waterBufferMl + (drinkMl * 0.25) * frac);
          }
        }
      } else if (stepDiff === 0) {
        if (ev.type === "water") {
          const ml = (ev.dl ?? 3) * 100;
          waterBufferMl = Math.min(600, waterBufferMl + ml);
        } else if (ev.type === "electro") {
          const ml = (ev.dl ?? 3) * 100;
          orsBufferMl = Math.min(600, orsBufferMl + ml);
        } else if (ev.type === "food") {
          const carbs = ev.carbsG ?? 50;
          const fat = ev.fatG ?? 5;
          const protein = ev.proteinG ?? 12;

          const evT = ev.day * 24 + ev.hour;
          const hasDrinkAfterFood = events.some((other) => {
            if (other.type !== "drink") return false;
            const otherT = other.day * 24 + other.hour;
            const relT = (otherT - evT + 168) % 168;
            return relT >= 0 && relT <= 6;
          });

          const baseMealLoad = Math.min(1.0, carbs * 0.008 + fat * 0.03 + protein * 0.015);

          if (hasDrinkAfterFood || stomachAlc > 0) {
            // Essen VOR/WÄHREND dem Trinken: bremst Resorption & schützt Blutzucker
            foodLoad = Math.min(1.0, foodLoad + baseMealLoad * 1.15);
            bloodGlucose = Math.min(100, bloodGlucose + carbs * 0.65 + protein * 0.25);
          } else {
            // Essen NACH dem Trinken: stützt Blutzucker und dämpft leicht die Erholungs-Last
            foodLoad = Math.min(1.0, foodLoad + baseMealLoad * 0.35);
            bloodGlucose = Math.min(100, bloodGlucose + carbs * 0.80 + protein * 0.35);
            hangoverMediator = Math.max(0, hangoverMediator - 0.18);
          }
        } else if (ev.type === "caffeine") {
          caffeineMg = Math.min(1000, caffeineMg + (ev.mg ?? 90));
        } else if (ev.type === "nicotine") {
          nicotineLoad = Math.min(10, nicotineLoad + 2.2);
        }
      }
    }

    // Aktive Zustände: Schlaf & Tanzen (mit ?? statt ||)
    const isSleeping = events.some((ev) => {
      if (ev.type !== "sleep") return false;
      const durSteps = Math.round((ev.duration ?? 7.5) * stepsPerHour);
      if (durSteps <= 0) return false;
      const sStep = Math.round((ev.day * 24 + ev.hour) * stepsPerHour) % weekSteps;
      const diff = (stepWeek - sStep + weekSteps) % weekSteps;
      return diff >= 0 && diff < durSteps;
    });

    const isDancing = events.some((ev) => {
      if (ev.type !== "dance") return false;
      const durSteps = Math.round((ev.duration ?? 1) * stepsPerHour);
      if (durSteps <= 0) return false;
      const dStep = Math.round((ev.day * 24 + ev.hour) * stepsPerHour) % weekSteps;
      const diff = (stepWeek - dStep + weekSteps) % weekSteps;
      return diff >= 0 && diff < durSteps;
    });

    // 2. Resorption (Magen -> zentrales Kompartiment)
    const baseK = 2.4 - 1.5 * foodLoad;
    const danceBoost = isDancing && !isSleeping ? 1.12 : 1.0;
    const kAbs = baseK * (1 + 0.35 * carbBoost) * danceBoost;
    const bioavailability = clamp(0.90 - 0.22 * foodLoad + 0.04 * carbBoost, 0.55, 0.95);

    const leavingStomach = stomachAlc * kAbs * dt;
    stomachAlc = Math.max(0, stomachAlc - leavingStomach);
    foodLoad = Math.max(0, foodLoad - 0.22 * dt);
    carbBoost = Math.max(0, carbBoost - 0.9 * dt);

    const absorbedGrams = leavingStomach * bioavailability;
    const bacInflow = (absorbedGrams * 0.806) / tbw;

    // 3. Michaelis-Menten-Abbau: Ethanol -> Acetaldehyd (ADH) -> Acetat (ALDH)
    const elimRate = (tol.vMax * bac) / (Km + bac);
    const actualElimBac = Math.min(bac + bacInflow, elimRate * dt);
    bac = Math.max(0, bac + bacInflow - actualElimBac);

    const metabolizedGrams = (actualElimBac * tbw) / 0.806;
    acetaldehydeLoad += metabolizedGrams * 0.08;
    const aldhCleared = acetaldehydeLoad * tol.aldhRate * dt;
    acetaldehydeLoad = Math.max(0, acetaldehydeLoad - aldhCleared);

    // Nachgelagerte Kater-Mediatoren (Acetaldehyd-Exposition + Entzündungsantwort)
    const nicotineExtra = nicotineLoad * Math.min(1.2, bac) * 0.04;
    hangoverMediator = Math.max(
      0,
      hangoverMediator + (acetaldehydeLoad * 0.45 + nicotineExtra) * dt - hangoverMediator * 0.075 * dt
    );

    // 4. Koffein & Nikotin
    caffeineMg = Math.max(0, caffeineMg * Math.exp(-0.1386 * dt));
    const isSmokingNow = profile.smoker && !isSleeping &&
      (bac > 0.15 || (lastDrinkingTime >= 0 && (tClean - lastDrinkingTime) <= 2.5));
    if (isSmokingNow) nicotineLoad = Math.min(10, nicotineLoad + 2.2 * dt);
    nicotineLoad = Math.max(0, nicotineLoad - 0.18 * nicotineLoad * dt);

    // 5. Vereinfachte Blutzucker-Dynamik
    const danceGlucoseBurn = isDancing && !isSleeping ? 3.2 * dt : 0;
    if ((bac > 0.12 && foodLoad < 0.2) || danceGlucoseBurn > 0) {
      const alcDrop = (bac > 0.12 && foodLoad < 0.2) ? 4.0 * Math.min(1.5, bac) * dt : 0;
      bloodGlucose = Math.max(45, bloodGlucose - alcDrop - danceGlucoseBurn);
    } else if (bloodGlucose < 90) {
      const recoveryRate = foodLoad > 0.2 ? 7.5 : 2.8;
      bloodGlucose = Math.min(90, bloodGlucose + recoveryRate * dt);
    }

    // 6. Flüssigkeitsbilanz (AVP-Diurese & Maughan BHI-Retention, ohne Doppelzählung)
    const sweatMl = isDancing && !isSleeping ? 280 * dt : 0;
    const diuresisMl = (absorbedGrams * 10.0) + (caffeineMg * 0.08 * dt) + sweatMl;

    const absorbedWaterMl = waterBufferMl * 1.5 * dt;
    waterBufferMl = Math.max(0, waterBufferMl - absorbedWaterMl);

    const absorbedOrsMl = orsBufferMl * 1.5 * dt;
    orsBufferMl = Math.max(0, orsBufferMl - absorbedOrsMl);

    const effectiveRehydMl = (absorbedWaterMl * 0.70) + (absorbedOrsMl * 0.85);
    const naturalRehyd = !isSleeping && fluidDeficitMl > 0 ? 32 * dt : 0;

    fluidDeficitMl = clamp(fluidDeficitMl + diuresisMl - effectiveRehydMl - naturalRehyd, 0, 2200);

    // 7. Vereinfachtes Schlafqualität- & Erholungsmodell (keine REM-Zyklen)
    const circadianFactor = 0.5 + 0.5 * Math.cos(2 * Math.PI * ((hourOfDay - 2) / 24));
    if (isSleeping) {
      const caffPenalty = Math.min(0.42, (caffeineMg / 180) * 0.42);
      const nicPenalty = Math.min(0.15, (nicotineLoad / 10) * 0.15);
      const alcPenalty = Math.min(0.55, 0.50 * bac);
      const sleepQuality = clamp(0.88 + 0.12 * circadianFactor - alcPenalty - caffPenalty - nicPenalty, 0.22, 1.0);

      sleepDebtH = Math.max(0, sleepDebtH - 1.25 * sleepQuality * dt);
      sleepDebtH += (1.0 - sleepQuality) * 0.55 * dt;
    } else {
      const danceFatigue = isDancing ? 0.10 * dt : 0;
      sleepDebtH = Math.min(12, sleepDebtH + 0.14 * dt + danceFatigue);
    }

    // 8. Kater-Index (0–10, spielerische Modellschätzung)
    // Koffein senkt den Kater-Index NICHT (CDC-konform).
    // Elektrolyte senken ihn nur indirekt über geringeres Flüssigkeitsdefizit (NIAAA-konform).
    const unmasking = Math.exp(-0.60 * bac);
    const hasDrankRecently = Math.min(1, (hangoverMediator + acetaldehydeLoad) * 1.3);

    const alcoholScore = hangoverMediator * 1.35;
    const fluidScore = (fluidDeficitMl / 650) * 2.5;
    const sleepScore = (sleepDebtH / 6.0) * 2.1;
    const glucoseScore = Math.max(0, (75 - bloodGlucose) / 25) * 1.6;

    const rawHangover = hasDrankRecently * unmasking * tol.hangoverMult *
      (alcoholScore + fluidScore + sleepScore + glucoseScore);
    const hangover = clamp(rawHangover, 0, 10);

    if (wasSleeping && !isSleeping && lastDrinkingTime >= 0) {
      wakeUp = { time: tClean, bac, hangover };
    }
    wasSleeping = isSleeping;

    if (bac > maxBac) maxBac = bac;
    if (fluidDeficitMl > maxFluidDeficitMl) maxFluidDeficitMl = fluidDeficitMl;
    if (bloodGlucose < minGlucose) minGlucose = bloodGlucose;
    if (caffeineMg > maxCaffeineMg) maxCaffeineMg = caffeineMg;

    if (hangover >= maxHangover) {
      maxHangover = hangover;
      peakDrivers = { fluid: fluidScore, sleep: sleepScore, alcohol: alcoholScore, glucose: glucoseScore };
    }

    // Rechnerischer 0.0-‰-Schätzwert (erst wenn Magen leer & BAC < 0.02; kein Fahrtüchtigkeitstest)
    if (lastDrinkingTime >= 0 && tClean > lastDrinkingTime + 0.5 && stomachAlc < 0.1 && bac < 0.02 && soberTime === null) {
      soberTime = tClean;
    }

    if (step % stepsPerHour === 0) {
      labels.push(formatTotalHour(Math.round(tClean)));
      bacSeries.push(Number(bac.toFixed(2)));
      hangoverSeries.push(Number(hangover.toFixed(1)));
      const hydScore = clamp(10 - (fluidDeficitMl / 170), 1.0, 10.0);
      hydrationSeries.push(Number(hydScore.toFixed(1)));
    }
  }

  return {
    tbw,
    elimRate: tol.vMax,
    labels,
    bacSeries,
    hangoverSeries,
    hydrationSeries,
    stats: { maxBac, maxHangover, maxFluidDeficitMl, maxCaffeineMg, minGlucose, peakDrivers, soberTime, wakeUp },
  };
}

// Optionaler globaler Namespace für einfache Tests & spätere UI-Integration
if (typeof globalThis !== "undefined") {
  globalThis.AlcoholModel = Object.freeze({
    DAYS,
    EVIDENCE,
    SOURCES,
    METABOLISM_PATHWAY,
    PHYSIOLOGICAL_SYSTEMS,
    calcTBW,
    calcAlcoholGrams,
    formatTotalHour,
    getPhysiologicalSystems,
    getPhysiologicalSystem,
    getSourcesForSystem,
    runSimulation,
  });
}