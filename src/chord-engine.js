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
  const direct=Array(12).fill(0);
  const inferred=Array(12).fill(0);
  const measuredMidis=peaks.map(peak=>peak.midi);
  for (const peak of peaks) {
    const strength=Math.pow(10,peak.db/20);
    const nearestMidi=Math.round(peak.midi);
    const cents=Math.abs(peak.midi-nearestMidi)*100;
    const tuningWeight=Math.max(0.35,1-cents/100);
    const pitchClass=((nearestMidi%12)+12)%12;
    // Directly measured partials are the strongest evidence. A small
    // tuning tolerance prevents noisy FFT bins from being treated equally.
    direct[pitchClass]+=strength*tuningWeight;
    // A third harmonic can reveal a quiet/missing fundamental, but only
    // add it when no measured peak already supports that lower note.
    const possibleFundamental=peak.midi-19.02;
    if(possibleFundamental>=28) {
      const hasFundamental=measuredMidis.some(midi=>Math.abs(midi-possibleFundamental)<0.45);
      if(!hasFundamental) {
        const inferredMidi=Math.round(possibleFundamental);
        const inferredClass=((inferredMidi%12)+12)%12;
        inferred[inferredClass]+=strength*0.075;
      }
    }
  }
  const energy=direct.map((value,index)=>value+Math.min(inferred[index],value*0.22));
  const maximum=Math.max(...energy,0.000001);
  return energy.map((value,pitchClass)=>({
    pitchClass,score:value/maximum,direct:direct[pitchClass]/maximum
  }));
}
export function rankChordCandidates(pitchScores) {
  const values=Array(12).fill(0);
  for(const item of pitchScores) values[item.pitchClass]=item.score;
  const ranked=[];
  for(let root=0;root<12;root++) for(const [suffix,intervals] of CHORD_TYPES){
    const expected=intervals.map(interval=>(root+interval)%12);
    const rootSupport=values[root];
    const toneSupport=expected.map(note=>values[note]);
    const sortedSupport=[...toneSupport].sort((a,b)=>b-a);
    const strongest=sortedSupport[0]||0, second=sortedSupport[1]||0, third=sortedSupport[2]||0;
    const averageSupport=toneSupport.reduce((sum,value)=>sum+value,0)/toneSupport.length;
    const hits=toneSupport.filter(value=>value>=0.19).length;
    const extras=values.filter((value,note)=>!expected.includes(note)&&value>=0.18);
    const extraEnergy=extras.reduce((sum,value)=>sum+value,0);
    const missingTones=toneSupport.filter(value=>value<0.19).length;
    // Keep root identity explicit: sorting all chord tones previously meant
    // a candidate could score well even when its proposed root was absent.
    const score=averageSupport*0.34+rootSupport*0.30
      +second*0.22+third*0.14-extraEnergy*0.11
      -missingTones*0.035;
    ranked.push({root,suffix,expected,score,averageSupport,rootSupport,
      strongest,second,third,hits,extraEnergy,missingTones});
  }
  ranked.sort((a,b)=>b.score-a.score);
  return ranked.map((candidate,index)=>({
    ...candidate,
    name:NOTE_NAMES[candidate.root]+candidate.suffix,
    margin:index===0?candidate.score-(ranked[1]?.score||0):undefined
  }));
}
export function identifyChord(pitchScores) {
  const ranked=rankChordCandidates(pitchScores);
  const best=ranked[0], margin=best?.margin??0;
  if(!best||best.strongest<0.30||best.second<0.22||best.hits<2||best.score<0.25) return null;
  const values=Array(12).fill(0);
  for(const item of pitchScores) values[item.pitchClass]=item.score;
  const detected=best.expected.filter(note=>values[note]>=0.14).map(note=>NOTE_NAMES[note]);
  const confidenceLabel=margin>=0.09&&best.third>=0.20?"High"
    :margin>=0.035?"Moderate":"Low";
  return {...best,margin,noteNames:detected,confidenceLabel};
}
export { NOTE_NAMES };