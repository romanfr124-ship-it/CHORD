# CHORD

A dark, minimal guitar chord recognition web app. CHORD listens continuously through the device microphone, estimates the notes in a played chord, matches them against chord templates, and displays a suggested standard-tuning fingering and tab.

## Current prototype

- Continuous microphone capture while the page is open.
- Local browser audio analysis using FFT spectral peaks and harmonic-aware pitch-class scoring.
- First-pass matching for major, minor, seventh, suspended, diminished, augmented and selected extended chords.
- Detected pitch-class display and heuristic match-strength score.
- Suggested common chord shapes and a simple tab display for supported shapes.
- No audio is uploaded or stored.

## Run on your iPhone

1. Open this repository in GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/(root)`, then save.
5. Wait for GitHub Pages to publish, then open the published HTTPS address in Safari.
6. Tap **Start listening** and allow microphone access.

Microphone access requires a secure context (HTTPS) or localhost. If GitHub Pages is not enabled yet, you can also run the files using a local development server.

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

## Known limitations

This is an early proof of concept, not an instrument-grade recogniser. A guitar chord contains overlapping fundamentals and harmonics; this first-pass spectrum matcher can confuse them, especially with noisy strums, room noise, inversions, muted strings and extended voicings. The match-strength percentage is a heuristic score, not a statistically calibrated probability. A recording cannot reliably reveal the exact fretboard fingering, so CHORD shows a suggested common shape rather than claiming it is the one you played. Shapes are currently stored for a limited set of common chords.

## Next milestones

1. Test against real guitar chords and record false positives.
2. Improve polyphonic pitch estimation, noise-floor calibration and chord stability.
3. Expand chord vocabulary and the voicing database.
4. Improve fretboard diagrams and tab generation.
5. Add alternate tunings, capo support and chord progression recognition.