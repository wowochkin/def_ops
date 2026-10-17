# Голосовое ядро (ступень 1) — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** голосовой сервис запускается вместе с приложением, в окне — панель голоса с калибровкой и голосами, и
обращением «Штаб, открой …» можно переходить между разделами.

**Architecture:** `services/voice` (Python) — только звук: VAD, конец реплики, распознавание, синтез двумя ролями,
калибровка, образцы голосов; протокол WebSocket на порту 47645. Окно (`apps/editor/src/voice/`) — микрофон,
воспроизведение, панель, реестр действий и разборщик реплик (на этой ступени — только правила, без модели).
`launch.mjs` запускает сервис, шлюз отдаёт его состояние.

**Tech Stack:** Python 3.12, FastAPI + uvicorn, mlx-audio 0.5.9 (Qwen3-TTS, Smart Turn), silero-vad, GigaAM v3 e2e,
pytest; TypeScript, React, vitest; Node (`launch.mjs`); Playwright (сквозная проверка).

**Spec:** `docs/superpowers/specs/2026-10-17-voice-control-design.md` (ступень 1 из раздела 8; ступени 2–3 —
отдельными планами после проверки этой на Mac).

## Global Constraints

- Язык интерфейса, текстов, сообщений и коммитов — русский; коммиты с двумя строками атрибуции сессии.
- Перед каждым коммитом — `npm run typecheck` и `npm test`; для Python — `npm run test:voice`.
- Порт голосового сервиса — 47645; данные — `<папка данных приложения>/voice/`.
- Окружение: `services/voice/.venv`, Python 3.12, `mlx-audio[all]==0.5.9`; стек MLX — только Apple Silicon.
- Перенос со стенда без изменения найденных значений: пауза до ответа от 20 мс, переспрос Smart Turn каждые 96 мс,
  `--max-silence-ms 1500`, `--turn 0.5`; первая фраза сразу, короче 30 знаков — со следующей (ждать ≤ 0,4 с),
  дальше — при запасе звука < 1 с или 300 знаков; договаривание 1 кадра; затухание 10 мс; паузы
  `{".":0.2,"…":0.25,"!":0.3,"?":0.3,",":0.1,";":0.15,":":0.15}`; образец по умолчанию — 10 с.
- Склейка реплики: новая речь не позже 2 с после конца прежней и ответ не звучит или звучит < 1,5 с.
- Окно разговора без обращения — 12 с после ответа штаба.
- Роли: `chief` — «начальник штаба», `umpire` — «посредник»; по умолчанию обе — образец `zhukov-10s`.
- Запись нового голоса: текст на 15–20 с, длина записи 8–30 с, после обрезки тишины — 0,4 с паузы в конце,
  доля ошибок по словам ≤ 15 %.
- Пользователи — люди старшего возраста и эксперты (спецификация, «Кто пользуется»): панель голоса — шрифт ≥ 18 px,
  высокая контрастность, состояние простыми словами, без технических слов; регуляторы — в свёрнутой «Тонкой
  настройке»; постоянная подсказка «Не знаете, что сказать? Скажите: Штаб, что я могу?»; непонятая команда —
  переспрос своими словами с 2–3 вариантами; чего нет — «Этого система не предусматривает», без выдумки.
- В `docs/system.md` нет дат и упоминаний ассистента; снимки — Playwright 1440×900 JPEG с подписью курсивом.

## Review Focus

- Сервис ещё грузится (20–40 с) или не установлен, а человек уже говорит — панель честно показывает состояние,
  окно не падает, реплики не теряются молча (Task 4, тест `voiceStatus`).
- Связь с сервисом оборвалась посреди разговора (сервис перезапущен) — окно переподключается само, звук
  останавливается, состояние «переподключаюсь» (Task 4, тест `voiceStatus`: `reconnecting`).
