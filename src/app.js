import { findSpectralPeaks, buildPitchClassScores, identifyChord } from "./chord-engine.js";
import { getSuggestedShape, renderFretboard, renderTab } from "./guitar.js";

const $ = (id) => document.getElementById(id);
const listenButton = $("listenButton"), resetButton = $("resetButton");
const waveform = $("waveform"), statusDot = $("statusDot"), statusText = $("statusText");
const cameraPreview = $("cameraPreview");
const handOverlay = $("handOverlay");
const handContext = handOverlay.getContext("2d");
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
let frameCaptureTimes=[], handLandmarker=null, handTrackingPromise=null, lastHandDetection=0, lastVideoTime=-1, handTrackingReady=false;
let calibrationMode=false, calibrationPoints=[], currentLandmarks=null;
const CALIBRATION_LABELS=["Nut — low E edge","12th fret — low E edge","Nut — high e edge","12th fret — high e edge"];
const FINGER_TIPS=[{index:8,name:"Index"},{index:12,name:"Middle"},{index:16,name:"Ring"},{index:20,name:"Pinky"}];

function setStatus(text, live=true){
  statusText.textContent=text;
  statusDot.classList.toggle("is-live",live);
}
async function initHandTracking(){
  if(handLandmarker){$("handStatus").textContent="HAND TRACKING READY";return;}
  if(handTrackingPromise){$("handStatus").textContent="LOADING HAND TRACKING MODEL";return handTrackingPromise;}
  $("handStatus").textContent="LOADING HAND TRACKING MODEL";
  handTrackingPromise=(async()=>{
    try{
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm");
      const fileset = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      const model = await vision.HandLandmarker.createFromOptions(fileset,{
        baseOptions:{
          modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate:"CPU"
        },
        runningMode:"VIDEO",
        numHands:1,
        minHandDetectionConfidence:0.55,
        minHandPresenceConfidence:0.55,
        minTrackingConfidence:0.5
      });
      handLandmarker=model;
      handTrackingReady=true;
      $("handStatus").textContent="HAND TRACKING READY";
    }catch(error){
      handTrackingReady=false;
      handTrackingPromise=null;
      $("handStatus").textContent="HAND TRACKING UNAVAILABLE";
      $("recordingStatus").textContent="Camera recording works, but the hand-tracking model could not load. Check your internet connection and reload.";
      console.error("CHORD hand tracking error:",error);
    }
  })();
  return handTrackingPromise;
}
function drawHandLandmarks(now){
  if(!handLandmarker||!cameraPreview.videoWidth||now-lastHandDetection<140)return;
  if(cameraPreview.currentTime===lastVideoTime)return;
  lastHandDetection=now;
  lastVideoTime=cameraPreview.currentTime;
  const width=cameraPreview.videoWidth,height=cameraPreview.videoHeight;
  if(handOverlay.width!==width||handOverlay.height!==height){
    handOverlay.width=width;handOverlay.height=height;
  }
  handContext.clearRect(0,0,width,height);
  let result;
  try{result=handLandmarker.detectForVideo(cameraPreview,now);}
  catch(error){console.warn("Hand landmark frame skipped:",error);return;}
  const landmarks=result.landmarks?.[0];
  if(!landmarks){
    $("handStatus").textContent="SHOW YOUR FRET HAND TO CAMERA";
    return;
  }
  currentLandmarks=landmarks;
  $("handStatus").textContent="HAND TRACKED · 21 LANDMARKS";
  if(calibrationPoints.length===4) drawFretEstimates(landmarks,width,height);
  const connections=[
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
  ];
  handContext.lineWidth=Math.max(3,width*0.004);
  handContext.strokeStyle="#b8f36b";
  handContext.lineCap="round";
  for(const [a,b] of connections){
    handContext.beginPath();
    handContext.moveTo(landmarks[a].x*width,landmarks[a].y*height);
    handContext.lineTo(landmarks[b].x*width,landmarks[b].y*height);
    handContext.stroke();
  }
  calibrationPoints.forEach((point,index)=>{
    handContext.beginPath();
    handContext.arc(point.x,point.y,Math.max(8,width*0.012),0,Math.PI*2);
    handContext.fillStyle="#b8f36b";
    handContext.fill();
    handContext.fillStyle="#10160a";
    handContext.font=`bold ${Math.max(12,width*0.018)}px sans-serif`;
    handContext.fillText(String(index+1),point.x+10,point.y-10);
  });
  landmarks.forEach((point,index)=>{
    const radius=index===4||index===8||index===12||index===16||index===20?Math.max(5,width*0.009):Math.max(3,width*0.005);
    handContext.beginPath();
    handContext.arc(point.x*width,point.y*height,radius,0,Math.PI*2);
    handContext.fillStyle="#f2f4f6";
    handContext.fill();
    handContext.strokeStyle="#10160a";
    handContext.lineWidth=2;
    handContext.stroke();
  });
}

