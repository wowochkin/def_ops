# Управление GPU для выставочного голоса — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Автономный Windows-комплект с поочерёдной загрузкой выбранной LLM и Qwen NF4, проверяемым Flash Attention и прогрессом итога.

**Architecture:** Единственный координатор главного окна переключает LM Studio и ресурсы голосовой службы. Сам процесс Python/CPU ASR остаётся живым, PCM переживает выгрузку TTS. Новый профиль активируется только после CUDA smoke; предыдущий сохраняется.

**Tech Stack:** TypeScript/React, Python 3.12, Torch 2.7.1+cu128, Transformers 4.57.3, bitsandbytes, FastAPI/WebSocket, LM Studio native REST.

**Spec:** `docs/superpowers/specs/2026-11-08-expo-gpu-handoff-design.md`

## Global Constraints

- Windows 10, RTX 4060 Ti 16 ГБ; Mac MLX без изменений; без сети на установке.
- Текст LLM после карты; 50 токенов/220 символов/две фразы; третья реплика до алгоритмического итога.
- Весь итог синтезируется до открытия разбора; новых лимитов/тайм-аутов синтеза нет.
- Управляется основная выбранная LLM, не default/voice override и не embeddings.
- Qwen ru-stress, словарь, образцы и параметры полного текста/penalty 1.5/temperature 0.2 сохраняются.
- Не менять ядро модели боя, не сбрасывать сеанс при проверках; не коммитить чужие изменения.

## Review Focus

- Два клиента/отмена загрузки: запоздалый переход не занимает GPU против решения координатора.
- Alias/другая модель: unload касается точного экземпляра выбранной LLM.
- Третий комментарий/новый сеанс: нет лишнего LLM bounce и старого прогресса.
- PCM после unload: нет повторного синтеза и пропуска речи.
- Нативный wheel/DLL несовместим: рабочий профиль не заменён; Flash не объявлен работающим без kernel smoke.

### Задача 1: Ресурсы TTS и квантование

**Files:** `services/voice/models_torch.py`, `server.py`, новый `torch_profile.py`, тесты `test_windows_models.py`, `test_server.py`.

**Interfaces:** WS request `{type:'tts-resource', id:number, op:'load'|'unload', voice_id?:string}`; response `{type:'tts-resource-done', id, tts:TtsInfo, error?:string}`. Дополнительные необязательные поля TtsInfo: `managed`, `resident`, `phase`, `quantization`, `attention`. Профиль `voice/torch-profile.json`: `managed:bool`, `quantization:'nf4'|'int8'|'bf16'`, `attention:'flash_attention_2'|'sdpa'`. Без файла — прежний BF16/SDPA и постоянная загрузка.

- [x] Тесты: lazy startup managed, NF4 kwargs/исключения токенизатора, ошибка конфигурации без подмены, load/warm/unload, PCM после unload, сериализация двух клиентов.
- [x] Увидеть ожидаемые падения; реализовать профиль, идемпотентные методы загрузки/выгрузки через executor; обычный синтез обеспечивает загруженную TTS. Кэш промпта по образцу/mtime/тексту; сброс на unload.
- [x] Полный `services/voice/.venv/bin/python -m pytest services/voice/tests -q`; PASS, без CUDA-утверждений.

### Задача 2: Клиент и координатор выставочного режима

**Files:** `apps/editor/src/voice/{protocol,client,tts-store}.ts`, `expo/{live-voice-profile,speaker,stage}.ts`, новый `expo/gpu-handoff.ts`, соответствующие tests.

**Interfaces:** `VoiceClient.ttsResource(op, voiceId?, signal?):Promise<TtsInfo>`. `GpuHandoff.llm(signal?)`, `.tts(voiceId,signal?)`, `.cancel()`; сериализация с поколением/отменой. Native REST через `/llm/api/v1/models{,/load,/unload}`.

- [x] Тесты order unload→load, idempotence, alias, нет выгрузки посторонних/embeddings, отсутствие native API, отмена во время load.
- [x] Реализовать ресурсные запросы/подтверждения, один координатор; подключить к llmAsk и подготовке голоса.
- [x] Прогреть выбранную LLM на выборе, не запускать GPU-переходы во время scroll; после комментариев 1/2 восстановить LLM, после 3 сохранить TTS. Ошибка явно отражается в журнале/тексте, не возвращает другую модель.
- [x] Точечные Vitest + проверки жизненного цикла stage: LLM только после карты, весь итог до result.

### Задача 3: Прогресс итоговой озвучки

**Files:** `expo/{speaker,stage,director,ExpoView}.ts(x)`, тесты.

**Interfaces:** callback `onProgress({done,total,stage})` при подготовке; DirectorEvent `debriefProgress`; фаза preparing хранит счётчик. Старый API без callback совместим.

- [x] Тест 0/N → 1/N → N/N, нет преждевременного result, отмена/новый сеанс очищает прогресс.
- [x] Плашка внизу: текущая стадия, выполненные/все фрагменты, прошедшее время, без выдуманного ETA.
- [x] Vitest и снимок JPEG 1440×900; показать правдивый прогресс на основном/боковых окнах.

### Задача 4: Автономное обновление и проверка Windows

**Files:** `release/defops-gpu-handoff/` (wheels/installer/CUDA smoke/manifest), скрипты переносимого комплекта, документация.

- [x] Закрепить wheels bitsandbytes/FA2, источники, SHA256, лицензии; проверить архивы/PE. Не обновлять Torch/Transformers.
- [ ] **Ожидает Windows:** Smoke текущим Python: NF4 load, вызов реального FA2 CUDA, прогрев/синтез WAV, время/VRAM. Не трогать LLM, не активировать профиль при ошибке; полный лог.
- [x] Installer: резервные копии app/profile/manifest, read-only/Unicode, повторное применение, офлайн pip `--no-index --no-deps`; точечный останов сервиса после закрытия приложения. Кнопка отката.
- [x] Собрать editor, проверить typecheck, тесты затронутых частей; полный npm test один раз к завершению. Отдельно сообщить известные/посторонние падения.
- [x] Обновить `docs/system.md`, снимок, PDF/Word и Windows-инструкцию. Физическую CUDA-проверку обозначить ожидающей результата целевого ПК.

## Исполнение

Порядок и параметры уточнены пользователем; дополнительное разрешение на реализацию не требуется.
Задачи 1 и 2 допускают независимую работу после фиксации WS-контракта; задача 3 идёт с 2, упаковка — после обеих.
Коммиты в этой работе не создаются без запроса пользователя.

Код native smoke, установка и откат реализованы и проверены локальными тестами; физический CUDA-прогон выполняет UPDATE.cmd на Windows до активации. Сквозной прогон использовал настоящие ядро и WebAudio с имитацией LM/TTS, поэтому скорость и качество голоса не подтверждает. Подробные результаты — `.superpowers/sdd/2026-11-08-expo-gpu-handoff/progress.md`.