- Сервис уже запущен вручную на 47645 — `launch.mjs` подключается, второй не запускает (Task 3, тест `voicePlan`).
- Обращение распознано с огрехом («штап», «Штаб.», «товарищ генерал,») и ложное обращение в середине фразы
  («передайте в штаб армии») — исполняется только обращение в начале (Task 5, тесты обращения).
- Новый голос записан в тишине или в шуме, или прочитан не тот текст — понятная причина, ничего не сохраняется
  (Task 2, тесты `check_recording`).

---

### Task 1: Сервис голоса — каркас, перенос чистой логики со стенда

**Files:**
- Create: `services/voice/package.json` (`@def-ops/voice`, private; `"test": "sh tests/run.sh"`)
- Create: `services/voice/setup.sh`, `services/voice/README.md`, `services/voice/.gitignore` (`.venv/`)
- Create: `services/voice/audio.py`, `services/voice/tts.py`, `services/voice/tts_tail.py` (перенос `scripts/voice-bench/tts_tail.py`)
- Create: `services/voice/tests/run.sh`, `services/voice/tests/test_audio.py`, `services/voice/tests/test_tts.py`
- Modify: `package.json` (корень: `"test:voice": "npm run test -w @def-ops/voice"`)

**Interfaces:**
- Produces (`audio.py`):
  - `calibrate(d: dict[str, list[float]], end_ms: int) -> tuple[dict, dict]` — перенос со стенда без изменений.
  - `class Listener(cfg: dict, vad: Callable[[np.ndarray], Awaitable[float]], turn: Callable[[np.ndarray], Awaitable[float]], *, max_silence_ms=1500, turn_threshold=0.5, min_speech_ms=200)`;
    `async feed(frame: np.ndarray, busy: bool) -> list[tuple]` — события `("level", p)`, `("speech_start",)`,
    `("speech_end",)`, `("barge",)`, `("utterance", audio: np.ndarray, turn_prob: float | None)`;
    `reset()`. Логика — `Session.on_frame`/`end_turn` стенда (пороги `vad`/`barge_vad`, `barge_ms`, `end_ms`,
    переспрос каждые `TURN_RECHECK_MS = 96`), без сети и моделей.
  - `should_merge(prev_end: float, speech_start: float, reply_audio_start: float | None) -> bool` — `MERGE_GAP_S = 2.0`,
    `MERGE_PLAYED_S = 1.5`.
- Produces (`tts.py`):
  - `class Sentences` — перенос со стенда (`push`, `rest`).
  - `class PiecePlanner` — `push(sentence: str)`, `finish()`, `next_piece(now: float, play_until: float) -> str | None`
    (правила первой/короткой фразы, запаса звука и 300 знаков; `SHORT_CHARS=30`, `SHORT_WAIT_S=0.4`,
    `PIECE_LEAD_S=1.0`, `PIECE_MAX_CHARS=300`), `done -> bool`.
  - `pause_after(text: str) -> float`, `fade_tail(a: np.ndarray, sr: int, ms: int) -> np.ndarray`.
- Produces (`tts_tail.py`): `extend_eos(tts, frames: int) -> Callable[[], None]` (как в стенде).

- [ ] **Step 1: Тесты**

