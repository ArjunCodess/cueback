'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@ui-sdk/react/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@ui-sdk/react/dialog';
import { Field, FieldDescription, FieldLabel } from '@ui-sdk/react/field';
import {
  PasswordInput,
  PasswordInputControl,
} from '@ui-sdk/react/password-input';
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@ui-sdk/react/slider';
import { Captions, Pause, Play, RotateCcw } from 'lucide-react';
import { createPlayer, formatTime } from '../player';
import steps from '../lesson.json';

type Player = ReturnType<typeof createPlayer>;

function CameraConsent({ player }: { player: Player }) {
  const [open, setOpen] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form).get('presage-key');
    if (typeof value !== 'string' || !value.trim()) return;
    form.reset();
    setOpen(false);
    void player.startCamera(value.trim());
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger id="enable" data-agent-confirm="Opens camera setup">
        Set up camera
      </DialogTrigger>
      <DialogContent id="consent" className="consent">
        <DialogTitle>Enable hands-free replay</DialogTitle>
        <DialogDescription>
          BenchReplay turns on your camera only after you confirm. SmartSpectra
          processes landmarks on this device. Presage checks your key and usage
          over the network. SDK telemetry is off.
        </DialogDescription>
        <form onSubmit={submit} data-agent-hidden>
          <Field>
            <FieldLabel>Presage API key</FieldLabel>
            <PasswordInput name="presage-key" required autoComplete="off">
              <PasswordInputControl spellCheck={false} />
            </PasswordInput>
            <FieldDescription>
              Use a key from physiology.presagetech.com. The app keeps it for
              this session only.
            </FieldDescription>
          </Field>
          <div className="dialog-actions">
            <DialogClose id="cancel">Cancel</DialogClose>
            <Button
              className="primary"
              type="submit"
              data-agent-confirm="Starts local camera tracking"
            >
              Turn on camera
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CameraPanel({
  player,
  state,
}: {
  player: Player;
  state: ReturnType<Player['getSnapshot']>;
}) {
  const { mode } = state;
  const modeLabel = {
    manual: 'Manual mode',
    demo: 'Simulation only',
    connecting: 'Connecting camera…',
    live: 'Live SmartSpectra',
  }[mode];
  return (
    <section className="camera" aria-labelledby="camera-title">
      <div className="camera-heading">
        <h2 id="camera-title">Hands-free replay</h2>
        <span className="mode" id="mode" data-kind={mode}>
          <span aria-hidden="true" />
          {modeLabel}
        </span>
      </div>
      {mode !== 'manual' && (
        <p className="camera-status">{state.cameraStatus}</p>
      )}
      <p id="camera-help" role="status">
        {state.hint}
      </p>
      {mode === 'live' && (
        <div className="camera-preview">
          <video
            ref={player.bindPreview}
            autoPlay
            muted
            playsInline
            aria-label="Local camera preview"
          />
          <div>
            <label className="gesture-label">
              Camera gesture
              <select
                id="gesture"
                value={state.gesture}
                onChange={(event) =>
                  player.setGesture(
                    event.currentTarget.value === 'blink' ? 'blink' : 'pose',
                  )
                }
              >
                <option value="pose">Look down</option>
                <option value="blink">Long blink</option>
              </select>
            </label>
            <Button
              id="calibrate"
              disabled={state.measuring}
              onClick={player.calibrate}
            >
              {state.calibration}
            </Button>
          </div>
        </div>
      )}
      <div className="camera-actions">
        {mode === 'manual' && <CameraConsent player={player} />}
        {(mode === 'connecting' || mode === 'live') && (
          <Button id="stop-camera" onClick={() => player.stopCamera()}>
            Turn off camera
          </Button>
        )}
        {(mode === 'manual' || mode === 'demo') && (
          <Button id="demo" className="text-button" onClick={player.toggleDemo}>
            {mode === 'demo' ? 'End simulation' : 'Try simulated input'}
          </Button>
        )}
      </div>
      {mode === 'demo' && (
        <div className="simulation-actions">
          <Button
            id="demo-input"
            onClick={() =>
              player.simulate(state.simulation === 'desk' ? 'screen' : 'desk')
            }
          >
            {state.simulation === 'desk'
              ? 'Simulate looking back'
              : 'Simulate looking down'}
          </Button>
          <Button id="demo-loss" onClick={() => player.simulate('unknown')}>
            Simulate signal loss
          </Button>
        </div>
      )}
    </section>
  );
}

