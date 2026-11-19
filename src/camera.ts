import type { SmartSpectraSDK } from '@smartspectra/node-sdk/renderer';
import { faceFeatures } from './sensing';

export type Features = NonNullable<ReturnType<typeof faceFeatures>>;

export function createCamera() {
  let stream: MediaStream | undefined;
  let sdk: SmartSpectraSDK | undefined;
  let stopped = false;

  function stop() {
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
    sdk?.destroy();
    stream = undefined;
    sdk = undefined;
  }

  return {
    stop,
    async start(
      key: string,
      callbacks: {
        sample: (features: Features | null) => void;
        hint: (message: string) => void;
        failed: (message: string) => void;
      },
    ) {
      const [
        { SmartSpectraSDK, MetricType, ValidationCode },
        { decodeMetrics },
      ] = await Promise.all([
        import('@smartspectra/node-sdk/renderer'),
        import('@smartspectra/node-sdk/messages'),
      ]);
      if (stopped) return;
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
      });
      if (stopped) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      acquired.getVideoTracks()[0].addEventListener('ended', () => {
        if (!stopped)
          callbacks.failed(
            'Camera disconnected. Reconnect it or use manual playback.',
          );
      });
      const session = new SmartSpectraSDK({
        apiKey: key,
        requestedMetrics: [MetricType.FACE_LANDMARKS],
        enableTelemetry: false,
        sendTimeoutMs: 12000,
      });
      sdk = session;
      let blocked = false;
      let lastFrame: number | undefined;
      session.on('validationStatus', (code, _timestamp, hint) => {
        if (stopped) return;
        blocked =
          code !== ValidationCode.kOk &&
          code !== ValidationCode.kFaceNotForward &&
          code !== ValidationCode.kFaceTooLow &&
          code !== ValidationCode.kFaceTooHigh;
        callbacks.hint(blocked ? hint || 'Keep one face in view.' : '');
        if (blocked) callbacks.sample(null);
      });
      session.on('metrics', (buffer, timestamp) => {
        if (stopped || blocked) return;
        const landmarks = decodeMetrics(buffer).face?.landmarks?.at(-1);
        if (!landmarks?.value?.length) return;
        const frame = Number(landmarks.timestamp) || timestamp;
        if (frame === lastFrame) return;
        lastFrame = frame;
        callbacks.sample(
          landmarks.reset ? null : faceFeatures(landmarks.value),
        );
      });
      session.on('error', (code) => {
        if (!stopped)
          callbacks.failed(
            'SmartSpectra stopped (code ' +
              code +
              '). Check your key, credits, and camera.',
          );
      });
      session.useMediaStream(acquired);
      await session.start();
      if (!stopped) return acquired;
    },
  };
}
