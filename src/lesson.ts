import paperBox from './lesson.json';

export type Chapter = { start: number; title: string; caption?: string };
export type Lesson = {
  title: string;
  description: string;
  source: string;
  duration: number;
  chapters: Chapter[];
  poster?: string;
  captions?: string;
};

export const bundledLesson: Lesson = {
  title: 'Fold a paper box.',
  description: 'Make an open tray from a single square of paper.',
  source: 'lesson/paper-box.mp4',
  poster: 'lesson/poster.png',
  captions: 'lesson/paper-box.vtt',
  duration: 62,
  chapters: paperBox,
};

export function parseChapters(text: string, duration: number): Chapter[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The chapter file is not valid JSON.');
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 250)
    throw new Error('Use a JSON list of 1 to 250 chapters.');

  let previous = -1;
  return value.map((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null)
      throw new Error('Chapter ' + (index + 1) + ' must be an object.');
    const { start, title, caption } = entry as Record<string, unknown>;
    if (typeof start !== 'number' || !Number.isFinite(start) ||
        (index === 0 && start !== 0) || start <= previous || start >= duration)
      throw new Error('Start at 0, then put each chapter time in order before the end of the video.');
    if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
        (caption !== undefined && (typeof caption !== 'string' || caption.length > 2000)))
      throw new Error('Give each chapter a title of up to 120 characters and an optional caption of up to 2,000.');
    previous = start;
    return { start, title: title.trim(), caption: caption?.trim() };
  });
}

export async function readLocalLesson(file: File, chapterFile?: File): Promise<Lesson> {
  if (chapterFile && chapterFile.size > 256 * 1024)
    throw new Error('The chapter file must be 256 KB or less.');

  const source = URL.createObjectURL(file);
  const probe = document.createElement('video');
  probe.preload = 'metadata';
  let loaded = false;
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const events = new AbortController();
      const fail = () => reject(new Error('This video could not be opened. Try an MP4 or WebM file.'));
      const timeout = window.setTimeout(() => {
        events.abort();
        fail();
      }, 8000);
      const finish = () => {
        window.clearTimeout(timeout);
        events.abort();
      };
      probe.addEventListener('loadedmetadata', () => {
        finish();
        if (probe.videoWidth && Number.isFinite(probe.duration) && probe.duration > 0)
          resolve(probe.duration);
        else fail();
      }, { signal: events.signal });
      probe.addEventListener('error', () => { finish(); fail(); }, { signal: events.signal });
      probe.src = source;
    });
    const chapters = chapterFile
      ? parseChapters(await chapterFile.text(), duration)
      : [{ start: 0, title: 'Full video' }];
    const title = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 100) || 'Local lesson';
    loaded = true;
    return {
      title, source, duration, chapters,
      description: chapterFile ? '' : 'This video has one chapter, so Replay step returns to the beginning.',
    };
  } finally {
    probe.removeAttribute('src');
    probe.load();
    if (!loaded) URL.revokeObjectURL(source);
  }
}