```python
# test_audio.py
def test_calibrate_normal_room(): ...   # синтетика из стенда: .3<vad<.6, .43<barge<.65, warn == []
def test_calibrate_loud_echo_warns_headphones(): ...  # any("наушники" in w)
def test_calibrate_no_speech_raises(): ...  # pytest.raises(ValueError)
def test_listener_utterance_after_pause():
    # речь 0,6 с (p=0.9) → тишина; turn: 0.2, 0.2, 0.9 → ровно одно ("utterance", …, 0.9),
    # и переспросы через 96 мс (3 кадра): turn вызван 3 раза
def test_listener_max_silence_ends_without_turn():  # turn всегда 0.1 → utterance с prob None после 1500 мс тишины
def test_listener_barge_only_when_busy():  # busy=True, речь ≥ barge_ms при p ≥ barge_vad → ("barge",) один раз
def test_should_merge():
    assert should_merge(10.0, 11.5, None) and should_merge(10.0, 11.5, 10.5)
    assert not should_merge(10.0, 12.5, None) and not should_merge(10.0, 11.9, 10.2)
# test_tts.py
def test_planner_first_short_waits_for_next():  # push("Принято.") → next_piece(t0, 0) is None; push("Двигаемся к фронту.") → "Принято. Двигаемся к фронту."
def test_planner_first_short_alone_after_wait():  # push("Есть."); next_piece(t0+0.41, 0) == "Есть."
def test_planner_groups_rest_by_lead():  # после первой: при play_until-now > 1.0 → None; < 1.0 → все накопленные одной строкой
def test_planner_max_chars(): ...  # ≥ 300 знаков → отдаёт, не дожидаясь запаса
def test_pause_after():  assert pause_after("Да?") == 0.3 and pause_after("Так,") == 0.1 and pause_after("Есть»") == 0.2
def test_fade_tail_only_last_ms(): ...  # первые отсчёты не тронуты, последний ≈ 0
def test_extend_eos_one_frame(): ...  # как проверка в стенде: [3, 7] при frames=1
```

- [ ] **Step 2: `npm run test:voice` — FAIL (модулей нет)**
- [ ] **Step 3: Реализация** — `tests/run.sh`: питон `services/voice/.venv/bin/python`, иначе `$VOICE_PYTHON`, иначе
  выход 0 с сообщением «окружение голоса не установлено — тесты пропущены». `setup.sh` — как
  `scripts/voice-bench/setup.sh` шаги 1–2b в `.venv` + `fastapi uvicorn pytest`. Импорты MLX/torch — только внутри
  загрузчиков (Task 2), чтобы чистая логика тестировалась без них.
- [ ] **Step 4: `npm run test:voice` — PASS**
- [ ] **Step 5: Коммит** «Голос: сервис — каркас и логика стенда (слушатель, калибровка, куски синтеза)»

### Task 2: Сервис голоса — модели, голоса, протокол, режим `--fake`

**Files:**
- Create: `services/voice/models.py` (загрузка Silero, Smart Turn, GigaAM v3_e2e_rnnt, Qwen3-TTS; MLX — в одной нити)
- Create: `services/voice/voices.py`, `services/voice/fake.py`, `services/voice/server.py`
- Create: `services/voice/tests/test_voices.py`, `services/voice/tests/test_server.py`
- Modify: `scripts/voice-bench/talk_server.py` (импортирует `Sentences`, `calibrate`, `extend_eos` из `services/voice`)

**Interfaces:**
- Consumes: Task 1 целиком.
- Produces (`voices.py`):
  - `class VoiceStore(root: Path, seed_dir: Path | None)`: `list() -> list[dict]` (`id, name, text, source, builtin`),
    `roles() -> dict[str, str]` (`{"chief": id, "umpire": id}`), `assign(role: str, voice_id: str)`,
    `save(name: str, audio: np.ndarray, sr: int, text: str, source: str) -> str`, `delete(voice_id: str)`
    (встроенный — `ValueError`; назначенный роли — роль возвращается к `zhukov-10s`), `ref(voice_id) -> tuple[Path, str]`.
    Посев: из `seed_dir/refs.json` копируются существующие образцы (`builtin: true`).
  - `check_recording(audio: np.ndarray, sr: int, expected: str, heard: str) -> dict` — `{ok, reasons: list[str],
    audio: np.ndarray}`: обрезка тишины по краям, 0,4 с паузы в конце; пик ≥ −30 дБFS; сигнал/шум ≥ 15 дБ;
    длина 8–30 с; WER (нижний регистр, ё→е, без знаков) ≤ 0,15.
  - `RECORD_TEXT: str` — текст для чтения на 15–20 с (штабной доклад без цифр).
