# CHORD

A dark, minimal guitar chord recognition web app. CHORD listens for one guitar chord, captures a short analysis window, and only displays a chord when the evidence passes conservative matching checks.

## Current prototype (0.9)

- Continuous microphone monitoring with a live input-level meter and logarithmic guitar-frequency waveform.
- Audio diagnostics showing strongest pitch classes, spectral peak count, capture-frame count and ranked chord candidates with rejection reasons.
- One chord capture at a time: audio onset starts a 1.25-second analysis window.
- Multiple spectral frames are combined before chord identification.
- Ambiguous or weak matches are rejected rather than displaying the nearest guess.
- After a result, CHORD locks and waits for silence before accepting another chord.
- Local browser audio analysis; no audio is uploaded or stored.
- Suggested common standard-tuning shapes and simple tablature for supported chords.
- Rear-camera video capture alongside audio, with an on-screen MediaPipe hand-landmark overlay (21 hand landmarks).
- Hand tracking runs in the browser; the model is loaded from a public CDN and Google-hosted model asset.

## Run on your iPhone

1. Open this repository in GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/(root)`, then save.
5. Wait for GitHub Pages to publish, then open the HTTPS address in Safari.
6. Tap **Start listening** and allow microphone access.
7. Play one clean chord, let it ring, and allow it to become quiet before playing the next chord.

## Project structure

```
CHORD/
├── index.html
├── README.md
└── src/
    ├── app.js
    ├── chord-engine.js
    ├── guitar.js
    └── styles.css
```

## Accuracy and limitations

No microphone-based chord recogniser can honestly promise 100% accuracy in every environment. Room noise, guitar tone, string buzz, distortion, overlapping harmonics, alternate tunings and unusual voicings can make different chords acoustically ambiguous. The current engine is a conservative first-pass spectral matcher, not a validated instrument-grade polyphonic pitch detector.

The displayed High/Moderate label describes the engine's internal match separation; it is not a calibrated probability. When the evidence is ambiguous, the app deliberately withholds a chord name. Hand landmarks track the visible hand but do not yet establish which string/fret each fingertip is pressing. The current fingering diagram remains a suggested common voicing, not a claim about the position actually played. Exact string/fret inference requires a calibrated view of the fretboard, reliable fret/string geometry, and validation against occlusion and camera angle. The app must not claim exact fingering from hand landmarks alone.

## Next engineering milestones

1. Use diagnostic captures from real guitars to identify microphone, peak-detection and harmonic-confusion problems.
2. Validate against a labelled test set of clean guitar recordings across strings, registers and playing styles.
3. Replace the first-pass spectral heuristic with a validated polyphonic pitch-estimation approach and temporal evidence scoring.
4. Calibrate rejection thresholds using measured false-positive and false-negative rates.
5. Improve fretboard contact estimation using the existing camera calibration and reject occluded or low-confidence positions.
6. Expand chord vocabulary and voicing coverage.
7. Add alternate tunings, capo support and progression recognition.