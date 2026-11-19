# cueback

Look down to make a fold and the tutorial pauses. Look up and it plays that step from the beginning. A paper box lesson is included so you can try it right away.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Use Node.js 22.12+ and pnpm 10.26.1. Manual playback and **Try simulation** work without a key. For live replay, use a webcam and put your [Presage key](https://physiology.presagetech.com/) in `.env` as `PRESAGE_API_KEY`, or enter it in **Set up camera**. Choose **Look down** and capture both poses. If looking down takes your face out of frame, try **Long blink** for replay.

**Open lesson** takes a local MP4 or WebM and an optional chapter JSON file. Start at zero and list chapter times in seconds, in order. For example, `[{"start":0,"title":"Set up"},{"start":12,"title":"Make the fold","caption":"Press the crease flat."}]`. With no chapter file, replay starts at the beginning of the video.

Open **Replay check** to compare the same step in manual and camera modes. It counts playback inputs, automatic pauses and replays, and tracking interruptions. After the camera take, add any missed pauses or false triggers you observed.

The camera starts after you confirm. SmartSpectra processes landmarks on your device. Camera frames, landmarks, and check results stay in memory, and turning off the camera releases it and clears the landmark data. A key entered in the dialog lasts for that session. A key in `.env` stays on disk and is ignored by Git. SDK telemetry is off. Presage checks the key and usage online. [SDK privacy details](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)

Run `pnpm test` and `pnpm test:desktop`. To rebuild the bundled diagrams and narration on Windows, install `pillow`, `imageio-ffmpeg`, and `numpy` with pip, then run `python scripts/make-lesson.py`.