- Produces (`fake.py`): `class FakeModels` — тот же интерфейс, что `models.Models`: `vad_prob`, `vad_reset`,
  `turn_complete`, `transcribe` (по очереди из `--fake-script` файла строк, иначе «штаб, открой переигровку»),
  `tts_stream(text, ref) -> Iterator[np.ndarray]` (синус, ~15 знаков/с), `sample_rate = 24000`.
- Produces (`server.py`): `python server.py --port 47645 --data DIR [--seed-refs DIR] [--fake] [--fake-script FILE]
  [--vad 0.5 --barge-vad 0.8 --barge-ms 300 --end-ms 400]`; `GET /health -> {"state": "loading"|"ready"|"error", "error"?}`;
  `WS /ws` — протокол раздела 2 спецификации (`hello`, `say {id, role, text, more?}`, `stop`, `played`, `settings`,
  `calib`, `voice {op}` / `ready`, `level`, `speech`, `utterance {id, text, audio_s, stt_ms, continues?}`, звук
  `[0x01][id u32 LE][rate u32 LE][pcm int16]`, `say-done`, `barge`, `calib_step`, `calib_result`, `voice_*`, `error`).
  Пока идёт запись голоса (`record-start`…`record-stop`), кадры копятся в запись, разговор стоит.

- [ ] **Step 1: Тесты**

```python
# test_voices.py
def test_seed_and_default_roles(tmp_path): ...  # после посева roles() == {"chief": "zhukov-10s", "umpire": "zhukov-10s"}
def test_save_assign_delete(tmp_path): ...  # save → в list(); assign("chief", id); delete(id) → roles()["chief"] == "zhukov-10s"
def test_delete_builtin_refused(tmp_path): ...
def test_check_recording_silence():  # тишина → ok False, reasons содержит «тихо»
def test_check_recording_noise():  # речь + шум на −10 дБ → «шум»
def test_check_recording_wrong_text():  # heard далеко от expected → «текст»
def test_check_recording_ok_trims_and_keeps_pause():  # 1 с тишины + речь 12 с + 2 с тишины → длина ≈ 12.4 с, ok True
# test_server.py (FastAPI TestClient, --fake)
def test_health_ready(): ...
def test_ws_utterance_from_speech():  # кадры «речь» (громкий синус) 0,6 с + тишина 2 с → JSON utterance с текстом из fake-script
def test_ws_merge_continues():  # две речи с паузой 1 с, вторая до ответа → вторая utterance с continues == id первой и текстом обеих
def test_ws_say_audio_and_done():  # say {id:7, role:"chief", text:"Есть."} → двоичные кадры с id 7, затем say-done {id:7} после played
def test_ws_record_voice_flow():  # record-start, кадры, record-stop → voice_check {ok, reasons}; save → voice_list с новым id
```

- [ ] **Step 2: `npm run test:voice` — FAIL**
- [ ] **Step 3: Реализация** — сессия из стенда (`Session`) переписывается на `Listener` + `PiecePlanner`;
  языковой модели в сервисе нет; `say` с `more: true` дописывает текст той же фразы (нарезка `Sentences`);
  перебивание и склейка — по событиям `Listener` и `should_merge`. `--fake` подставляет `FakeModels`, без MLX/torch.
- [ ] **Step 4: `npm run test:voice` — PASS; стенд `talk_server.py --help` запускается**
- [ ] **Step 5: Коммит** «Голос: сервис — модели, голоса, протокол, поддельные модели для проверок»

### Task 3: Запуск вместе с приложением и состояние в шлюзе

**Files:**
- Create: `apps/desktop/server/voice.mjs`, `apps/desktop/tests/voice-launch.test.ts`
- Modify: `apps/desktop/server/launch.mjs` (после остальных сервисов; необязательный), `services/gateway/src/gateway.ts`
  (`/api/voice` до проверки ключа), `services/gateway/src/main.ts` (`VOICE_STATE`), `services/gateway/tests/platform.test.ts`

