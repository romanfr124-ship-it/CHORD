// Conservative chord recognition for a single captured guitar strum.
// Scores are evidence rankings, never a guarantee or calibrated probability.
const NOTE_NAMES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];
const CHORD_TYPES = [
  ["",[0,4,7]], ["m",[0,3,7]], ["dim",[0,3,6]], ["aug",[0,4,8]],
  ["sus2",[0,2,7]], ["sus4",[0,5,7]], ["7",[0,4,7,10]],
  ["maj7",[0,4,7,11]], ["m7",[0,3,7,10]], ["mMaj7",[0,3,7,11]],
  ["m7♭5",[0,3,6,10]], ["dim7",[0,3,6,9]], ["6",[0,4,7,9]],
  ["m6",[0,3,7,9]], ["add9",[0,2,4,7]], ["9",[0,2,4,7,10]],
  ["maj9",[0,2,4,7,11]], ["m9",[0,2,3,7,10]]
];
export function frequencyToMidi(frequency) { return 69 + 12 * Math.log2(frequency / 440); }
export function findSpectralPeaks(spectrum, sampleRate, fftSize) {
  const peaks = [], lowBin = Math.max(2, Math.floor(65 * fftSize / sampleRate));
  const highBin = Math.min(spectrum.length - 2, Math.ceil(1500 * fftSize / sampleRate));
  for (let bin = lowBin; bin <= highBin; bin++) {
    const left=spectrum[bin-1], centre=spectrum[bin], right=spectrum[bin+1];
    if (centre <= left || centre < right || centre < -84) continue;
    const denominator=left-2*centre+right, offset=denominator?0.5*(left-right)/denominator:0;
    const frequency=(bin+offset)*sampleRate/fftSize;
    if (frequency>0) peaks.push({frequency,db:centre,midi:frequencyToMidi(frequency)});
  }
  return peaks.sort((a,b)=>b.db-a.db).slice(0,64);
}
export function buildPitchClassScores(peaks) {
  const energy=Array(12).fill(0);
  for (const peak of peaks) {
    const strength=Math.pow(10,peak.db/20), midi=Math.round(peak.midi);
    // Keep some energy at the measured pitch, but favour notes supported by
    // plausible lower fundamentals so strong overtones do not dominate.
    energy[((midi%12)+12)%12]+=strength*0.65;
    for(let harmonic=2;harmonic<=5;harmonic++){
      const fundamental=peak.frequency/harmonic;
      if(fundamental<65) continue;
      const inferred=Math.round(frequencyToMidi(fundamental));
      energy[((inferred%12)+12)%12]+=strength/(harmonic*2.8);
    }
  }
  const maximum=Math.max(...energy,0.000001);
  return energy.map((value,pitchClass)=>({pitchClass,score:value/maximum}));
}
export function identifyChord(pitchScores) {
  const values=Array(12).fill(0);
  for(const item of pitchScores) values[item.pitchClass]=item.score;
  const active=pitchScores.filter(item=>item.score>=0.20).map(item=>item.pitchClass);
  if(active.length<3||active.length>6) return null;
  const ranked=[];
  for(let root=0;root<12;root++) for(const [suffix,intervals] of CHORD_TYPES){
    const expected=intervals.map(interval=>(root+interval)%12);
    const target=expected.map(note=>values[note]);
    const averageSupport=target.reduce((sum,value)=>sum+value,0)/target.length;
    const weakestTone=Math.min(...target);
    const extras=active.filter(note=>!expected.includes(note));
    const strongestExtra=extras.length?Math.max(...extras.map(note=>values[note])):0;
    const missingTones=target.filter(value=>value<0.23).length;
    const score=averageSupport*0.68+weakestTone*0.32-strongestExtra*0.38-missingTones*0.10;
    ranked.push({root,suffix,expected,active,score,averageSupport,weakestTone,strongestExtra,missingTones});
  }
  ranked.sort((a,b)=>b.score-a.score);
  const best=ranked[0], margin=best.score-ranked[1].score;
  if(best.averageSupport<0.40||best.weakestTone<0.18||best.strongestExtra>0.75||best.missingTones>0||margin<0.065) return null;
  return {...best,margin,name:NOTE_NAMES[best.root]+best.suffix,
    noteNames:active.map(note=>NOTE_NAMES[note]),
    confidenceLabel:margin>=0.16&&best.averageSupport>=0.68?"High":"Moderate"};
}
export { NOTE_NAMES };