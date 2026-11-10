import { findSpectralPeaks, buildPitchClassScores, identifyChord } from "./chord-engine.js";
import { getSuggestedShape, renderFretboard, renderTab } from "./guitar.js";

const $ = (id) => document.getElementById(id);
const listenButton = $("listenButton");
const resetButton = $("resetButton");
const waveform = $("waveform");
const statusDot = $("statusDot");
const statusText = $("statusText");

for (let index = 0; index <  thirtyOne(); index++) {
  const bar = document.createElement("span");
  waveform.append(bar);
}
function thirtyOne() { return 31; }

let audioContext = null;
let mediaStream = null;
let analyser = null;
let animationFrame = null;
let frequencyData = null;
let previousChord = "";
let stableFrames = 0;
let lastRenderAt = 0;

function drawWaveform() {
  if (!analyser || !frequencyData) return;
  analyser.getFloatFrequencyData(frequencyData);
  const bars = [...waveform.children];
  const stride = Math.max(1, Math.floor(frequencyData.length / bars.length));
  bars.forEach((bar, index) => {
    const db = frequencyData[index * stride];
    const height = Math.max(4, Math.min(52, (db + 100) * 0.9));
    bar.style.height = height + "px";
  });
}

function showNotes(notes) {
  const list = $("noteList");
  list.replaceChildren();
  notes.forEach((note) => {
    const chip = document.createElement("span");
    chip.className = "note-chip active";
    chip.textContent = note;
    list.append(chip);
  });
  $("noteCount").textContent = notes.length + (notes.length === 1 ? " note" : " notes");
}

function showChord(chord) {
  $("chordName").textContent = chord.name;
  $("chordDescription").textContent = "Detected notes: " + chord.noteNames.join(" · ");
  $("confidenceValue").textContent = Math.round(chord.score * 100) + "%";
  $("confidenceText").textContent = chord.extras
    ? "Possible extra tones — try letting the chord ring"
    : "Strongest template match (estimate)";
  showNotes(chord.noteNames);
  const shape = getSuggestedShape(chord.name);
  renderFretboard($("fretboard"), shape);
  renderTab($("tabOutput"), shape);
}

function processAudio() {
  if (!analyser || !audioContext) return;
  drawWaveform();
  const peaks = findSpectralPeaks(frequencyData, audioContext.sampleRate, analyser.fftSize);
  const scores = buildPitchClassScores(peaks);
  const chord = identifyChord(scores);
  const now = performance.now();

  if (chord) {
    if (chord.name === previousChord) stableFrames++;
    else {
      previousChord = chord.name;
      stableFrames = 0;
    }
    if (stableFrames >= 2 && now - lastRenderAt > 250) {
      showChord(chord);
      lastRenderAt = now;
    }
  } else if (now - lastRenderAt > 1800) {
    $("chordDescription").textContent = "Listening… play one clear chord";
  }
  animationFrame = requestAnimationFrame(processAudio);
}

async function startListening() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $("helperText").textContent = "Microphone capture is unavailable in this browser. Open the site using HTTPS in a current browser.";
    return;
  }
  listenButton.disabled = true;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(mediaStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    frequencyData = new Float32Array(analyser.frequencyBinCount);

    statusDot.classList.add("is-live");
    statusText.textContent = "LISTENING";
    waveform.classList.add("is-live");
    listenButton.textContent = "Stop listening";
    $("helperText").textContent = "Listening continuously. Play one chord at a time and let it ring.";
    processAudio();
  } catch (error) {
    $("helperText").textContent = "Could not access the microphone. Check Safari microphone permission and try again.";
    console.error("CHORD microphone error:", error);
  } finally {
    listenButton.disabled = false;
  }
}

async function stopListening() {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  if (audioContext) await audioContext.close();
  audioContext = null;
  analyser = null;
  frequencyData = null;
  statusDot.classList.remove("is-live");
  statusText.textContent = "MICROPHONE OFF";
  waveform.classList.remove("is-live");
  listenButton.textContent = "Start listening";
  listenButton.disabled = false;
}

function resetDisplay() {
  $("chordName").textContent = "—";
  $("chordDescription").textContent = "Play a chord and let it ring";
  $("confidenceValue").textContent = "—";
  $("confidenceText").textContent = "Waiting for a stable chord";
  $("noteList").innerHTML = '<span class="muted">Waiting for audio…</span>';
  $("noteCount").textContent = "0 notes";
  $("fretboard").textContent = "A suggested guitar shape will appear here.";
  $("fretboard").className = "empty-state";
  $("tabOutput").textContent = "No chord detected yet.";
  previousChord = "";
  stableFrames = 0;
}

listenButton.addEventListener("click", () => {
  if (mediaStream) stopListening();
  else startListening();
});
resetButton.addEventListener("click", resetDisplay);

window.addEventListener("pagehide", () => {
  if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
});