**Interfaces:**
- Produces (`voice.mjs`):
  - `voicePlan({ python: boolean, portAnswers: boolean }) -> 'attach' | 'spawn' | 'off'` (отвечает — `attach`;
    иначе есть `.venv/bin/python` — `spawn`; иначе `off`).
  - `startVoice({ repo, data, voiceDir, log }) -> Promise<void>` — пишет `<data>/voice/state.json`
    `{ state: 'off'|'loading'|'ready'|'error', port: 47645, error? }`, опрашивает `GET /health` раз в секунду до
    `ready` (не дольше 5 мин); выход процесса — состояние `loading` с `error: «голос остановился, перезапускаю»`
    и перезапуск через 5 с, не больше 3 раз подряд, потом `error` с кодом; приложение не останавливается.
    (Спецификация, раздел 6: «панель предлагает перезапустить» — заменено автоматическим перезапуском: процесс
    принадлежит launch.mjs, окну перезапускать нечем.)
  - Папка сервиса: `--voice-dir`, `DEFOPS_VOICE_DIR`, иначе `<repo>/services/voice`; запуск
    `<voiceDir>/.venv/bin/python server.py --port 47645 --data <data>/voice --seed-refs <repo>/scripts/voice-bench`.
- Produces (шлюз): `GET /api/voice -> state.json` (нет файла — `{ "state": "off" }`).

- [ ] **Step 1: Тесты** — `voicePlan` на трёх случаях; `restartDelay(n: number) -> number | null` (5000 для n < 3, затем null); `/api/voice` отдаёт файл и `{state:"off"}` без файла.
- [ ] **Step 2: `npm test -- voice-launch platform` — FAIL**
- [ ] **Step 3: Реализация**
- [ ] **Step 4: `npm test -- voice-launch platform` — PASS; `npm run typecheck`**
- [ ] **Step 5: Коммит** «Голос: запуск сервиса вместе с приложением, состояние в шлюзе»

### Task 4: Окно — связь с сервисом

**Files:**
- Create: `apps/editor/src/voice/client.ts`, `apps/editor/src/voice/protocol.ts`, `apps/editor/tests/voice-protocol.test.ts`

**Interfaces:**
- Produces (`protocol.ts`): типы `ServerMsg`, `ClientMsg` (раздел 2 спецификации); `parseAudio(buf: ArrayBuffer) ->
  { id: number; rate: number; pcm: Int16Array }`; `voiceStatus(api: { state: string } | null, ws: 'open' | 'closed' |
  'connecting', ready: boolean) -> 'off' | 'loading' | 'connecting' | 'ready' | 'error' | 'reconnecting'`.
- Produces (`client.ts`): `class VoiceClient` — `start(): Promise<void>` (микрофон: AudioWorklet из `talk.html`,
  16 кГц, 512 отсчётов), `on<K extends ServerMsg['type']>(type: K, cb)`, `say(id: number, role: 'chief'|'umpire',
  text: string, more?: boolean)`, `stop(id?: number)`, `settings(cfg)`, `calib(step, sec?)`, `voice(op, args)`,
  `status` (по `voiceStatus`); переподключение раз в 2 с, при обрыве — остановка воспроизведения; отказ микрофона —
  разбор причины как на стенде (браузер / macOS). Адрес — `ws://127.0.0.1:47645/ws` (`localStorage['def_ops.voice.url']`
  переопределяет).
- Константа `VOICE_SAY_IDS`: идентификаторы фраз растут с 1.

- [ ] **Step 1: Тесты** — `parseAudio` (id и rate LE, длина pcm); `voiceStatus`: шлюз `off` → `off`; `loading` и ws
  `closed` → `loading`; ws `open` + `ready` → `ready`; был `ready`, ws `closed` → `reconnecting`.
- [ ] **Step 2: FAIL** — `npm test -- voice-protocol`
- [ ] **Step 3: Реализация**
- [ ] **Step 4: PASS; `npm run typecheck`**
- [ ] **Step 5: Коммит** «Голос: связь окна с голосовым сервисом»

