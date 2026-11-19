const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Michaelis-Menten Vmax (‰/h) & individuelle Kater-Sensitivität (ADH/ALDH-Genetik)
const TOLERANCE_PARAMS = {
  low:    { vMax: 0.13, hangoverMult: 1.25, label: "Sensibel" },
  normal: { vMax: 0.16, hangoverMult: 1.00, label: "Normal" },
  high:   { vMax: 0.19, hangoverMult: 0.78, label: "Trinksicher" },
};

// Watson-Formel (1980) für Gesamtkörperwasser (TBW in Litern)
function calcTBW({ gender, age, heightCm, weightKg }) {
  if (gender === "m") {
    return Math.max(20, 2.447 - 0.09156 * age + 0.1074 * heightCm + 0.3362 * weightKg);
  }
  return Math.max(18, -2.097 + 0.1069 * heightCm + 0.2466 * weightKg);
}

// Exakte Ethanolmasse in Gramm (Dichte = 0.789 g/ml)
function calcAlcoholGrams(dl, abv) {
  return dl * 100 * (abv / 100) * 0.789;
}

// Formatiert Stunden im 168-Stunden-Wochenzyklus (Mo 00:00 bis So 23:00)
function formatTotalHour(totalH) {
  const normH = ((Math.floor(totalH) % 168) + 168) % 168;
  const d = Math.floor(normH / 24);
  const h = normH % 24;
  return `${DAYS[d]} ${String(h).padStart(2, "0")}:00`;
}

