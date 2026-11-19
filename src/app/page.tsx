import { RotateCcw } from 'lucide-react';
import { LessonPlayer } from './lesson-player';

export default function Page() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to lesson
      </a>
      <header className="masthead">
        <div className="brand" translate="no">
          <span className="mark">
            <RotateCcw aria-hidden="true" size={20} />
          </span>{' '}
          BenchReplay
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="intro">
          <h1>Fold a paper box.</h1>
          <p>Make an open tray from a single square of paper.</p>
        </div>
        <LessonPlayer />
      </main>
    </>
  );
}