### Task 5: Реестр действий и разборщик реплик (правила)

**Files:**
- Create: `apps/editor/src/voice/registry.ts`, `apps/editor/src/voice/dispatch.ts`, `apps/editor/src/voice/actions/shell.ts`
- Create: `apps/editor/tests/voice-dispatch.test.ts`
- Modify: `apps/editor/src/Shell.tsx` (секции — из экспортируемого `SECTIONS`; действия `shell.open` регистрируются)

**Interfaces:**
- Produces (`registry.ts`): `interface Action<P>` из раздела 3 спецификации (`id, section, title, describe, params?,
  say?, irreversible?, confirm?, available, run`); `register(a: Action): () => void`, `useAction(a)`,
  `act(id: string, p?: unknown): Promise<string | void>`, `actions(section: string): Action[]` (общие + раздела),
  `ActButton` (кнопка с `data-action`, вызывает `act`).
- Produces (`dispatch.ts`): `addressed(text: string) -> { rest: string } | null` — обращение только в начале фразы:
  «штаб», «штап», «товарищ полковник», «товарищ генерал» (регистр и знаки не важны); `class Dispatcher(opts: { now():
  number; say(text: string): void; section(): string })`: `utterance(text: string, id: number, continues?: number):
  Promise<'ignored' | 'done' | 'unknown'>`; окно разговора `CONVERSATION_S = 12` от `spoke()` (вызывается по
  `say-done`); правила: «открой/покажи/перейди в <раздел>» (названия из `SECTIONS`, падежи: «переигровку»,
  «моделирование», «карты», «знаки», «знания», «редактор», «ИИ»), «что я могу сказать» (зачитывает до 7 `say` из
  `actions(section)`), «калибровка», «голоса», «стоп/тихо». Не понял — переспрос своими словами: «Не понял вас. Можно сказать, например: …» (три примера, ближайшие
  по словам); вопрос «а можешь …?» без подходящего действия — «Этого система пока не предусматривает. Могу: …». `continues` — прежняя реплика забыта, обрабатывается склеенная.
- Produces (`actions/shell.ts`): `shell.open {section}`, `shell.calibrate`, `shell.voices`, `shell.help`.

- [ ] **Step 1: Тесты**

```ts
it('обращение только в начале', () => {
  expect(addressed('Штаб, открой переигровку')?.rest).toBe('открой переигровку');
  expect(addressed('штап открой карты')?.rest).toBe('открой карты');
  expect(addressed('Товарищ генерал, что я могу сказать?')).not.toBeNull();
  expect(addressed('Передайте в штаб армии')).toBeNull();
  expect(addressed('Штаб.')?.rest).toBe('');
});
it('окно разговора 12 с', async () => { /* после spoke() в t: реплика без обращения в t+11 → done, в t+13 → ignored */ });
it('открой переигровку → shell.open replay', async () => { /* act вызван с { section: 'replay' } */ });
it('что я могу сказать — не больше 7 фраз', async () => { /* say получил текст с ≤ 7 примерами */ });
it('continues — прежняя реплика не исполняется', async () => { /* первая «штаб открой», вторая с continues «карты» → один вызов shell.open maps */ });
```

- [ ] **Step 2: FAIL** — `npm test -- voice-dispatch`
- [ ] **Step 3: Реализация**
- [ ] **Step 4: PASS; `npm run typecheck`**
- [ ] **Step 5: Коммит** «Голос: реестр действий, обращение к штабу, переходы между разделами»

### Task 6: Панель голоса — состояние, лента, «что можно сказать», калибровка, голоса

**Files:**
- Create: `apps/editor/src/voice/VoicePanel.tsx`, `apps/editor/src/voice/Calibration.tsx`, `apps/editor/src/voice/Voices.tsx`
- Modify: `apps/editor/src/Shell.tsx` (панель поверх разделов), `apps/editor/src/styles.css`

