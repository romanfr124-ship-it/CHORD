import { findSpectralPeaks, buildPitchClassScores, identifyChord } from "./chord-engine.js";
import { getSuggestedShape, renderFretboard, renderTab } from "./guitar.js";

const $ = (id) => document.getElementById(id);
const listenButton = $("listenButton"), resetButton = $("resetButton");
const waveform = $("waveform"), statusDot = $("statusDot"), statusText = $("statusText");
const cameraPreview = $("cameraPreview");
for (let index=0; index<31; index++) waveform.append(document.createElement("span"));

const FFT_SIZE=16384;
const ONSET_RMS=0.012;
const SILENCE_RMS=0.005;
const CAPTURE_DURATION_MS=1250;
const SAMPLE_INTERVAL_MS=105;
const SILENCE_RESET_MS=850;

let audioContext=null, mediaStream=null, analyser=null, animationFrame=null;
let spectrumData=null, timeData=null, state="OFF";
let onsetFrames=0, silenceSince=0, captureStarted=0, lastSampleAt=0;
let capturedScores=[], videoRecorder=null, recordedChunks=[], recordingUrl=null;
let frameCaptureTimes=[];

function setStatus(text, live=true){
  statusText.textContent=text;
  statusDot.classList.toggle("is-live",live);
}
function rmsLevel(){
  analyser.getFloatTimeDomainData(timeData);
  let sum=0;
  for(const value of timeData) sum+=value*value;
  return Math.sqrt(sum/timeData.length);
}
function drawSpectrum(){
  analyser.getFloatFrequencyData(spectrumData);
  const bars=[...waveform.children], stride=Math.max(1,Math.floor(spectrumData.length/bars.length));
  bars.forEach((bar,index)=>{
    const db=spectrumData[index*stride];
    bar.style.height=Math.max(4,Math.min(52,(db+100)*0.9))+"px";
  });
}
function median(values){
  const sorted=[...values].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}
