# QRacer original procedural audio

Original score and synthesis code, licensed under the repository MIT license.
There are no external samples, streaming services or paid audio generators.

- `apps/web/src/play/music.ts`: original four-bar A-minor score, bass and tempo.
- `apps/web/src/play/audio.ts`: continuous motor harmonics, filtered deterministic
  noise, brake/boost/impact/near/countdown cues, mix buses and compressor.
- `audio-settings.ts`: validated levels and an eight-voice priority budget.

Audio starts only from a play/resume gesture. Pause and visibility loss suspend
the context and cancel transient voices. Music/effects/master levels and mute
are independent. PC owns playback; controller feedback remains visual/haptic.
Automated analyser checks verify signal generation, not human listening quality
or physical speaker/browser compatibility.