**Interfaces:**
- Consumes: `VoiceClient` (Task 4), `Dispatcher`, `actions` (Task 5).
- Требования «Кто пользуется» (Global Constraints) — проверяются в сквозном скрипте: размер шрифта панели ≥ 18 px,
  подсказка «Скажите: Штаб, что я могу?» видна в развёрнутой панели, регуляторы скрыты до «Тонкой настройки».
- Produces: `<VoicePanel/>` — свёрнута в значок (цвет — состояние); развёрнута: состояние словами («жду обращения»,
  «разговор», «слушаю», «думаю», «говорит», «голос загружается», «голос не установлен: services/voice/setup.sh»,
  «переподключаюсь»), индикатор уровня с отметками порогов, лента (не обращённое — серым с пометкой «не мне»),
  «Что можно сказать» (`say` доступных действий, недоступные — серым с причиной), кнопки «Калибровка», «Голоса»,
  регуляторы стенда (хранятся в `localStorage['def_ops.voice.settings']`).
- `Calibration` — четыре шага стенда (тишина, ваш голос, голос модели, перебивание) через `calib`.
- `Voices` — список с ролями, прослушать, назначить роль, удалить; «Записать новый голос»: предупреждение («голос
  будет использоваться системой, хранится только на этом компьютере»), `RECORD_TEXT`, запись, результат проверки с
  причинами, «Прослушать пробу», «Сохранить» с именем.

- [ ] **Step 1: Проверка на стенде** — сервис `--fake`, `npm run dev`; Playwright-скрипт
  `scripts/voice-e2e.mjs` (поддельный микрофон, `--fake-script` с репликами «штаб, открой переигровку»,
  «передайте в штаб армии», «штаб, что я могу сказать»): раздел стал `#replay`; вторая реплика — в ленте «не мне»;
  на третью — `say` с примерами; калибровка проходит до «Регуляторы выставлены»; запись голоса по `--fake` даёт
  результат проверки. Скрипт печатает «ok» по каждому пункту.
- [ ] **Step 2: `node scripts/voice-e2e.mjs` — FAIL (панели нет)**
- [ ] **Step 3: Реализация**
- [ ] **Step 4: `node scripts/voice-e2e.mjs` — все пункты ok; `npm run typecheck`; `npm test`**
- [ ] **Step 5: Коммит** «Голос: панель — состояние, лента, подсказки, калибровка, голоса»

### Task 7: Описание системы и проверка на Mac

**Files:**
- Modify: `docs/system.md` (часть I, новый раздел «Голосовое управление»: запуск и установка, панель, обращение и
  окно разговора, команды этой ступени, калибровка, голоса и запись нового голоса), `docs/guide.md`
- Create: `docs/img/voice-panel.jpg`, `docs/img/voice-calibration.jpg`, `docs/img/voice-voices.jpg` (из
  `scripts/voice-e2e.mjs --shots`, 1440×900, JPEG)
- Modify: `docs/system.pdf`, `docs/system.docx` (`npm run docs:system`), `services/voice/README.md`
  (установка, запуск вручную, `--fake`, протокол кратко, список проверки на Mac)

- [ ] **Step 1:** Тексты и подписи к снимкам (описывают видимое на снимке); ссылки на разделы проверены.
- [ ] **Step 2:** `npm run docs:system`; если правились разделы 6–7 части I — `npm run model:index`.
- [ ] **Step 3:** `npm run typecheck`; `npm test`; `npm run test:voice`.
- [ ] **Step 4: Коммит** «Голос: описание системы — голосовое управление (ступень 1)», пуш.
- [ ] **Step 5:** Список проверки на Mac пользователю: `services/voice/setup.sh`; запуск приложения → «Голос
  загружается» → «Жду обращения»; калибровка; «Штаб, открой переигровку»; разговор в комнате не исполняется;
  пауза посреди фразы — одна реплика, а не две; запись нового голоса и назначение роли.