function updateNotes(notes){
  const list=$("noteList"); list.replaceChildren();
  notes.forEach(note=>{
    const chip=document.createElement("span");
    chip.className="note-chip active"; chip.textContent=note; list.append(chip);
  });
  $("noteCount").textContent=notes.length+(notes.length===1?" note":" notes");
}
function showChord(chord){
  $("chordName").textContent=chord.name;
  $("chordDescription").textContent="Identified from one captured chord";
  $("confidenceValue").textContent=chord.confidenceLabel;
  $("confidenceText").textContent="Audio match only. Visual fingering still needs confirmation.";
  updateNotes(chord.noteNames);
  const shape=getSuggestedShape(chord.name);
  renderFretboard($("fretboard"),shape);
  renderTab($("tabOutput"),shape);
}
function showUncertain(){
  $("chordName").textContent="—";
  $("chordDescription").textContent="Chord not identified confidently";
  $("confidenceValue").textContent="Uncertain";
  $("confidenceText").textContent="No guess displayed. Try a clean, single strum.";
  $("noteList").innerHTML='<span class="muted">Notes were ambiguous</span>';
  $("noteCount").textContent="—";
  $("fretboard").textContent="Waiting for a clearer chord.";
  $("fretboard").className="empty-state";
  $("tabOutput").textContent="No tab generated.";
}
function captureVideoFrame(label){
  if(!cameraPreview.videoWidth||!cameraPreview.videoHeight)return;
  const canvas=document.createElement("canvas");
  const maxWidth=480, scale=Math.min(1,maxWidth/cameraPreview.videoWidth);
  canvas.width=Math.round(cameraPreview.videoWidth*scale);
  canvas.height=Math.round(cameraPreview.videoHeight*scale);
  const context=canvas.getContext("2d");
  context.drawImage(cameraPreview,0,0,canvas.width,canvas.height);
  const image=document.createElement("img");
  image.src=canvas.toDataURL("image/jpeg",0.72);
  image.alt=label;
  image.title=label;
  const strip=$("frameStrip");
  if(strip.children.length>=6)strip.firstElementChild.remove();
  strip.append(image);
}
function startVideoRecording(stream){
  recordedChunks=[];
  $("recordingLink").hidden=true;
  $("recordingStatus").textContent="Recording audio and video together…";
  if(!window.MediaRecorder){
    $("recordingStatus").textContent="Live camera is on, but this browser cannot save a video recording.";
    return;
  }
  const candidates=["video/mp4;codecs=avc1.42E01E,mp4a.40.2","video/mp4","video/webm;codecs=vp8,opus","video/webm"];
  const mimeType=candidates.find(type=>MediaRecorder.isTypeSupported?.(type));
  try{
    videoRecorder=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
    videoRecorder.addEventListener("dataavailable",event=>{
      if(event.data&&event.data.size)recordedChunks.push(event.data);
    });
    videoRecorder.addEventListener("stop",()=>{
      if(!recordedChunks.length){
        $("recordingStatus").textContent="No video data was saved. Try another browser or shorter recording.";
        return;
      }
      const blob=new Blob(recordedChunks,{type:videoRecorder.mimeType||"video/webm"});
      if(recordingUrl)URL.revokeObjectURL(recordingUrl);
      recordingUrl=URL.createObjectURL(blob);
      const link=$("recordingLink");
      link.href=recordingUrl;
      link.download="chord-session."+(blob.type.includes("mp4")?"mp4":"webm");
      link.hidden=false;
      $("recordingStatus").textContent="Session recorded. Save the video to your device.";
    });
    videoRecorder.start(1000);
  }catch(error){
    videoRecorder=null;
    $("recordingStatus").textContent="Video recording could not start in this browser.";
    console.error("CHORD video recording error:",error);
  }
}
function analyseCapture(){
  if(capturedScores.length<5){showUncertain();return;}
  const combined=Array.from({length:12},(_,pitchClass)=>({
    pitchClass,
    score:median(capturedScores.map(frame=>frame[pitchClass].score))
  }));
  const chord=identifyChord(combined);
  if(chord) showChord(chord); else showUncertain();
  captureVideoFrame("Chord capture — final frame");
  state="LOCKED";
  setStatus("CHORD CAPTURED");
  $("helperText").textContent="One chord analysed. Let the sound stop completely to arm CHORD for the next chord.";
}
function processAudio(now){
  if(!analyser||!audioContext)return;
  drawSpectrum();
  const level=rmsLevel();

  if(state==="ARMED"){
    if(level>ONSET_RMS) onsetFrames++; else onsetFrames=0;
    if(onsetFrames>=2){
      state="CAPTURING";
      captureStarted=now;
      lastSampleAt=0;
      capturedScores=[];
      frameCaptureTimes=[];
      captureVideoFrame("Chord capture — start frame");
      $("chordName").textContent="…";
      $("chordDescription").textContent="Capturing one chord";
      $("confidenceValue").textContent="Analysing";
      $("confidenceText").textContent="Holding back the result until the capture is complete";
      setStatus("ANALYSING");
    }
  } else if(state==="CAPTURING"){
    if(now-lastSampleAt>=SAMPLE_INTERVAL_MS){
      const peaks=findSpectralPeaks(spectrumData,audioContext.sampleRate,analyser.fftSize);
      capturedScores.push(buildPitchClassScores(peaks));
      lastSampleAt=now;
    }
    if(now-captureStarted>=CAPTURE_DURATION_MS*0.55) {
      if(!frameCaptureTimes.includes("middle")){
        captureVideoFrame("Chord capture — middle frame");
        frameCaptureTimes.push("middle");
      }
    }
    if(now-captureStarted>=CAPTURE_DURATION_MS) analyseCapture();
  } else if(state==="LOCKED"){
    if(level<SILENCE_RMS){
      if(!silenceSince) silenceSince=now;
      if(now-silenceSince>=SILENCE_RESET_MS){
        state="ARMED"; silenceSince=0; onsetFrames=0;
        setStatus("READY FOR NEXT CHORD");
        $("helperText").textContent="Ready. Play one chord, let it ring, then let it go quiet before the next.";
      }
    } else silenceSince=0;
  }
  animationFrame=requestAnimationFrame(processAudio);
}
async function startListening(){
  if(!navigator.mediaDevices?.getUserMedia){
    $("helperText").textContent="Camera and microphone access need a modern browser and a secure HTTPS address.";
    return;
  }
  listenButton.disabled=true;
  try{
    mediaStream=await navigator.mediaDevices.getUserMedia({
      audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},
      video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}
    });
    cameraPreview.srcObject=mediaStream;
    await cameraPreview.play().catch(()=>{});
    $("cameraPlaceholder").hidden=true;
    $("cameraStatus").textContent="CAMERA LIVE";
    startVideoRecording(mediaStream);
    audioContext=new(window.AudioContext||window.webkitAudioContext)();
    await audioContext.resume();
    const source=audioContext.createMediaStreamSource(mediaStream);
    analyser=audioContext.createAnalyser();
    analyser.fftSize=FFT_SIZE;
    analyser.smoothingTimeConstant=0.25;
    source.connect(analyser);
    spectrumData=new Float32Array(analyser.frequencyBinCount);
    timeData=new Float32Array(analyser.fftSize);
    state="ARMED"; onsetFrames=0; silenceSince=0;
    waveform.classList.add("is-live");
    setStatus("READY FOR CHORD");
    listenButton.textContent="Stop listening";
    $("helperText").textContent="Frame your fretting hand and fretboard, then play one chord. Audio and video are captured together.";
    animationFrame=requestAnimationFrame(processAudio);
  }catch(error){
    if(mediaStream)mediaStream.getTracks().forEach(track=>track.stop());
    mediaStream=null;
    cameraPreview.srcObject=null;
    $("cameraPlaceholder").hidden=false;
    $("cameraStatus").textContent="CAMERA OFF";
    $("recordingStatus").textContent="Camera or microphone access failed. Check Safari permissions and try again.";
    $("helperText").textContent="CHORD needs both camera and microphone access. Allow both in Safari website settings.";
    console.error("CHORD media access error:",error);
  }finally{listenButton.disabled=false;}
}
async function stopListening(){
  if(animationFrame)cancelAnimationFrame(animationFrame);
  animationFrame=null;
  if(videoRecorder&&videoRecorder.state!=="inactive")videoRecorder.stop();
  if(mediaStream)mediaStream.getTracks().forEach(track=>track.stop());
  mediaStream=null;
  cameraPreview.pause();
  cameraPreview.srcObject=null;
  $("cameraPlaceholder").hidden=false;
  $("cameraStatus").textContent="CAMERA OFF";
  if(audioContext)await audioContext.close();
  audioContext=null; analyser=null; spectrumData=null; timeData=null; state="OFF";
  waveform.classList.remove("is-live");
  setStatus("MICROPHONE OFF",false);
  listenButton.textContent="Start listening";
  $("helperText").textContent="Camera and microphone stopped.";
}
function resetDisplay(){
  $("chordName").textContent="—";
  $("chordDescription").textContent="Play a chord and let it ring";
  $("confidenceValue").textContent="—";
  $("confidenceText").textContent="Waiting for a stable chord";
  $("noteList").innerHTML='<span class="muted">Waiting for audio…</span>';
  $("noteCount").textContent="0 notes";
  $("fretboard").textContent="A suggested guitar shape will appear here.";
  $("fretboard").className="empty-state";
  $("tabOutput").textContent="No chord detected yet.";
  $("frameStrip").replaceChildren();
  capturedScores=[]; onsetFrames=0; silenceSince=0;
  if(state!=="OFF") state="ARMED";
}
listenButton.addEventListener("click",()=>mediaStream?stopListening():startListening());
resetButton.addEventListener("click",resetDisplay);
window.addEventListener("pagehide",()=>{
  if(mediaStream)mediaStream.getTracks().forEach(track=>track.stop());
  if(recordingUrl)URL.revokeObjectURL(recordingUrl);
});
