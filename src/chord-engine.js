// First-pass chord matcher. It ranks pitch-class templates from the live spectrum.
// Its score is a heuristic match score, not a calibrated probability.
const NOTE_NAMES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const CHORD_TYPES = [
  ["",[0,4,7]], ["m",[0,3,7]], ["dim",[0,3,6]], ["aug",[0,4,8]],
  ["sus2",[0,2,7]], ["sus4",[0,5,7]], ["7",[0,4,7,10]],
  ["maj7",[0,4,7,11]], ["m7",[0,3,7,10]], ["mMaj7",[0,3,7,11]],
  ["m7♭5",[0,3,6,10]], ["dim7",[0,3,6,9]], ["6",[0,4,7,9]],
  ["m6",[0,3,7,9]], ["add9",[0,2,4,7]], ["9",[0,2,4,7,10]],
  ["maj9",[0,2,4,7,11]], ["m9",[0,2,3,7,10]]
];

export function frequencyToMidi(frequency) {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function findSpectralPeaks(spectrum, sampleRate, fftSize) {
  const peaks = [];
  const lowBin = Math.max(2, Math.floor(65 * fftSize / sampleRate));
  const highBin = Math.min(spectrum.length - 2, Math.ceil(1000 * fftSize / sampleRate));
  for (let bin = lowBin; bin <= highBin; bin++) {
    if (spectrum[bin] <= spectrum[bin - 1] || spectrum[bin] < spectrum[bin + 1] || spectrum[bin] < -78) continue;
    const left = spectrum[bin - 1], centre = spectrum[bin], right = spectrum[bin + 1];
    const denominator = left - 2 * centre + right;
    const offset = denominator ? 0.5 * (left - right) / denominator : 0;
    const frequency = (bin + offset) * sampleRate / fftSize;
    if (frequency > 0) peaks.push({ frequency, db: centre, midi: frequencyToMidi(frequency) });
  }
  return peaks.sort((a,b) => b.db - a.db).slice(0, 40);
}

export function buildPitchClassScores(peaks) {
  const energy = Array(12).fill(0);
  for (const peak of peaks) {
    const strength = Math.pow(10, peak.db / 20);
    const pitch = Math.round(peak.midi);
    energy[((pitch % 12) + 12) % 12] += strength;
    // A modest harmonic contribution helps recover fundamentals under strong overtones.
    for (let harmonic = 2; harmonic <= 4; harmonic++) {
      const fundamental = peak.frequency / harmonic;
      if (fundamental < 65) continue;
      const midi = Math.round(frequencyToMidi(fundamental));
      energy[((midi % 12) + 12) % 12] += strength / (harmonic * 3.2);
    }
  }
  const maximum = Math.max(...energy, 0.000001);
  return energy.map((score, pitchClass) => ({ pitchClass, score: score / maximum }));
}

export function identifyChord(pitchScores) {
  const active = pitchScores.filter(item => item.score >= 0.20).map(item => item.pitchClass);
  if (active.length < 2) return null;
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const [suffix, intervals] of CHORD_TYPES) {
      const expected = intervals.map(interval => (root + interval) % 12);
      const matched = expected.filter(note => active.includes(note)).length;
      const extras = active.filter(note => !expected.includes(note)).length;
      const coverage = matched / expected.length;
      const purity = matched / Math.max(1, matched + extras);
      const score = coverage * 0.68 + purity * 0.32;
      if (!best || score > best.score) best = { root, suffix, expected, active, matched, extras, score };
    }
  }
  return best && best.score >= 0.62 ? {
    ...best,
    name: NOTE_NAMES[best.root] + best.suffix,
    noteNames: best.active.map(note => NOTE_NAMES[note])
  } : null;
}

export { NOTE_NAMES };