function bilinearPoint(u,v,points){
  const [a,b,c,d]=points;
  return {
    x:a.x*(1-u)*(1-v)+b.x*u*(1-v)+c.x*(1-u)*v+d.x*u*v,
    y:a.y*(1-u)*(1-v)+b.y*u*(1-v)+c.y*(1-u)*v+d.y*u*v
  };
}
function mapPointToBoard(point,points){
  let u=0.5,v=0.5;
  for(let i=0;i<12;i++){
    const p=bilinearPoint(u,v,points);
    const du=bilinearPoint(u+0.001,v,points), dv=bilinearPoint(u,v+0.001,points);
    const ax=(du.x-p.x)/0.001, ay=(du.y-p.y)/0.001;
    const bx=(dv.x-p.x)/0.001, by=(dv.y-p.y)/0.001;
    const ex=point.x-p.x, ey=point.y-p.y, det=ax*by-ay*bx;
    if(Math.abs(det)<0.0001)break;
    const stepU=(ex*by-ey*bx)/det, stepV=(ax*ey-ay*ex)/det;
    u+=stepU;v+=stepV;
    if(Math.abs(stepU)+Math.abs(stepV)<0.0001)break;
  }
  return {u,v};
}
function drawFretEstimates(landmarks,width,height){
  const results=[];
  for(const finger of FINGER_TIPS){
    const point={x:landmarks[finger.index].x*width,y:landmarks[finger.index].y*height};
    const board=mapPointToBoard(point,calibrationPoints);
    if(board.u<0||board.u>1||board.v<0||board.v>1)continue;
    const stringPosition=board.v*5;
    const stringIndex=Math.round(stringPosition);
    if(Math.abs(stringPosition-stringIndex)>0.62)continue;
    const fretValue=-12*Math.log2(Math.max(0.0001,1-0.5*board.u));
    const fret=Math.max(0,Math.min(12,Math.round(fretValue)));
    if(fretValue<0.55)continue;
    results.push({finger,stringIndex,fret,point});
    handContext.beginPath();
    handContext.arc(point.x,point.y,Math.max(10,width*0.014),0,Math.PI*2);
    handContext.strokeStyle="#b8f36b";handContext.lineWidth=Math.max(3,width*0.004);handContext.stroke();
    handContext.fillStyle="#b8f36b";
    handContext.font=`bold ${Math.max(12,width*0.018)}px sans-serif`;
    handContext.fillText(`${finger.name}: ${["Low E","A","D","G","B","High e"][stringIndex]} / fret ${fret}`,point.x+12,point.y-12);
  }
  const unique=[...new Map(results.map(r=>[r.stringIndex,{stringIndex:r.stringIndex,fret:r.fret,finger:r.finger.name}])).values()];
  $("fretReadout").textContent=unique.length
    ? unique.map(r=>`${["Low E","A","D","G","B","High e"][r.stringIndex]}: fret ${r.fret} (${r.finger})`).join(" · ")
    : "No fingertip is confidently aligned with a calibrated string. Adjust the camera or calibration.";
}
function beginCalibration(){
  if(!mediaStream){$("calibrationStatus").textContent="Start the camera first.";return;}
  calibrationMode=true;calibrationPoints=[];
  handOverlay.classList.add("is-calibrating");
  $("calibrationStatus").textContent="Tap 1/4: the low-E edge of the nut (the end nearest the headstock).";
  $("calibrateButton").textContent="Cancel calibration";
}
function handleCalibrationTap(event){
  if(!calibrationMode||!cameraPreview.videoWidth)return;
  const rect=handOverlay.getBoundingClientRect();
  const shownX=(event.clientX-rect.left)/rect.width*handOverlay.width;
  const y=(event.clientY-rect.top)/rect.height*handOverlay.height;
  const x=handOverlay.width-shownX;
  calibrationPoints.push({x,y});
  if(calibrationPoints.length<4){
    $("calibrationStatus").textContent=`Tap ${calibrationPoints.length+1}/4: ${CALIBRATION_LABELS[calibrationPoints.length]}.`;
  }else{
    calibrationMode=false;handOverlay.classList.remove("is-calibrating");
    $("calibrationStatus").textContent="Fretboard calibrated to the 12th fret. Keep the same camera position.";
    $("calibrateButton").textContent="Recalibrate fretboard";
  }
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
  drawHandLandmarks(now);
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
      video:{facingMode:{exact:"user"},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}
    });
    cameraPreview.srcObject=mediaStream;
    await cameraPreview.play().catch(()=>{});
    $("cameraPlaceholder").hidden=true;
    $("cameraStatus").textContent="FRONT CAMERA LIVE";
    const activeVideoTrack=mediaStream.getVideoTracks()[0];
    if(activeVideoTrack) $("cameraStatus").textContent += activeVideoTrack.getSettings?.().facingMode==="user" ? "" : " · CHECK CAMERA";
    startVideoRecording(mediaStream);
    void initHandTracking();
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
    $("handStatus").textContent="HAND TRACKING NOT STARTED";
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
  handContext.clearRect(0,0,handOverlay.width,handOverlay.height);
  calibrationMode=false;handOverlay.classList.remove("is-calibrating");
  $("handStatus").textContent="HAND TRACKING STOPPED";
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
$("calibrateButton").addEventListener("click",()=>calibrationMode?(()=>{calibrationMode=false;handOverlay.classList.remove("is-calibrating");$("calibrateButton").textContent="Calibrate fretboard";$("calibrationStatus").textContent="Calibration cancelled.";})():beginCalibration());
handOverlay.addEventListener("pointerdown",handleCalibrationTap);
listenButton.addEventListener("click",()=>mediaStream?stopListening():startListening());
resetButton.addEventListener("click",resetDisplay);
window.addEventListener("pagehide",()=>{
  if(mediaStream)mediaStream.getTracks().forEach(track=>track.stop());
  if(recordingUrl)URL.revokeObjectURL(recordingUrl);
  if(handLandmarker){handLandmarker.close();handLandmarker=null;}
});
