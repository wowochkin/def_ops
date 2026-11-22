import './style.css';
import type { ReplayArchive } from '../../../packages/kshvi/src/replay/types';
import { recordedReplayAt } from './replay';
import { standaloneText, verifyStandaloneArchive, type StandaloneArchivePackage } from './integrity';

const fileInput = document.getElementById('archive-file') as HTMLInputElement;
const viewer = document.getElementById('viewer') as HTMLElement;
const slider = document.getElementById('replay-position') as HTMLInputElement;
const hash = document.getElementById('offline-hash') as HTMLElement;
const clock = document.getElementById('offline-clock') as HTMLElement;
const domains = document.getElementById('offline-domains') as HTMLElement;
const error = document.getElementById('error') as HTMLElement;
const status = document.getElementById('archive-status') as HTMLElement;
let replay: ReplayArchive | null = null;

function showFrame(): void {
  if (!replay) return;
  const cursor = Number(slider.value);
  const branchId = replay.branchId;
  const frame = recordedReplayAt(replay, cursor);
  hash.textContent = frame.hash ?? 'Несовместимое чтение — идентичность не заявляется';
  const point = replay.events.filter(event => event.branchId === branchId && event.sequence <= cursor).sort((left, right) => right.sequence - left.sequence)[0]
    ?? replay.snapshots.filter(snapshot => snapshot.branchId === branchId && snapshot.sequence <= cursor).sort((left, right) => right.sequence - left.sequence)[0];
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
  status.textContent = '';
  replay = null;
  viewer.hidden = true;
  try {
    const file = fileInput.files?.[0];
    if (!file) return;
    const packageData = JSON.parse(await file.text()) as StandaloneArchivePackage;
    const verification = verifyStandaloneArchive(packageData);
    if (verification.mode === 'REJECTED') {
      throw new Error(`Архив повреждён: ${[...verification.errors, ...verification.corrupted, ...verification.brokenReferences].join('; ')}`);
    }
    if (!verification.replayPath || !packageData.files[verification.replayPath]) throw new Error('Журнал реплея отсутствует');
    replay = JSON.parse(standaloneText(packageData.files[verification.replayPath])) as ReplayArchive;
    status.textContent = verification.autonomous
      ? 'Манифест и SHA-256 проверены. Автономное воспроизведение разрешено.'
      : `Ограниченное исследование: ${[...verification.missing, ...verification.limitations].join('; ')}`;
    slider.max = String(Math.max(0, ...replay.events.map(event => event.sequence)));
    slider.value = '0';
    viewer.hidden = false;
    showFrame();
  } catch (reason) {
    replay = null;
    viewer.hidden = true;
    error.textContent = reason instanceof Error ? reason.message : String(reason);
  }
});
slider.addEventListener('input', showFrame);
