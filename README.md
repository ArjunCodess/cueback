# BenchReplay

BenchReplay is a desktop tutorial player for tasks that occupy both hands. Look down to follow a step and the lesson pauses. Look back at the screen and it replays that step from the beginning, with the full instruction and caption intact.

The bundled lesson shows how to fold a paper box. Electron opens the player from local files and provides the native SmartSpectra bridge. The window uses plain HTML, CSS, and a small TypeScript renderer.

## Run locally

Use Node.js 22.12 or newer and pnpm 10.26.1.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Manual playback and the simulated input work without a key or webcam. Select **Try simulated input**, play the lesson, then simulate looking down and back. The status bar labels this mode **Simulation only**.


For live sensing, use Windows x64, a webcam, internet access, and a [Presage API key](https://physiology.presagetech.com/). The SDK also lists Apple Silicon macOS and Linux as supported platforms. The app's desktop checks were run on Windows.

Set `PRESAGE_API_KEY` in the local `.env` file beside `package.json`. Copy `.env.example` if the file is missing. Restart BenchReplay after changing it. Git ignores `.env`.

1. Select **Set up camera**, read the consent screen, and select **Turn on camera**. A key typed into the dialog overrides the configured key for that session.
2. Select **Calibrate** while facing the screen. Look down at your paper with your face still inside the preview, then select **Capture work pose**.
3. Play a step, tilt your head toward the paper, and return to the screen. If the work pose falls outside your camera's view, try **Long blink** and calibrate facing forward. A deliberate closure followed by reopening replays the current step.

Press **Space** to play or pause and **R** to replay. You can also seek, select any step, and toggle captions. An interrupted signal holds playback in look-down mode until you choose Play.

## How sensing works

Electron passes a camera-only stream to the SmartSpectra Node SDK and requests `FACE_LANDMARKS`. Two short calibration samples establish the screen and desk poses using the distance of the nose from the line between the outer eye corners, normalized by the width between them. A sustained desk pose pauses the player. A sustained screen pose seeks to the saved chapter boundary. A separate eye-opening ratio powers the optional long-blink gesture.

The player can tell whether your head moved toward the calibrated work pose. Eye direction, concentration, and whether you completed the fold are outside the app's measurement. Reposition the webcam or use manual controls if lighting, face visibility, or the angle makes sensing unreliable.

## Consent and data handling

The camera starts only after you select **Turn on camera**. The app requests video access only. It shows a preview while sensing and releases the tracks when you turn the camera off or close the window.

The app keeps frames and derived landmarks in memory for the active session. Turning the camera off clears the pose calibration and current sample. BenchReplay never saves camera media, landmarks, or keys entered in the dialog. A key you add to `.env` stays in that local file until you remove it. Presage uses network requests to authenticate the key and check usage. SDK telemetry is disabled with `enableTelemetry: false`. The app uses no analytics or AI insights service. [Presage SDK privacy details](https://smartspectra.presagetech.com/docs/telemetry-and-privacy)

## Checks and challenge demo

```sh
pnpm test
pnpm test:desktop
```

The tests cover pose calibration math, gesture timing, signal loss, manual override, and long blink behavior. The desktop smoke test opens the Electron app and checks consent, camera-only permission, keyboard controls, seeking, captions, and simulated chapter replay. Live landmark extraction requires a valid Presage key.

For the challenge recording, fold the same step once with manual playback and once in **Live SmartSpectra** mode. Count the player controls used after starting each take. Show the player pause during the fold and replay the whole step when you return. Then leave the camera frame long enough to show the tracking-loss recovery and turn the camera off. Start recording after entering the key. Lead with **Best Thoughtful Real-World Use** and list **Most Creative or Delightful Use** in the entry as well. [Challenge requirements](https://dev.to/challenges/presage-2026-11-04/)

The tutorial diagrams and synthetic narration are bundled. Regenerate them on Windows with `python -m pip install pillow imageio-ffmpeg numpy` and `python scripts/make-lesson.py`.