function usePlayerRuntime(player: Player) {
  useEffect(() => {
    const timer = window.setInterval(player.tick, 50);
    function shortcuts(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        document.querySelector('[role="dialog"][data-open]')
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,select,textarea,[contenteditable]')
      )
        return;
      if (event.code === 'KeyR') player.manualReplay();
      if (
        event.code === 'Space' &&
        !(
          event.target instanceof Element &&
          event.target.closest('button,summary,a')
        )
      ) {
        event.preventDefault();
        player.toggle();
      }
    }
    document.addEventListener('keydown', shortcuts);
    window.addEventListener('pagehide', player.dispose);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('keydown', shortcuts);
      window.removeEventListener('pagehide', player.dispose);
      player.dispose();
    };
  }, [player]);

  useEffect(() => {
    if (!('modelContext' in document)) return;
    let cancelled = false;
    let unregister: (() => void) | undefined;
    void import('@ui-sdk/react/agent').then(
      ({ createAgent, registerTools }) => {
        if (!cancelled) {
          const agent = createAgent();
          unregister = registerTools(agent, {
            allow: (action) => !action.confirm,
          });
        }
      },
    );
    return () => {
      cancelled = true;
      unregister?.();
    };
  }, []);
}

export function LessonPlayer() {
  const [player] = useState(createPlayer);
  const [showCaptions, setShowCaptions] = useState(true);
  const state = useSyncExternalStore(
    player.subscribe,
    player.getSnapshot,
    player.getServerSnapshot,
  );
  const { step, position, duration, paused, counts } = state;

  usePlayerRuntime(player);

  const total = counts.manual + counts.demo + counts.live;
  const replaySummary = [
    counts.manual && counts.manual + ' manual',
    counts.demo && counts.demo + ' simulated',
    counts.live && counts.live + ' camera',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="workbench">
        <section className="player" aria-label="Tutorial player">
          <div className="video-stage">
            <video
              id="lesson"
              ref={player.bindVideo}
              preload="metadata"
              playsInline
              poster="/lesson/poster.png"
              src="/lesson/paper-box.mp4"
              onTimeUpdate={player.sync}
              onLoadedMetadata={player.sync}
              onPlay={player.sync}
              onPause={player.sync}
              onSeeked={player.sync}
              onEnded={player.sync}
              onError={player.mediaError}
            >
              <track
                kind="captions"
                src="/lesson/paper-box.vtt"
                srcLang="en"
                label="English"
              />
            </video>
            {paused && position === 0 && !state.note && (
              <Button
                id="overlay-play"
                className="overlay-play"
                aria-label="Play tutorial"
                onClick={player.toggle}
              >
                <Play aria-hidden="true" size={24} fill="currentColor" />
              </Button>
            )}
            <p
              className="video-note"
              id="video-note"
              role="status"
              hidden={!state.note}
            >
              {state.note}
            </p>
          </div>
          <div className="transport">
            <Slider id="seek" className="seek" aria-label="Playback position" min={0}
              max={duration} step={0.05} value={position} onValueChange={player.seek}>
              <SliderControl>
                <SliderTrack>
                  <SliderIndicator />
                  <SliderThumb aria-label="Playback position"
                    aria-valuetext={formatTime(position) + ' of ' + formatTime(duration)} />
                </SliderTrack>
              </SliderControl>
            </Slider>
            <div className="controls">
              <Button id="play" className="primary" onClick={player.toggle}>
                {paused ? (
                  <Play size={15} aria-hidden="true" />
                ) : (
                  <Pause size={15} aria-hidden="true" />
                )}
                {paused ? 'Play' : 'Pause'}
              </Button>
              <Button id="replay" onClick={player.manualReplay}>
                <RotateCcw size={15} aria-hidden="true" /> Replay step
              </Button>
              <span className="time" id="time">
                {formatTime(position)} / {formatTime(duration)}
              </span>
              <Button
                id="captions"
                className="cc"
                aria-label="Captions"
                aria-pressed={showCaptions}
                onClick={() => setShowCaptions((value) => !value)}
              >
                <Captions size={18} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <p className="caption" id="caption" hidden={!showCaptions}>
            {steps[step].caption}
          </p>
          <details className="transcript">
            <summary>Lesson transcript</summary>
            <ol>
              {steps.map((cue) => (
                <li key={cue.start}>
                  <strong>
                    {formatTime(cue.start)} {cue.title}
                  </strong>
                  {cue.caption}
                </li>
              ))}
            </ol>
          </details>
        </section>
        <aside className="sidebar" aria-label="Lesson controls">
          <CameraPanel player={player} state={state} />
          <section className="steps">
            <h2>
              Lesson steps{' '}
              <small>
                {step + 1} of {steps.length}
              </small>
            </h2>
            <ol>
              {steps.map((cue, index) => (
                <li key={cue.start}>
                  <Button
                    className="step"
                    aria-current={step === index ? 'step' : undefined}
                    onClick={() => player.seek(cue.start)}
                  >
                    <span aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{cue.title}</span>
                    <time dateTime={'PT' + cue.start + 'S'}>
                      {formatTime(cue.start)}
                    </time>
                  </Button>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      <footer>
        <span>
          <kbd>Space</kbd> Play or pause <kbd>R</kbd> Replay step
        </span>
        <span id="replay-count" hidden={!total}>
          {replaySummary} {total === 1 ? 'replay' : 'replays'}
        </span>
      </footer>
    </>
  );
}
