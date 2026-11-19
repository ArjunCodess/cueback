# cueback

Look down to make a fold and the tutorial pauses. Look up and it plays that step from the beginning. A paper box lesson is included so you can try it right away.

On Windows x64, [download the release](https://github.com/ArjunCodess/cueback/releases/latest), extract the ZIP, and open `cueback.exe`.

To run from source with Node.js 22.12+ and pnpm 10.26.1:

```sh
pnpm install --frozen-lockfile
pnpm start
```

Manual playback and **Try simulation** work without a key. For live replay, use a webcam and enter your [Presage key](https://physiology.presagetech.com/) in **Set up camera**. When running from source, you can also set `PRESAGE_API_KEY` in `.env`. Choose **Look down** and capture both poses. If looking down takes your face out of frame, try **Long blink** for replay.

**Open lesson** takes a local MP4 or WebM and an optional chapter JSON file. Start at zero and list chapter times in seconds, in order. For example, `[{"start":0,"title":"Set up"},{"start":12,"title":"Make the fold","caption":"Press the crease flat."}]`. With no chapter file, replay starts at the beginning of the video.

Open **Replay check** to compare the same step in manual and camera modes. It counts playback inputs, automatic pauses and replays, and tracking interruptions. After the camera take, add any missed pauses or false triggers you observed.

The camera starts after you confirm. SmartSpectra processes landmarks on your device. Camera frames, landmarks, and check results stay in memory. Turning off the camera releases it and clears the landmark data. A key entered in the dialog lasts for that session. A key in `.env` stays on disk and is ignored by Git. SDK telemetry is off. Presage handles authentication, usage checks, and model delivery when needed. The optional Insights feature sends measurements and prompt text to Presage for AI processing. cueback leaves Insights off. [SDK privacy details](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)

## Camera terms

These terms govern cueback. Camera mode is for people aged 18 and older. You may not reverse engineer Presage's technology or use it for diagnosis or treatment. To the extent the law allows, Presage provides its technology as is, disclaims all warranties, and accepts no liability arising from its use in cueback. Send questions about the app to [cueback issues](https://github.com/ArjunCodess/cueback/issues).

Run `pnpm test` and `pnpm test:desktop`. Build the portable ZIP with `pnpm pack:win` on Windows x64. To rebuild the bundled lesson, install `pillow`, `imageio-ffmpeg`, and `numpy` with pip, then run `python scripts/make-lesson.py`.