function runSimulation({ profile, range, events }) {
  const dt = 0.1; // 6-Minuten-Schritte
  const startT = range.startDay * 24 + range.startHour;
  let rawEndT = range.endDay * 24 + range.endHour;
  if (rawEndT <= startT) rawEndT += 168;
  const endT = Math.max(startT + 6, rawEndT);

  const tbw = calcTBW(profile);
  const tol = TOLERANCE_PARAMS[profile.tolerance || "normal"];
  const Km = 0.12; // Michaelis-Menten-Konstante für Ethanol (‰)

  // Zustandsvariablen (Stocks)
  let stomachAlc = 0;     // Ethanol im Magen (g)
  let foodLoad = 0;       // Magenfüllung (0 = nüchtern, 1 = voll)
  let carbBoost = 0;      // Kohlensäure-Effekt im Magen (0 bis 1)
  let bac = 0;            // Blutalkohol (‰)

  let metabolicLoad = 0;  // Stoffwechsel- & Abbau-Belastung durch Ethanol
  let fluidDeficitMl = 0; // Flüssigkeitsdefizit in ml (0 = optimal)
  let electroReserve = 0; // Elektrolyte-Puffer (0 bis 1)
  let bloodGlucose = 90;  // Blutzucker-Index (90 = normal, <70 = Hypoglykämie-Stress)
  let caffeineMg = 0;     // Koffein im Körper (mg, Halbwertszeit ~5h)
  let nicotineLoad = 0;   // Nikotin-Belastung (0 bis 10)
  let sleepDebtH = 0;     // Schlafdefizit (Stunden)

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

  for (let t = startT; t <= endT + 0.001; t += dt) {
    const tClean = Math.round(t * 10) / 10;
    const tWeek = ((tClean % 168) + 168) % 168;
    const hourOfDay = tWeek % 24;

    // 1. Geplante Events verarbeiten
    for (const ev of events) {
      const evT = ev.day * 24 + ev.hour;
      const elapsed = (tWeek - evT + 168) % 168;

      if (ev.type === "drink") {
        const dur = ev.drinkDuration !== undefined ? ev.drinkDuration : 0.5;
        const isActive = dur === 0
          ? (elapsed >= 0 && elapsed < dt - 0.0001)
          : (elapsed >= 0 && elapsed < dur - 0.0001);

        if (isActive) {
          const frac = dur === 0 ? 1.0 : (dt / dur);
          const gramsStep = (ev.grams || 0) * frac;
          stomachAlc += gramsStep;
          lastDrinkingTime = tClean;

          if (ev.carbonated) carbBoost = Math.min(1.0, carbBoost + 0.85 * frac);

          const matchDl = (ev.label || "").match(/([\d.]+)\s*dl/i);
          const drinkMl = matchDl ? parseFloat(matchDl[1]) * 100 : 150;
          fluidDeficitMl = Math.max(0, fluidDeficitMl - (drinkMl * 0.6) * frac);
        }
      } else if (elapsed >= 0 && elapsed < dt - 0.0001) {
        if (ev.type === "water") {
          const ml = (ev.dl || 3) * 100;
          const retention = electroReserve > 0.2 ? 0.95 : 0.75;
          fluidDeficitMl = Math.max(0, fluidDeficitMl - ml * retention);
        } else if (ev.type === "electro") {
          electroReserve = Math.min(1.0, electroReserve + 0.85);
          fluidDeficitMl = Math.max(0, fluidDeficitMl - 200);
        } else if (ev.type === "food") {
          foodLoad = Math.min(1.0, foodLoad + 0.9);
          bloodGlucose = Math.min(100, bloodGlucose + 22);
        } else if (ev.type === "caffeine") {
          caffeineMg = Math.min(1000, caffeineMg + (ev.mg || 90));
        } else if (ev.type === "nicotine") {
          nicotineLoad = Math.min(10, nicotineLoad + 2.2);
        }
      }
    }

    // Aktive Zustände: Schlaf & Tanzen
    const isSleeping = events.some((ev) => {
      if (ev.type !== "sleep") return false;
      const sStart = ev.day * 24 + ev.hour;
      const dur = ev.duration || 7.5;
      const elapsed = (tWeek - sStart + 168) % 168;
      return elapsed >= 0 && elapsed < dur - 0.0001;
    });

    const isDancing = events.some((ev) => {
      if (ev.type !== "dance") return false;
      const dStart = ev.day * 24 + ev.hour;
      const dur = ev.duration || 1;
      const elapsed = (tWeek - dStart + 168) % 168;
      return elapsed >= 0 && elapsed < dur - 0.0001;
    });

    // 2. Magenentleerung, Kohlensäure & Tanz-Durchblutung
    const baseK = 2.4 - 1.5 * foodLoad;
    const danceBoost = isDancing && !isSleeping ? 1.12 : 1.0;
    const kAbs = baseK * (1 + 0.35 * carbBoost) * danceBoost;
    const bioavailability = Math.min(0.95, 0.90 - 0.18 * foodLoad + 0.04 * carbBoost);

    const leavingStomach = stomachAlc * kAbs * dt;
    stomachAlc = Math.max(0, stomachAlc - leavingStomach);
    foodLoad = Math.max(0, foodLoad - 0.25 * dt);
    carbBoost = Math.max(0, carbBoost - 0.9 * dt);

    const absorbedGrams = leavingStomach * bioavailability;
    const bacInflow = (absorbedGrams * 0.806) / tbw;

    // 3. Michaelis-Menten-Abbau (Ethanol)
    const elimRate = (tol.vMax * bac) / (Km + bac);
    const actualElim = Math.min(bac + bacInflow, elimRate * dt);
    bac = Math.max(0, bac + bacInflow - actualElim);

    // 4. Alkohol-Abbau-Belastung & Nikotin-Einfluss
    const nicotineExtra = nicotineLoad * Math.min(1.2, bac) * 0.05 * dt;
    metabolicLoad = Math.max(
      0,
      metabolicLoad + actualElim * 0.85 + nicotineExtra - metabolicLoad * 0.12 * dt
    );

    // 5. Koffein & Raucher-Profil
    caffeineMg = Math.max(0, caffeineMg * Math.exp(-0.1386 * dt));
    const isSmokingNow = Boolean(profile.smoker) && !isSleeping &&
      (bac > 0.15 || (lastDrinkingTime >= 0 && (tClean - lastDrinkingTime) <= 2.5));
    if (isSmokingNow) {
      nicotineLoad = Math.min(10, nicotineLoad + 2.2 * dt);
    }
    nicotineLoad = Math.max(0, nicotineLoad - 0.18 * nicotineLoad * dt);

    // 6. Blutzucker
    const danceGlucoseBurn = isDancing && !isSleeping ? 3.2 * dt : 0;
    if ((bac > 0.12 && foodLoad < 0.2) || danceGlucoseBurn > 0) {
      const alcDrop = (bac > 0.12 && foodLoad < 0.2) ? 4.2 * Math.min(1.5, bac) * dt : 0;
      bloodGlucose = Math.max(45, bloodGlucose - alcDrop - danceGlucoseBurn);
    } else if (bloodGlucose < 90) {
      const recoveryRate = foodLoad > 0.2 ? 7.0 : 2.8;
      bloodGlucose = Math.min(90, bloodGlucose + recoveryRate * dt);
    }

    // 7. Flüssigkeitsbilanz
    const sweatMl = isDancing && !isSleeping ? 280 * dt : 0;
    const diuresisMl = (absorbedGrams * 10.0) + (caffeineMg * 0.1 * dt) + sweatMl;
    const naturalRehyd = !isSleeping && fluidDeficitMl > 0 ? 45 * dt : 0;
    fluidDeficitMl = Math.max(0, Math.min(2500, fluidDeficitMl + diuresisMl - naturalRehyd));
    electroReserve = Math.max(0, electroReserve - (isDancing ? 0.14 : 0.08) * dt);

    // 8. Zirkadianer Rhythmus & Schlaf
    const baseMelatonin = 0.5 + 0.5 * Math.cos(2 * Math.PI * ((hourOfDay - 2) / 24));
    const alcMelSuppression = (hourOfDay >= 20 || hourOfDay <= 5) ? 0.25 * Math.min(1, bac) : 0;
    const melatonin = Math.max(0, baseMelatonin * (1 - alcMelSuppression));

    if (isSleeping) {
      const caffPenalty = Math.min(0.42, (caffeineMg / 180) * 0.42);
      const nicPenalty = Math.min(0.15, (nicotineLoad / 10) * 0.15);
      const alcPenalty = Math.min(0.55, 0.50 * bac);
      const melBonus = 0.15 * melatonin;
      const sleepQuality = Math.max(0.22, Math.min(1.0, 0.9 + melBonus - alcPenalty - caffPenalty - nicPenalty));

      sleepDebtH = Math.max(0, sleepDebtH - 1.25 * sleepQuality * dt);
      sleepDebtH += (1.0 - sleepQuality) * 0.55 * dt;
    } else {
      const danceFatigue = isDancing ? 0.10 * dt : 0;
      sleepDebtH = Math.min(12, sleepDebtH + 0.14 * dt + danceFatigue);
    }

    // 9. Kater-Index (0–10)
    const hangoverUnmasking = Math.exp(-1.4 * bac);
    const hasDrankRecently = Math.min(1, metabolicLoad * 2.2);

    const fluidScore = (fluidDeficitMl / 1200) * 3.0;
    const sleepScore = (sleepDebtH / 6.0) * 2.1;
    const alcoholScore = metabolicLoad * 2.6;
    const glucoseScore = Math.max(0, (75 - bloodGlucose) / 25) * 1.8;

    const electroBonus = electroReserve * 0.9;
    const morningCaffRelief = (!isSleeping && bac < 0.15 && caffeineMg >= 25 && caffeineMg <= 180) ? 0.45 : 0;

    const rawHangover = hasDrankRecently * hangoverUnmasking * tol.hangoverMult *
      (alcoholScore + fluidScore + sleepScore + glucoseScore - electroBonus - morningCaffRelief);
    const hangover = Math.max(0, Math.min(10, rawHangover));

    if (wasSleeping && !isSleeping && lastDrinkingTime >= 0) {
      wakeUp = { time: tClean, bac, hangover };
    }
    wasSleeping = isSleeping;

    if (bac > maxBac) maxBac = bac;
    if (fluidDeficitMl > maxFluidDeficitMl) maxFluidDeficitMl = fluidDeficitMl;
    if (bloodGlucose < minGlucose) minGlucose = bloodGlucose;
    if (caffeineMg > maxCaffeineMg) maxCaffeineMg = caffeineMg;

    if (hangover > maxHangover) {
      maxHangover = hangover;
      peakDrivers = { fluid: fluidScore, sleep: sleepScore, alcohol: alcoholScore, glucose: glucoseScore };
    }

    if (lastDrinkingTime >= 0 && tClean > lastDrinkingTime + 0.5 && bac < 0.02 && soberTime === null) {
      soberTime = tClean;
    }

    if (Math.abs(tClean - Math.round(tClean)) < 0.001) {
      labels.push(formatTotalHour(Math.round(tClean)));
      bacSeries.push(Number(bac.toFixed(2)));
      hangoverSeries.push(Number(hangover.toFixed(1)));
      const hydScore = Math.max(1.0, 10 - (fluidDeficitMl / 300));
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