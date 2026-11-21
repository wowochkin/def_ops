import './style.css';
import type { ReplayArchive } from '../../../packages/kshvi/src/replay/types';
import { recordedReplayAt } from './replay';

const fileInput = document.getElementById('archive-file') as HTMLInputElement;
const viewer = document.getElementById('viewer') as HTMLElement;
const slider = document.getElementById('replay-position') as HTMLInputElement;
const hash = document.getElementById('offline-hash') as HTMLElement;
const clock = document.getElementById('offline-clock') as HTMLElement;
const domains = document.getElementById('offline-domains') as HTMLElement;
const error = document.getElementById('error') as HTMLElement;
let replay: ReplayArchive | null = null;

function decodeFile(base64: string): string {
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}
function showFrame(): void {
  if (!replay) return;
  const cursor = Number(slider.value);
  const frame = recordedReplayAt(replay, cursor);
  hash.textContent = frame.hash ?? 'Несовместимое чтение — идентичность не заявляется';
  const point = replay.events.filter(event => event.sequence <= cursor).sort((left, right) => right.sequence - left.sequence)[0]
    ?? replay.snapshots.filter(snapshot => snapshot.sequence <= cursor).sort((left, right) => right.sequence - left.sequence)[0];
  clock.textContent = `Оперативное время: ${point.operationalAt}; астрономическое время: ${point.wallClockAt}`;
  domains.replaceChildren();
  for (const [domain, value] of Object.entries(frame.state.domains)) {
    const article = document.createElement('article');
    const title = document.createElement('h3'); title.textContent = domain;
    const content = document.createElement('pre'); content.textContent = JSON.stringify(value);
    article.append(title, content); domains.append(article);
  }
}
fileInput.addEventListener('change', async () => {
  error.textContent = '';
  try {
    const file = fileInput.files?.[0];
    if (!file) return;
    const packageData = JSON.parse(await file.text()) as { files: Record<string, string> };
    replay = JSON.parse(decodeFile(packageData.files['replay/archive.json'])) as ReplayArchive;
    slider.max = String(Math.max(0, ...replay.events.map(event => event.sequence)));
    slider.value = '0';
    viewer.hidden = false;
    showFrame();
  } catch (reason) {
    viewer.hidden = true;
    error.textContent = reason instanceof Error ? reason.message : String(reason);
  }
});
slider.addEventListener('input', showFrame);
