# КШВИ современного режима — план реализации полного релиза

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Работа выполняется последовательно в текущей сессии, без субагентов; после каждой задачи обязательны свежая проверка и независимое чтение изменений.

**Goal:** Выпустить полноценный раздел КШВИ со всеми подготовительными, сетевыми, имитационными, автономными, аналитическими, административными и экспозиционными возможностями спецификации, а не сокращённый MVP.

**Architecture:** Чистое версионное доменное ядро и reducer находятся в `packages/kshvi`; PostgreSQL, append-only журнал, снимки, outbox, серверные проекции и команды — в `services/kshvi`. Карта и погода подключаются через неизменяемый `EnvironmentSnapshot`; вероятностные события, электронный посредник, адаптер `agents-core`, знаки, React-рабочие места и автономный архив являются отдельными модулями с общими контрактами. Все восемь этапов заканчиваются работающим вертикальным срезом, но версия 1.0 выпускается только после полного набора функциональных, нефункциональных, методических и экспозиционных испытаний.

**Tech Stack:** TypeScript, Node.js `node:http`, PostgreSQL, React 19, MapLibre, Vitest, Playwright, Rust `agents-core`, JSON Schema/OpenAPI, локальные PDF/DOCX-генераторы, SHA-256, SSE, локальный TLS.

**Spec:** `docs/superpowers/specs/2026-11-20-kshvi-modern-design.md`

## Global Constraints

- Полный релиз включает **267 функциональных требований, 22 нефункциональных требования и AC-01–AC-30**; ни один внутренний этап не объявляется готовым продуктом.
- Официальный способ — только `full-simulation`; `EXPOSITION` обязателен в релизе и отделён от `CONDUCT`.
- КШВИ и «Условные знаки» находятся внутри современного режима; `AppMode = historical | modern` не расширяется.
- Целевой каталог содержит **не менее 240 содержательно различных событий, минимум 20 в каждой из 12 категорий**; числовые клоны не засчитываются.
- Сервер — единственный авторитетный источник официального мира; продакшн-контур использует PostgreSQL, append-only журнал, снимки и транзакционный outbox.
- Любая проекция, SSE, поиск, выгрузка, реплей, архив и агент получают только серверно разрешённые данные; фильтрации только в браузере недостаточно.
- Исторические доктрины, сценарии и численные нормативы не переносятся; современные профили создаются и утверждаются заново с источником или пометкой «учебное допущение».
- Неизвестное не заменяется нулём, единицей, «нормальным» состоянием, центром карты или идеальным значением; обязательный пробел даёт `UNKNOWN`, `REQUIRES_REVIEW` либо блокировку.
- Закрытая LAN, **2–50 рабочих мест**, не менее 25 активных участников, 5 команд/с устойчиво и 20 команд/с в течение 60 с; 95-й процентиль доставки ≤ 5 с, карты ≤ 2 с.
- Эталонный стенд — не менее 8 ядер CPU и 16 ГБ ОЗУ, 100 инстанций, 1 000 сил, 10 000 событий; RPO подтверждённых событий — ноль, перезапуск ≤ 5 мин, восстановление узла ≤ 30 мин.
- Интерфейс, ошибки, документы, коммиты и руководство — на русском; основные экраны проверяются при 1440×900 и 125 %, проектор — при 1920×1080.
- Никакие внешние сетевые ресурсы, TTF, облачные модели или сервисы не требуются во время официального учения, реплея и экспозиции.
- Каждая задача выполняется через failing test → реализацию → passing test → документацию → отдельный коммит. Перед коммитом задачи — точечные проверки; перед релизным коммитом — полные `npm run typecheck` и `npm test`.
- Изменение поведения в той же задаче обновляет `docs/system.md`, затронутые JPEG 1440×900, `docs/system.pdf`, `docs/system.docx`, `packages/knowledge/data/seed.json` и `model-index.json`, если затронуты соответствующие области по `AGENTS.md`.
- Существующие незакоммиченные изменения владельца не перезаписываются и не включаются в чужие коммиты; коммитятся только файлы текущей задачи.

## Релизный принцип

Промежуточные контрольные точки `G0–G6` подтверждают готовность к следующей разработке. Они **не разрешают выпуск**. Признаки сырого MVP, блокирующие версию 1.0: статичные макеты вместо команд, локальный журнал вместо серверного, ручная подстановка результатов, отсутствие автономного посредника или противника, МПС без влияния, поставка без пути и баланса, каталог менее 240 событий, неутверждённые знаки, архив без среды, отсутствие экспозиции, открытые ошибки любого AC/NF или неоформленные ограничения.

## Карта файлов и границы ответственности

| Путь | Ответственность |
|---|---|
| `packages/kshvi/src/model/` | Сущности, состояния, профили, единицы, неизвестные значения |
| `packages/kshvi/src/events/` | Конверт события, канонический JSON, хеши, reducer, версии reducer |
| `packages/kshvi/src/commands/` | Типизированные команды, идемпотентные ключи, ошибки |
| `packages/kshvi/src/projections/` | Чистые правила видимости и перспективы |
| `packages/kshvi/src/environment/` | Порт среды, снимки, погодные эффекты |
| `packages/kshvi/src/terrain/` | Динамическая местность, граф, переправы, очереди |
| `packages/kshvi/src/forces/` | Дерево, силы, техника, МПС, готовность, построение |
| `packages/kshvi/src/logistics/` | Проводки, заявки, поставки, ремонт, баланс |
| `packages/kshvi/src/documents/` | Редакции, маршруты, подписи, каскад |
| `packages/kshvi/src/communications/` | Каналы, сообщения, попытки, табель донесений |
| `packages/kshvi/src/simulation/` | Расчёты, движение, наблюдения, решения, объяснения |
| `packages/kshvi-events/src/` | Схема шаблонов, планировщик, следы, репетиции |
| `packages/kshvi-events/data/catalog/` | Двенадцать файлов утверждённых событий |
| `packages/kshvi-agents/src/` | Электронный посредник, порты агентов, следы решений |
| `crates/agents-kshvi/` | Современный Rust-адаптер без исторических нормативов |
| `packages/tactical-symbols/` | Векторные определения, реестр источника, MapLibre/экспорт |
| `services/kshvi/src/store/` | Миграции, события, снимки, ревизии, outbox, задания |
| `services/kshvi/src/auth/` | Локальные учётные записи, сессии, полномочия, аудит |
| `services/kshvi/src/http/` | REST/SSE, ошибки, восстановление соединения |
| `services/kshvi/src/environment/` | Адаптер существующего сервиса картографии |
| `services/kshvi/src/agents/` | Постоянный Rust worker и серверный цикл агентов |
| `services/kshvi/src/archive/` | Автономный пакет, проверка, импорт, viewer |
| `apps/editor/src/modern/kshvi/` | Конструктор, проведение, разбор, архив, показ, администрирование |
| `apps/editor/src/modern/symbols/` | Самостоятельный справочник знаков |
| `scripts/kshvi-*.mjs` | Покрытие, приёмка, нагрузка, автономность, релизный барьер |
| `docs/release/kshvi/` | Манифест, доказательства, протоколы, ограничения, ведомость выпуска |

## Общий цикл каждой задачи

1. Тест сначала запускается и должен упасть по отсутствию поведения, а не по синтаксической ошибке самого теста.
2. Реализация ограничивается файлами задачи; интерфейсы `Consumes/Produces` нельзя менять без обратной совместимости и новой версии.
3. Точечная команда должна завершиться кодом 0; после этого выполняются связанные контрактные тесты.
4. В тот же коммит входят схемы, миграции, русские ошибки, документация и снимки затронутого экрана.
5. В описании коммита перечисляются закрытые идентификаторы; задача отмечается только после чтения итогового diff.

---

## Этап 0 — архитектурный фундамент и доказуемость полноты

### Task 1: Манифест полного релиза и автоматический барьер покрытия

**Files:**
- Create: `scripts/kshvi-release-gate.mjs`
- Create: `docs/release/kshvi/requirements.json`
- Create: `docs/release/kshvi/evidence/.gitkeep`
- Modify: `package.json`
- Test: `scripts/tests/kshvi-release-gate.test.mjs`

**Requirements:** NF-19; релизный барьер для всех F-групп, NF-01–NF-22 и AC-01–AC-30.

**Interfaces:**
- Consumes: идентификаторы из спецификации и JSON-доказательства задач.
- Produces: `node scripts/kshvi-release-gate.mjs --require-complete` с ненулевым выходом при любом пробеле.

- [ ] **Step 1: Написать падающий тест барьера**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseGaps } from '../kshvi-release-gate.mjs';

test('неполное доказательство блокирует выпуск', () => {
  const gaps = releaseGaps(
    ['KSHVI-F-GEN-01', 'KSHVI-NF-01', 'KSHVI-AC-01'],
    { 'KSHVI-F-GEN-01': 'docs/release/kshvi/gen-01.json' },
  );
  assert.deepEqual(gaps, ['KSHVI-NF-01', 'KSHVI-AC-01']);
});
```

- [ ] **Step 2: Запустить тест и подтвердить отсутствие реализации**

Run: `node --test scripts/tests/kshvi-release-gate.test.mjs`
Expected: FAIL, модуль `scripts/kshvi-release-gate.mjs` ещё не существует.

- [ ] **Step 3: Реализовать строгий манифест**

```js
export function releaseGaps(required, evidence) {
  return required.filter(id => {
    const record = evidence[id];
    return typeof record !== 'string' || record.length === 0;
  });
}
```

Манифест изначально содержит все идентификаторы спецификации со статусом `pending`. Доказательство принимается только при существующем файле, `status: "passed"`, свежем коммите, команде проверки и непустом списке артефактов. Добавить `test:kshvi:release` и запрет `release`-статуса при `pending`, `failed`, `waived` либо отсутствующем файле. Исключения не предусмотрены: ограничение фиксируется отдельно и блокирует заявление полноты.

- [ ] **Step 4: Проверить положительный и отрицательный сценарии**

Run: `node --test scripts/tests/kshvi-release-gate.test.mjs && npm run test:kshvi:release`
Expected: unit-тест PASS; релизный барьер FAIL и перечисляет все ещё не закрытые элементы — это корректное начальное состояние, не ошибка теста.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add scripts/kshvi-release-gate.mjs scripts/tests/kshvi-release-gate.test.mjs docs/release/kshvi package.json
git commit -m "КШВИ: добавить обязательный барьер полного релиза"
```

### Task 2: Доменные сущности, классификация, единицы и версионные ссылки

**Files:**
- Create: `packages/kshvi/package.json`
- Create: `packages/kshvi/src/index.ts`
- Create: `packages/kshvi/src/model/types.ts`
- Create: `packages/kshvi/src/model/entities.ts`
- Create: `packages/kshvi/src/model/profiles.ts`
- Create: `packages/kshvi/src/model/unknown.ts`
- Test: `packages/kshvi/tests/model.test.ts`

**Requirements:** CLASS-01–CLASS-04, ARCH-10–ARCH-11, GEN-02.

**Interfaces:**
- Produces: `Exercise`, `ScenarioVersion`, `Instance`, `VersionRef`, `Quantity`, `Unknown<T>`, `ScaleProfile`, `ActionTaxonomy`.

- [ ] **Step 1: Написать падающие тесты независимых осей и ссылок**

```ts
import { describe, expect, it } from 'vitest';
import { validateExerciseAxes, versionRef } from '../src/index';

describe('карточка КШВИ', () => {
  it('не выводит масштаб учения из масштаба карты', () => {
    expect(validateExerciseAxes({ scale: 'strategic', mapZoom: 8, trainedLevels: 1 })).toEqual([]);
  });
  it('запрещает ссылку на текущую редакцию', () => {
    expect(() => versionRef({ id: 'model-1', revision: 'current' })).toThrow('версионная ссылка');
  });
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/model.test.ts`
Expected: FAIL, экспорты пакета отсутствуют.

- [ ] **Step 3: Реализовать канонические типы**

```ts
export type VersionRef = Readonly<{ id: string; revision: number; sha256: string }>;
export type Quantity = Readonly<{ value: number | null; unit: string; status: 'KNOWN' | 'UNKNOWN' }>;
export function versionRef(value: { id: string; revision: number | 'current'; sha256?: string }): VersionRef {
  if (value.revision === 'current' || !value.sha256) throw new Error('Нужна неизменяемая версионная ссылка');
  return { id: value.id, revision: value.revision, sha256: value.sha256 };
}
export function validateExerciseAxes(_: { scale: string; mapZoom: number; trainedLevels: number }): string[] {
  return [];
}
```

Описать все сущности раздела 16.2 спецификации, статусы и UUID-бренды. Время разделить на `wallClockAt` UTC и `operationalAt` с зоной; физические величины хранить в базовых единицах. Добавить JSON Schema и русские сообщения валидатора.

- [ ] **Step 4: Проверить схемы и отсутствие браузерных зависимостей**

Run: `npx vitest run packages/kshvi/tests/model.test.ts && npm run typecheck 2>&1 | tail -3`
Expected: PASS; чистый пакет не импортирует React, IndexedDB или HTTP.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi package.json tsconfig.json
git commit -m "КШВИ: определить версионную доменную модель"
```

### Task 3: Канонический журнал, хеши и воспроизводимая случайность

**Files:**
- Create: `packages/kshvi/src/events/canonical.ts`
- Create: `packages/kshvi/src/events/envelope.ts`
- Create: `packages/kshvi/src/events/random.ts`
- Create: `packages/kshvi/src/events/hash-chain.ts`
- Create: `packages/kshvi/src/events/index.ts`
- Test: `packages/kshvi/tests/events.test.ts`
- Test: `packages/kshvi/tests/fixtures/replay-random.mjs`

**Requirements:** ARCH-12, SIM-01, SIM-13, NF-15.

**Interfaces:**
- Consumes: `VersionRef`, UUID и два времени из Task 2.
- Produces: `DomainEvent`, `RandomKey`, `canonicalJson`, `eventHash`, `deriveRandom`, `appendToChain`.

- [ ] **Step 1: Написать падающий тест стабильности**

```ts
import { expect, it } from 'vitest';
import { canonicalJson, deriveRandom } from '../src/events/index';

it('канонизирует ключи и отделяет потоки случайности', () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  const key = { seed: 7n, exerciseId: 'e', branchId: 'b', purpose: 'movement', ordinal: 4, algorithmVersion: 1 } as const;
  expect(deriveRandom(key)).toEqual(deriveRandom(key));
  expect(deriveRandom(key)).not.toEqual(deriveRandom({ ...key, purpose: 'contact' }));
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/events.test.ts`
Expected: FAIL, функции канонизации и RNG не реализованы.

- [ ] **Step 3: Реализовать детерминированные примитивы**

```ts
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)]))
    : typeof v === 'bigint' ? `${v}n` : v;
  return JSON.stringify(normalize(value));
}
```

Использовать SHA-256 канонического конверта, `prevHash`, монотонный `sequence` ветви и алгоритм с явной версией. Ключ `(seed, exerciseId, branchId, purpose, ordinal, algorithmVersion)` обязателен; `Math.random`, текущее системное время и порядок сетевых запросов в официальном выборе запрещены статическим тестом.

- [ ] **Step 4: Проверить кросспроцессную повторяемость**

Run: `npx vitest run packages/kshvi/tests/events.test.ts && node --import tsx packages/kshvi/tests/fixtures/replay-random.mjs`
Expected: одинаковые хеши и последовательности в двух процессах; повреждение `prevHash` обнаруживается.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/events packages/kshvi/tests packages/kshvi/src/index.ts
git commit -m "КШВИ: добавить канонический журнал и воспроизводимую случайность"
```

### Task 4: Состояние мира, версионный reducer и каталог допущений

**Files:**
- Create: `packages/kshvi/src/events/reducer.ts`
- Create: `packages/kshvi/src/events/reducer-registry.ts`
- Create: `packages/kshvi/src/model/world.ts`
- Create: `packages/kshvi/src/model/assumptions.ts`
- Create: `packages/kshvi/src/model/norms.ts`
- Test: `packages/kshvi/tests/reducer.test.ts`

**Requirements:** ARCH-01, GEN-02, GEN-06–GEN-07, ENV-01, SIM-01, SIM-17.

**Interfaces:**
- Consumes: `DomainEvent`, `RandomKey`, хеши Task 3.
- Produces: `WorldState`, `ModelProfile`, `AssumptionPassport`, `reduceWorld`, `replayWorld`, `ReducerRegistry`.

- [ ] **Step 1: Написать падающий тест повторного reducer**

```ts
import { expect, it } from 'vitest';
import { reduceWorld } from '../src/events/reducer';
import { emptyWorld } from '../src/model/world';

it('применяет событие один раз и сохраняет причину', () => {
  const world = emptyWorld('scenario-1');
  const event = { type: 'resource.consumed.v1', eventId: 'e1', payload: { resourceId: 'fuel', amount: 2 }, causeIds: [] } as const;
  const next = reduceWorld(world, event, { reducerVersion: 1 });
  expect(next.resources.fuel.consumed).toBe(2);
  expect(() => reduceWorld(next, event, { reducerVersion: 1 })).toThrow('уже применено');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/reducer.test.ts`
Expected: FAIL, `reduceWorld` и `emptyWorld` отсутствуют.

- [ ] **Step 3: Реализовать чистый reducer и паспорт модели**

```ts
type ReducibleWorld = {
  appliedEventIds: readonly string[];
  resources: Record<string, { consumed: number }>;
};
type WorldEvent = {
  eventId: string;
  type: string;
  payload?: unknown;
  causeIds?: readonly string[];
};

export function reduceWorld<W extends ReducibleWorld>(
  world: W,
  event: WorldEvent,
  profile: { reducerVersion: number },
): W {
  if (world.appliedEventIds.includes(event.eventId)) throw new Error('Событие уже применено');
  if (profile.reducerVersion !== 1) throw new Error('Неподдерживаемая версия reducer');
  if (event.type !== 'resource.consumed.v1') throw new Error('Неизвестный тип события');
  const payload = event.payload as { resourceId?: unknown; amount?: unknown };
  if (typeof payload.resourceId !== 'string' || !Number.isSafeInteger(payload.amount) || (payload.amount as number) <= 0) {
    throw new Error('Некорректный расход ресурса');
  }
  const resourceId = payload.resourceId;
  const amount = payload.amount as number;
  const current = world.resources[resourceId] ?? { consumed: 0 };
  return {
    ...world,
    resources: {
      ...world.resources,
      [resourceId]: { ...current, consumed: current.consumed + amount },
    },
    appliedEventIds: [...world.appliedEventIds, event.eventId],
  };
}
```

Реальный `WorldState` включает все компоненты формулы SIM-01. Каждый обработчик события чист, типизирован и зарегистрирован по `schemaVersion`; реплей не вызывает планировщик или генератор. Численный норматив без источника/допущения, области применимости, версии и утверждающего не проходит валидацию.

- [ ] **Step 4: Проверить инварианты и старые версии**

Run: `npx vitest run packages/kshvi/tests/reducer.test.ts packages/kshvi/tests/model.test.ts`
Expected: PASS; старый архив выбирает исходный reducer либо открывается с меткой несовместимого чтения.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src packages/kshvi/tests
git commit -m "КШВИ: реализовать версионное состояние мира и reducer"
```

### Task 5: PostgreSQL, идемпотентность, снимки, outbox и задания

**Files:**
- Create: `services/kshvi/package.json`
- Create: `services/kshvi/src/store/migrations.ts`
- Create: `services/kshvi/src/store/migrations/001-core.sql`
- Create: `services/kshvi/src/store/event-store.ts`
- Create: `services/kshvi/src/store/snapshot-store.ts`
- Create: `services/kshvi/src/store/outbox.ts`
- Create: `services/kshvi/src/store/jobs.ts`
- Test: `services/kshvi/tests/event-store.test.ts`
- Test: `services/kshvi/tests/helpers/database.ts`

**Requirements:** ARCH-05–ARCH-09, ARCH-13–ARCH-14, ARCH-19, NF-11.

**Interfaces:**
- Consumes: `@def-ops/db`, `DomainEvent`, `WorldState`.
- Produces: `appendCommand`, `loadSnapshot`, `restoreWorld`, `publishOutbox`, `submitJob`.

- [ ] **Step 1: Написать падающий интеграционный тест**

```ts
import { expect, it } from 'vitest';
import { withKshviDatabase } from './helpers/database';

it('атомарно фиксирует событие, ревизию и outbox', async () => {
  await withKshviDatabase(async store => {
    const input = { instanceId: 'i1', aggregateRevision: 0, idempotencyKey: 'cmd-1', type: 'instance.paused.v1', payload: { reason: 'проверка' } };
    const first = await store.appendCommand(input);
    const second = await store.appendCommand(input);
    expect(second.eventId).toBe(first.eventId);
    expect(await store.eventCount('i1')).toBe(1);
    expect(await store.outboxCount('i1')).toBe(1);
  });
});
```

- [ ] **Step 2: Запустить тест на реальной PostgreSQL**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/kshvi_test npx vitest run services/kshvi/tests/event-store.test.ts`
Expected: FAIL, схема и репозиторий отсутствуют; тест не заменяется памятью.

- [ ] **Step 3: Реализовать транзакционное хранение**

```sql
create unique index kshvi_command_once
  on commands (organization_id, instance_id, idempotency_key);
create unique index kshvi_event_sequence
  on events (organization_id, instance_id, branch_id, sequence);
create function reject_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'События журнала неизменяемы';
end;
$$;
create trigger kshvi_event_mutate
before update or delete on events
for each row execute function reject_event_mutation();
```

В одной транзакции записывать событие, результат идемпотентности, ревизию и outbox; `COMMIT` предшествует подтверждению. Реализовать снимки при старте, вокруг скачка, по расписанию, перед завершением и копированием. Добавить очередь `queued/running/succeeded/failed/cancelled`, миграции на копии, запрет изменения событий и восстановление последнего целого снимка с хвостом журнала.

- [ ] **Step 4: Проверить отказ до ответа и повторную обработку**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/kshvi_test npx vitest run services/kshvi/tests/event-store.test.ts`
Expected: PASS; принудительный отказ после `COMMIT` не создаёт дубликат при повторе, outbox восстанавливается независимым обработчиком.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add services/kshvi package.json
git commit -m "КШВИ: добавить транзакционный серверный журнал и снимки"
```

### Task 6: Каркас сервиса, участники, полномочия и единый конверт ошибок

**Files:**
- Create: `services/kshvi/src/main.ts`
- Create: `services/kshvi/src/app.ts`
- Create: `services/kshvi/src/http/router.ts`
- Create: `services/kshvi/src/http/errors.ts`
- Create: `services/kshvi/src/auth/passwords.ts`
- Create: `services/kshvi/src/auth/sessions.ts`
- Create: `services/kshvi/src/auth/authorize.ts`
- Create: `services/kshvi/src/auth/audit.ts`
- Modify: `services/gateway/src/gateway.ts`
- Modify: `services/gateway/src/main.ts`
- Modify: `scripts/dev-services.mjs`
- Test: `services/kshvi/tests/auth.test.ts`
- Test: `services/gateway/tests/kshvi-route.test.ts`

**Requirements:** ARCH-16, ARCH-23, ROLE-01–ROLE-02, NF-06–NF-09.

**Interfaces:**
- Consumes: Task 5 и существующий `Router`/`createService`.
- Produces: `ParticipantContext`, `authorize`, `kshviError`, `/api/kshvi/auth/*`, внутренний порт 8105.

- [ ] **Step 1: Написать падающие тесты безопасности**

```ts
import { expect, it } from 'vitest';
import { authorize, kshviError } from '../src/index';

it('не принимает роль из тела запроса и не раскрывает скрытый объект', () => {
  const actor = { userId: 'u1', activeRole: 'TRAINEE', sideId: 'blue', organizationId: 'org1' } as const;
  expect(() => authorize(actor, { action: 'document:approve', sideId: 'red', objectExists: true })).toThrow('403');
  expect(kshviError(403, 'forbidden', 'u1')).toMatchObject({ status: 403, body: { error: { message: 'Действие недоступно' } } });
});
```

- [ ] **Step 2: Запустить тесты**

Run: `npx vitest run services/kshvi/tests/auth.test.ts services/gateway/tests/kshvi-route.test.ts`
Expected: FAIL, сервис и маршрут `/api/kshvi` не зарегистрированы.

- [ ] **Step 3: Реализовать локальную аутентификацию и авторизацию**

```ts
export function kshviError(status: 403 | 409 | 422 | 503, code: string, correlationId: string) {
  const messages = { 403: 'Действие недоступно', 409: 'Данные изменились, обновите редакцию', 422: 'Проверьте заполнение данных', 503: 'Сервис временно недоступен, повторите команду с прежним ключом' } as const;
  return { status, body: { error: { code, message: messages[status], correlationId, fields: [], allowedActions: status === 503 ? ['RETRY_SAME_KEY'] : [] } } };
}
```

Пароли хешировать `scrypt` с индивидуальной солью; сессии — случайные 256-битные токены, только их SHA-256 в БД, срок и отзыв на сервере. Роль выбирается явной командой и проверяется по назначению; cookie `HttpOnly`, `Secure`, `SameSite=Strict`, изменяющие запросы защищаются CSRF. Сохранять безопасный аудит без токенов и скрытого payload. Подключить REST/SSE через шлюз без буферизации.

- [ ] **Step 4: Проверить отзыв сессии и изоляцию организаций**

Run: `npx vitest run services/kshvi/tests/auth.test.ts services/gateway/tests/kshvi-route.test.ts && npm run typecheck 2>&1 | tail -3`
Expected: PASS; отозванная сессия отклоняется на следующем запросе, `organizationId` из клиента не доверяется.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add services/kshvi services/gateway scripts/dev-services.mjs package.json
git commit -m "КШВИ: добавить сервис, участников и серверные полномочия"
```

---

## Этап 1 — оболочка, неизменяемая среда и современные знаки

### Task 7: EnvironmentProvider и контентно-адресуемый снимок карты/погоды

**Files:** Create `packages/kshvi/src/environment/provider.ts`, `services/kshvi/src/environment/cartography-provider.ts`, `services/kshvi/src/environment/snapshot-store.ts`, `services/kshvi/src/http/environment-routes.ts`; Test `services/kshvi/tests/environment-snapshot.test.ts`.

**Requirements:** ARCH-04, ENV-02–ENV-09, ENV-16–ENV-17, NF-21.

**Interfaces:** Consumes существующие `/api/cartography/atlas` и `/environment/weather`; Produces `EnvironmentProvider`, `createSnapshot`, `weatherAtOperational`, `assertSnapshotComplete`.

- [ ] **Step 1: Написать падающий тест неизменяемости**

```ts
import { expect, it } from 'vitest';
import { assertSnapshotComplete } from '../src/environment/snapshot-store';

it('не принимает ссылку на изменяемый атлас вместо снимка', () => {
  expect(() => assertSnapshotComplete({ atlas: { id: 'a1', sha256: 'abc', contentRef: null }, weather: { mode: 'scenario', contentRef: 'weather/abc' } })).toThrow('автономный');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run services/kshvi/tests/environment-snapshot.test.ts`
Expected: FAIL, проверка снимка отсутствует.

- [ ] **Step 3: Реализовать адаптер и манифест**

```ts
export interface EnvironmentProvider {
  listAtlases(): Promise<readonly AtlasMeta[]>;
  snapshot(selection: EnvironmentSelection): Promise<EnvironmentSnapshot>;
  weatherAt(snapshot: EnvironmentSnapshot, at: { lon: number; lat: number; operationalAt: string }): Promise<WeatherState | null>;
}
```

Снимок копирует стиль, необходимые тайлы/экспорт, высоты и погодный срез в `data/kshvi/environment/<sha256>/`; хранит атрибуцию и лицензии. Изменение соседнего каталога не меняет объект. Погода запрашивается только по оперативному времени; отсутствие покрытия возвращает `null` и качество данных, не «нормальную погоду».

- [ ] **Step 4: Проверить удаление исходного набора после фиксации**

Run: `npx vitest run services/kshvi/tests/environment-snapshot.test.ts apps/editor/tests/modern-environment.test.tsx`
Expected: PASS; активный снимок открывается после переименования исходного атласа, неполный архив явно отклоняется.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/environment services/kshvi/src/environment services/kshvi/src/http services/kshvi/tests
git commit -m "КШВИ: зафиксировать карту и погоду неизменяемым снимком"
```

### Task 8: Профили влияния погоды и поведение при неизвестных данных

**Files:** Create `packages/kshvi/src/environment/weather-effects.ts`, `packages/kshvi/data/profiles/weather-effects.json`; Test `packages/kshvi/tests/weather-effects.test.ts`.

**Requirements:** ENV-10–ENV-11, SIM-24, GEN-07.

**Interfaces:** Consumes `WeatherState`, `TerrainContext`, `ModelProfile`; Produces `WeatherEffectProfile`, `applyWeatherEffects`, `EffectResult`.

- [ ] **Step 1: Написать падающий парный тест**

```ts
import { expect, it } from 'vitest';
import { applyWeatherEffects } from '../src/environment/weather-effects';

it('не подставляет коэффициент 1 при обязательном пробеле', () => {
  const result = applyWeatherEffects({ rainRateMmH: null, snowDepthM: 0 }, { movementRequires: ['rainRateMmH'], rules: [] });
  expect(result.status).toBe('REQUIRES_REVIEW');
  expect(result.unknown).toEqual(['rainRateMmH']);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/weather-effects.test.ts`
Expected: FAIL, профиль влияния отсутствует.

- [ ] **Step 3: Реализовать версионные правила**

```ts
export function applyWeatherEffects(state: Record<string, number | null>, profile: { movementRequires: string[]; rules: unknown[] }) {
  const unknown = profile.movementRequires.filter(key => state[key] === null || state[key] === undefined);
  if (unknown.length) return { status: 'REQUIRES_REVIEW' as const, unknown, factors: {} };
  return { status: 'CALCULATED' as const, unknown: [], factors: {} };
}
```

Каждое правило имеет единицы, диапазон, источник/допущение, класс движения и поведение вне области. До утверждения профиля разрешён только явно названный режим «без учёта погодного влияния» в паспорте допущений. Парные тесты фиксируют изменение только погодного входа.

- [ ] **Step 4: Проверить границы и версии**

Run: `npx vitest run packages/kshvi/tests/weather-effects.test.ts packages/kshvi/tests/model.test.ts`
Expected: PASS; отсутствующий показатель блокирует обязательный расчёт, старый профиль остаётся воспроизводимым.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/environment packages/kshvi/data packages/kshvi/tests
git commit -m "КШВИ: добавить проверяемые профили погодного влияния"
```

### Task 9: Динамические леса, болота, дороги, реки, мосты и переправы

**Files:** Create `packages/kshvi/src/terrain/types.ts`, `terrain-engine.ts`, `route-graph.ts`, `crossing-queue.ts`; Create `packages/kshvi/data/profiles/terrain-hydrology.json`; Test `packages/kshvi/tests/terrain.test.ts`.

**Requirements:** ENV-18–ENV-23, SIM-20, SIM-24.

**Interfaces:** Consumes погодные события Task 8 и геометрию среды; Produces `TerrainState`, `MovementClass`, `advanceTerrain`, `routeCost`, `reserveCrossing`.

- [ ] **Step 1: Написать падающие тесты классов и очереди**

```ts
import { expect, it } from 'vitest';
import { crossingDecision, routeCost } from '../src/terrain/index';

it('различает нагрузку и не откатывает пройденный путь', () => {
  expect(crossingDecision({ loadTonnes: 42 }, { capacityTonnes: 40, status: 'OPEN' })).toBe('BLOCKED');
  const route = routeCost({ remainingMeters: 8000, travelledMeters: 2000 }, { speedKph: 20, closed: false });
  expect(route).toMatchObject({ remainingMeters: 8000, travelledMeters: 2000, status: 'OPEN' });
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/terrain.test.ts`
Expected: FAIL, динамический граф отсутствует.

- [ ] **Step 3: Реализовать переходы местности**

```ts
export function crossingDecision(vehicle: { loadTonnes: number }, crossing: { capacityTonnes: number; status: string }) {
  if (crossing.status !== 'OPEN') return 'BLOCKED' as const;
  return vehicle.loadTonnes <= crossing.capacityTonnes ? 'ALLOWED' as const : 'BLOCKED' as const;
}
```

Версионные `H_v` и `G_v` обрабатывают лес, болото, покрытие, распутицу, разлив, ледостав, повреждение и восстановление. Хранить динамическую стоимость ребра, очередь и занятый интервал; маршрут пересчитывать от фактической точки. Изменения публиковать событиями с геометрией и причиной, а проекции строить по наблюдениям.

- [ ] **Step 4: Проверить все обязательные типы переправ и влияние**

Run: `npx vitest run packages/kshvi/tests/terrain.test.ts`
Expected: PASS для брода, парома, понтона, моста и ледовой переправы; закрытая дорога меняет движение, МТО, эвакуацию и агентский вход, скрытое изменение не попадает в проекцию.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/terrain packages/kshvi/data packages/kshvi/tests
git commit -m "КШВИ: реализовать динамическую местность и переправы"
```

### Task 10: Неизменяемый источник и реестр 29 документов знаков

**Files:** Create `packages/tactical-symbols/package.json`, `src/source/registry.ts`, `src/source/import-archive.ts`, `data/source-registry.json`, `tools/import-source.mjs`; Create `packages/tactical-symbols/source/TacticalSignsRussianForces.zip`; Test `packages/tactical-symbols/tests/source-registry.test.ts`.

**Requirements:** SYM-02–SYM-03, SYM-06.

**Interfaces:** Produces `SourceDocumentRecord`, `SymbolSourceFragment`, `importSourceArchive`, `coverageReport`.

- [ ] **Step 1: Написать падающий тест хеша и покрытия**

```ts
import { expect, it } from 'vitest';
import { verifyArchive, coverageReport } from '../src/source/index';

it('фиксирует исходный архив и все документы', async () => {
  expect(await verifyArchive('packages/tactical-symbols/source/TacticalSignsRussianForces.zip')).toBe('123731284d4fd3ed3c3963afe457f1cf3cdb34db500a38cdc33451ca2ddc6331');
  expect(coverageReport()).toMatchObject({ documents: 29, fonts: 2, missingDocuments: [] });
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/tactical-symbols/tests/source-registry.test.ts`
Expected: FAIL, реестр источника не создан.

- [ ] **Step 3: Реализовать воспроизводимое извлечение**

До извлечения скопировать поставленный владельцем `TacticalSignsRussianForces.zip` в `packages/tactical-symbols/source/` и проверить SHA-256 `123731284d4fd3ed3c3963afe457f1cf3cdb34db500a38cdc33451ca2ddc6331`; отсутствие архива, другое содержимое или состав не из 29 DOC и 2 TTF блокирует задачу и методическую приёмку, а не заменяется выдуманным источником. Исходный ZIP не изменять. Сохранить исходные имена, нормализованные имена, SHA-256 каждого DOC/TTF, страницу, номер знака, эталонный фрагмент и текст правила. Конвертация выполняется отдельным инструментом; runtime не вызывает DOC и не требует TTF. Реестр покрывает все тематические группы SYM-03 и явно перечисляет пробелы и неоднозначности.

- [ ] **Step 4: Проверить повторный импорт и 29 записей**

Run: `node packages/tactical-symbols/tools/import-source.mjs --check && npx vitest run packages/tactical-symbols/tests/source-registry.test.ts`
Expected: PASS; повтор не меняет хеши и не создаёт дубликаты, каждый документ имеет статус покрытия.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/tactical-symbols
git commit -m "КШВИ: зарегистрировать источник современных тактических знаков"
```

### Task 11: Параметрические векторные знаки, статусы и отрисовка

**Files:** Create `packages/tactical-symbols/src/model.ts`, `src/geometry.ts`, `src/render-svg.ts`, `src/render-maplibre.ts`, `src/registry.ts`, `data/sets/ru-modern-v1.json`; Test `packages/tactical-symbols/tests/rendering.test.ts`.

**Requirements:** SYM-04–SYM-05, SYM-08–SYM-09.

**Interfaces:** Consumes фрагменты Task 10; Produces `SymbolDefinition`, `SymbolSet`, `renderSymbol`, `symbolLayers`, `approveSymbol`.

- [ ] **Step 1: Написать падающий тест версий и геометрии**

```ts
import { expect, it } from 'vitest';
import { approveSymbol, renderSymbol } from '../src/index';

it('не утверждает непроверенный знак и сохраняет точку привязки', () => {
  expect(() => approveSymbol({ status: 'MAPPED' })).toThrow('VERIFIED');
  const svg = renderSymbol({ id: 'cp', frame: 'RECTANGLE', anchor: [0.5, 1], modifiers: [], labels: {} }, { width: 64, height: 64 });
  expect(svg).toContain('<svg');
  expect(svg).not.toContain('<image');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/tactical-symbols/tests/rendering.test.ts`
Expected: FAIL, векторная библиотека отсутствует.

- [ ] **Step 3: Реализовать типы и конечный автомат**

```ts
export function approveSymbol(symbol: { status: string }) {
  if (symbol.status !== 'VERIFIED') throw new Error('Перед APPROVED требуется VERIFIED');
  return { ...symbol, status: 'APPROVED' as const };
}
```

Определить точки, линии, площади, модификаторы, подписи и параметры переправ/дорог. Поддержать семантическое упрощение, кластеризацию с раскрытием, легенду фактически использованных версий, SVG для экспорта и MapLibre без внешних ресурсов. Переходы `IMPORTED → MAPPED → VERIFIED → APPROVED`, отдельный `DEPRECATED`, версия в каждом сценарном использовании.

- [ ] **Step 4: Проверить сложные знаки и отсутствие шрифтов**

Run: `npx vitest run packages/tactical-symbols/tests/rendering.test.ts`
Expected: PASS для пунктов управления, сил, линий, районов, разрушений, брода, паромной/понтонной/мостовой/ледяной переправы, склада, заправки и ремонта.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/tactical-symbols
git commit -m "КШВИ: добавить векторную библиотеку тактических знаков"
```

### Task 12: Самостоятельный раздел «Условные знаки»

**Files:** Create `apps/editor/src/modern/symbols/SymbolsView.tsx`, `SymbolCard.tsx`, `SymbolPreview.tsx`, `symbols-api.ts`, `symbols.css`; Modify `apps/editor/src/AppMode.tsx`; Test `apps/editor/tests/modern-symbols.test.tsx`, `apps/editor/tests/modern-symbols.spec.ts`.

**Requirements:** UI-01, SYM-01, SYM-07, SYM-10, NF-01, NF-16–NF-18.

**Interfaces:** Consumes `packages/tactical-symbols`; Produces маршрут современного режима `symbols`, поиск, карточку и команду «Вставить на карту».

- [ ] **Step 1: Написать падающий UI-тест**

```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SymbolsView } from '../src/modern/symbols/SymbolsView';

it('показывает происхождение и статус без учения', () => {
  render(<SymbolsView />);
  expect(screen.getByRole('heading', { name: 'Условные знаки' })).toBeTruthy();
  expect(screen.getByText('Источник и страница')).toBeTruthy();
  expect(screen.getByText('IMPORTED')).toBeTruthy();
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run apps/editor/tests/modern-symbols.test.tsx`
Expected: FAIL, раздел отсутствует.

- [ ] **Step 3: Реализовать справочник и навигацию**

Добавить `symbols` к `ModernSection`, не меняя `AppMode`. Реализовать поиск по названию/коду/назначению, фильтры, главы исходных документов, интерактивный SVG, исходный фрагмент, модификаторы, пример на топооснове, историю версий, покрытие и пробелы. Вставка доступна только при праве и `APPROVED`; старый набор не перерисовывается обновлением справочника.

- [ ] **Step 4: Проверить офлайн, клавиатуру и снимок**

Run: `npx vitest run apps/editor/tests/modern-symbols.test.tsx && npx playwright test apps/editor/tests/modern-symbols.spec.ts && npm run build`
Expected: PASS. Playwright 1440×900 подтверждает читаемость при 125 %, отсутствие внешних запросов и TTF; сохранить `docs/img/modern-symbols.jpg`.

- [ ] **Step 5: Зафиксировать задачу с документацией**

```bash
git add apps/editor packages/tactical-symbols docs/system.md docs/img/modern-symbols.jpg docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить самостоятельный справочник условных знаков"
```

### Task 13: Библиотека учений, навигация и клиентский API

**Files:** Create `apps/editor/src/modern/kshvi/KshviView.tsx`, `LibraryView.tsx`, `kshvi-api.ts`, `kshvi.css`; Create `services/kshvi/src/http/exercise-routes.ts`, `src/store/exercise-store.ts`; Modify `apps/editor/src/AppMode.tsx`; Test `apps/editor/tests/kshvi-library.test.tsx`, `services/kshvi/tests/exercises.test.ts`.

**Requirements:** GEN-01, ARCH-02, ARCH-06, UI-01–UI-04.

**Interfaces:** Consumes Tasks 2, 5–6; Produces `/api/kshvi/exercises`, `ExerciseClient`, раздел `kshvi` и локальный одномашинный редактор без выдачи его за сетевой сеанс.

- [ ] **Step 1: Написать падающие тесты библиотеки**

```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LibraryView } from '../src/modern/kshvi/LibraryView';

it('показывает редакцию и результат последней проверки', () => {
  render(<LibraryView items={[{ id: 'e1', title: 'Учение 1', revision: 3, state: 'DRAFT', validation: 'WARNING' }]} />);
  expect(screen.getByText('Учение 1')).toBeTruthy();
  expect(screen.getByText('Редакция 3')).toBeTruthy();
  expect(screen.getByText('Есть предупреждения')).toBeTruthy();
});
```

- [ ] **Step 2: Запустить тесты**

Run: `npx vitest run apps/editor/tests/kshvi-library.test.tsx services/kshvi/tests/exercises.test.ts`
Expected: FAIL, маршруты и компоненты отсутствуют.

- [ ] **Step 3: Реализовать сквозной срез**

Сервер поддерживает создание, поиск, фильтры, карточку, копирование, архивирование, редакции и сеансы. Клиент не применяет оптимистичный мир как официальный. Внутри КШВИ вывести «Библиотека», «Подготовка», «Проведение», «Разбор», «Архив» и скрытое по правам «Администрирование»; «Показ» появляется после Task 51. Связь с соседней картой не использует общий ключ служебных данных.

- [ ] **Step 4: Проверить изоляцию сеансов и регрессию навигации**

Run: `npx vitest run apps/editor/tests/kshvi-library.test.tsx apps/editor/tests/app-mode.test.tsx services/kshvi/tests/exercises.test.ts`
Expected: PASS; две копии имеют новые UUID, историческая навигация не изменилась.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add apps/editor/src apps/editor/tests services/kshvi docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить библиотеку и рабочую оболочку раздела"
```

---

## Этап 2 — полный сценарий, силы, МТО, документы и готовность

### Task 14: Карточка, замысел, этапы и обязательный сценарный комплект

**Files:** Create `packages/kshvi/src/scenario/concept.ts`, `scenario-kit.ts`, `stage-plan.ts`; Create `apps/editor/src/modern/kshvi/preparation/ConceptStep.tsx`, `KitStep.tsx`, `StagesStep.tsx`; Test `packages/kshvi/tests/scenario-kit.test.ts`, `apps/editor/tests/kshvi-concept.test.tsx`.

**Requirements:** PREP-01–PREP-04, CLASS-03–CLASS-04.

**Interfaces:** Consumes `Exercise` и `ScaleProfile`; Produces `ScenarioKit`, `StageDefinition`, `OperationalAssignment`, `validateKit`, `stageImpact`.

- [ ] **Step 1: Написать падающий тест комплекта**

```ts
import { expect, it } from 'vitest';
import { validateKit } from '../src/scenario/scenario-kit';

it('не разрешает молчаливо исключить обязательную МТО', () => {
  const issues = validateKit({ items: [], usesLogistics: true, omissions: [{ item: 'LOGISTICS_PLAN', reason: '' }] });
  expect(issues).toContainEqual(expect.objectContaining({ code: 'LOGISTICS_PLAN_REQUIRED', severity: 'ERROR' }));
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/scenario-kit.test.ts apps/editor/tests/kshvi-concept.test.tsx`
Expected: FAIL, конструктор замысла отсутствует.

- [ ] **Step 3: Реализовать 19 связанных частей сценария**

Карточка включает все поля PREP-01. Комплект охватывает организационные указания, календарный план, руководство, замысел, персональные оперативные задания, два плана-календаря, наращивание, карты, агентов, частные планы, связь, технику, МТО, построение, боевую готовность, оценку, исследования и паспорт допущений. Изменение этапа возвращает точный список затронутых вводных, карт, документов и критериев.

- [ ] **Step 4: Проверить персональные задания и зависимости мастера**

Run: `npx vitest run packages/kshvi/tests/scenario-kit.test.ts apps/editor/tests/kshvi-concept.test.tsx`
Expected: PASS; общий замысел не публикуется всем обучаемым, сохранение формы не означает готовность шага.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/scenario packages/kshvi/tests apps/editor/src/modern/kshvi apps/editor/tests
git commit -m "КШВИ: реализовать замысел и полный сценарный комплект"
```

### Task 15: Дерево инстанций, силы, ресурсы и источники управления

**Files:** Create `packages/kshvi/src/forces/command-tree.ts`, `force.ts`, `capability.ts`; Create `apps/editor/src/modern/kshvi/preparation/CommandTreeStep.tsx`, `ForcesStep.tsx`; Test `packages/kshvi/tests/command-tree.test.ts`.

**Requirements:** ORG-01–ORG-08, AUTO-16.

**Interfaces:** Produces `CommandNode`, `Force`, `ControlSource`, `validateCommandTree`, `requiredIntermediaries`, `capabilityFactors`.

- [ ] **Step 1: Написать падающий тест дерева**

```ts
import { expect, it } from 'vitest';
import { validateCommandTree } from '../src/forces/command-tree';

it('находит цикл и незакрытый активный стык', () => {
  const issues = validateCommandTree({ nodes: [{ id: 'a', parentId: 'b', trained: true }, { id: 'b', parentId: 'a', trained: true }], edges: [{ from: 'a', to: 'b', active: true, playRole: null }] });
  expect(issues.map(x => x.code)).toEqual(expect.arrayContaining(['COMMAND_CYCLE', 'PLAY_ROLE_REQUIRED']));
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/command-tree.test.ts`
Expected: FAIL, дерево управления отсутствует.

- [ ] **Step 3: Реализовать модель дерева и силы**

Поддержать командные, штабные, подчинённые, вышестоящие, соседние и взаимодействующие связи с периодом и полномочиями. Источник каждой инстанции — `HUMAN`, `SCRIPT`, `PLAYBOOK`, `AGENT` или разрешённый `HYBRID`. Сила хранит состав, факт/штат, положение, ресурсы, технику, МПС, готовность и неопределённость раздельно; агрегирование не скрывает `UNKNOWN` и не дублирует факторы.

- [ ] **Step 4: Проверить каскад и отложенное подключение**

Run: `npx vitest run packages/kshvi/tests/command-tree.test.ts apps/editor/tests/kshvi-concept.test.tsx`
Expected: PASS; подтверждение вышестоящей инстанции не доставляет документ нижестоящей, нижняя инстанция может подключиться после задачи.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/forces packages/kshvi/tests apps/editor/src/modern/kshvi apps/editor/tests
git commit -m "КШВИ: добавить дерево инстанций и модель сил"
```

### Task 16: Прямое «Добавить в КШВИ» из современной базы знаний

**Files:** Create `packages/kshvi/src/forces/modern-import.ts`; Create `services/kshvi/src/http/force-routes.ts`; Create `apps/editor/src/modern/kshvi/preparation/KnowledgeImportDialog.tsx`; Modify `apps/editor/src/modern/ModernKnowledgeView.tsx`; Test `packages/kshvi/tests/modern-import.test.ts`, `apps/editor/tests/kshvi-knowledge-import.test.tsx`.

**Requirements:** ORG-12–ORG-13, PREP-01–PREP-02.

**Interfaces:** Consumes `ModernUnit`, `HierarchyTemplate`, `ModernRepresentative` и их хеши; Produces `ModernKnowledgeImport`, `previewModernImport`, `commitModernImport`.

- [ ] **Step 1: Написать падающий тест сценарной копии**

```ts
import { expect, it } from 'vitest';
import { previewModernImport } from '../src/forces/modern-import';

it('сохраняет справочные ограничения и неизвестные поля', () => {
  const result = previewModernImport({ sourceRecordId: 'unit-1', sourceRevision: 4, sourceHash: 'abc', modelInputs: false, simulationValidated: false, characteristics: [{ field: 'speed', value: null }] });
  expect(result.status).toBe('IMPORTED');
  expect(result.unknown).toEqual(['speed']);
  expect(result.modelInputs).toBe(false);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/modern-import.test.ts apps/editor/tests/kshvi-knowledge-import.test.tsx`
Expected: FAIL, импорт отсутствует.

- [ ] **Step 3: Реализовать предпросмотр и импорт**

Пользователь выбирает записи, сторону и родителя; система показывает дерево, оснащение, источники, области и пробелы. Создаются новые UUID, `sourceRecordId`, редакция/хеш, протокол полей и статусы `IMPORTED/REVIEWED/APPROVED`. Исходный корпус не изменяется; сценарное значение требует источника/допущения. Обязательный пробел блокирует соответствующий расчёт.

- [ ] **Step 4: Проверить обе точки входа и неизменность корпуса**

Run: `npx vitest run packages/kshvi/tests/modern-import.test.ts apps/editor/tests/kshvi-knowledge-import.test.tsx apps/editor/tests/modern-knowledge-view.test.tsx`
Expected: PASS; команда доступна из базы и конструктора, повторный импорт создаёт отдельную сценарную копию.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi services/kshvi apps/editor docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: подключить силы современной базы знаний"
```

### Task 17: Техническая оснащённость, состояния и ремонтные переходы

**Files:** Create `packages/kshvi/src/forces/equipment.ts`, `equipment-editor.ts`, `equipment-state.ts`; Create `apps/editor/src/modern/kshvi/preparation/EquipmentStep.tsx`; Test `packages/kshvi/tests/equipment.test.ts`, `apps/editor/tests/kshvi-equipment.test.tsx`.

**Requirements:** ORG-09–ORG-11, SIM-19, SIM-24.

**Interfaces:** Produces `EquipmentHolding`, `EquipmentState`, `allocateEquipment`, `transitionEquipment`, `equipmentCapabilities`.

- [ ] **Step 1: Написать падающий парный тест**

```ts
import { expect, it } from 'vitest';
import { equipmentCapabilities, transitionEquipment } from '../src/forces/equipment-state';

it('неисправность реально ограничивает возможность', () => {
  expect(equipmentCapabilities({ type: 'pontoon', serviceable: 0, degraded: 1 })).not.toContain('CROSSING_BUILD');
  expect(transitionEquipment({ state: 'SERVICEABLE' }, { to: 'UNDER_REPAIR', causeId: 'fault-1' })).toMatchObject({ state: 'UNDER_REPAIR', causeId: 'fault-1' });
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/equipment.test.ts apps/editor/tests/kshvi-equipment.test.tsx`
Expected: FAIL, ведомость оснащённости отсутствует.

- [ ] **Step 3: Реализовать штат/факт и автомат состояний**

Поддержать агрегированный и поштучный учёт, экипаж, ресурсы, массу/габариты, ёмкость и допустимые задачи. Распределение между подчинёнными сохраняет сумму и не создаёт двойной учёт. Разрешить `SERVICEABLE ↔ DEGRADED ↔ UNDER_REPAIR → SERVICEABLE` и переходы в `DAMAGED/DESTROYED`; каждый переход имеет причину, ресурсы и событие, исходная ведомость не перезаписывается.

- [ ] **Step 4: Проверить импорт, ремонт и влияние на задачу**

Run: `npx vitest run packages/kshvi/tests/equipment.test.ts apps/editor/tests/kshvi-equipment.test.tsx`
Expected: PASS; табличный импорт/экспорт, групповой предпросмотр, неизвестные и контроль сумм работают; повторная задача после ремонта использует новое состояние.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/forces packages/kshvi/tests apps/editor/src/modern/kshvi apps/editor/tests
git commit -m "КШВИ: добавить техническую оснащённость и ремонтные состояния"
```

### Task 18: Динамическое МПС с доказанным влиянием на учение

**Files:** Create `packages/kshvi/src/forces/morale.ts`, `morale-effects.ts`, `morale-projection.ts`; Create `packages/kshvi/data/profiles/morale-v1.json`; Test `packages/kshvi/tests/morale.test.ts`, `morale-sensitivity.test.ts`.

**Requirements:** MPS-01–MPS-08, SIM-18, SIM-24.

**Interfaces:** Produces `MoralePsychState`, `MoraleImpact`, `advanceMorale`, `applyMoraleToTask`, `projectMorale`.

- [ ] **Step 1: Написать падающий пороговый тест**

```ts
import { expect, it } from 'vitest';
import { applyMoraleToTask } from '../src/forces/morale-effects';

it('изменяет обработку приказа только за счёт МПС', () => {
  const base = { readiness: 1, equipment: 1, resources: 1, fatigue: 0.2, randomKey: null };
  const high = applyMoraleToTask({ ...base, morale: { morale: 0.9, cohesion: 0.9, stress: 0.1 } });
  const low = applyMoraleToTask({ ...base, morale: { morale: 0.1, cohesion: 0.2, stress: 0.9 } });
  expect(low.orderProcessingMinutes).toBeGreaterThan(high.orderProcessingMinutes);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/morale.test.ts packages/kshvi/tests/morale-sensitivity.test.ts`
Expected: FAIL, МПС отсутствует.

- [ ] **Step 3: Реализовать ограниченные переходы и восстановление**

`MoralePsychState` содержит шесть компонентов, версионную шкалу и неопределённость. Воздействия применяются по `eventId` один раз; `Clamp_v` ограничивает шкалу, интервал и обратную связь. МПС влияет на обработку приказа, задачу, движение, донесения и агентский выбор по явному профилю. Отдых, связь, снабжение и поддержка восстанавливают через время и ресурсы. Истина и оценка инстанции разделены; реальные участники не диагностируются.

- [ ] **Step 4: Проверить парную чувствительность и отсутствие двойного учёта**

Run: `npx vitest run packages/kshvi/tests/morale.test.ts packages/kshvi/tests/morale-sensitivity.test.ts`
Expected: PASS; различается только МПС, причинная цепь меняет срок/исполнение/выбор, улучшение только МПС не ухудшает монотонный показатель.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/forces packages/kshvi/data packages/kshvi/tests
git commit -m "КШВИ: реализовать влияющее морально-психологическое состояние"
```

### Task 19: Явный этап обеспечения сценарной боевой готовности

**Files:** Create `packages/kshvi/src/forces/readiness.ts`, `readiness-stage.ts`; Create `apps/editor/src/modern/kshvi/preparation/ReadinessStep.tsx`; Test `packages/kshvi/tests/readiness.test.ts`.

**Requirements:** PREP-16–PREP-18, SIM-19, SIM-24.

**Interfaces:** Produces `ReadinessState`, `ReadinessActivity`, `advanceReadiness`, `authorizePartialReadiness`, `assertReadyForTask`.

- [ ] **Step 1: Написать падающий тест различия SEALED и готовности сил**

```ts
import { expect, it } from 'vitest';
import { assertReadyForTask } from '../src/forces/readiness';

it('SEALED не отменяет незавершённую готовность', () => {
  const result = assertReadyForTask({ scenarioState: 'SEALED', readiness: 'PARTIAL', missing: ['SIGNAL_NOT_RECEIVED'], allowPartial: false });
  expect(result).toMatchObject({ allowed: false, missing: ['SIGNAL_NOT_RECEIVED'] });
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/readiness.test.ts`
Expected: FAIL, этап готовности отсутствует.

- [ ] **Step 3: Реализовать мероприятия и состояния**

Этап имеет сигнал, сроки, исполнителей, доклады и критерии. Мероприятия охватывают оповещение, укомплектование, технику, районы, пункты управления, связь, запасы, выдвижение, инженерную подготовку и взаимодействие. Поддержать `NOT_STARTED/IN_PROGRESS/READY/PARTIAL/FAILED`; разрешение частичной готовности — отдельное официальное решение, не стирающее ограничения.

- [ ] **Step 4: Проверить сохранение последствий в первом приказе**

Run: `npx vitest run packages/kshvi/tests/readiness.test.ts packages/kshvi/tests/morale-sensitivity.test.ts`
Expected: PASS; неполученный сигнал, недокомплект, неисправность, запасы, район и связь влияют после перехода по профилю.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/forces packages/kshvi/tests apps/editor/src/modern/kshvi apps/editor/tests
git commit -m "КШВИ: выделить этап обеспечения боевой готовности"
```

### Task 20: Ресурсный журнал, непрерывное МТО, поставки и баланс

**Files:** Create `packages/kshvi/src/logistics/ledger.ts`, `supply-request.ts`, `supply-movement.ts`, `repair.ts`, `balance.ts`; Create `apps/editor/src/modern/kshvi/preparation/LogisticsStep.tsx`; Test `packages/kshvi/tests/logistics.test.ts`, `supply-balance.test.ts`.

**Requirements:** LOG-01–LOG-08, SIM-05–SIM-06, SIM-21, SIM-24.

**Interfaces:** Consumes маршруты Task 9 и технику Task 17; Produces `ResourceLedgerEntry`, `SupplyNode`, `SupplyMovement`, `advanceSupply`, `resourceBalance`, `requestRepair`.

- [ ] **Step 1: Написать падающий тест сохранения ресурса**

```ts
import { expect, it } from 'vitest';
import { resourceBalance } from '../src/logistics/balance';

it('учитывает груз в пути без создания и потери ресурса', () => {
  const balance = resourceBalance({ initial: 100, received: 20, onHand: 70, inTransit: 30, consumed: 15, lost: 5 });
  expect(balance.expected).toBe(120);
  expect(balance.actual).toBe(120);
  expect(balance.balanced).toBe(true);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/logistics.test.ts packages/kshvi/tests/supply-balance.test.ts`
Expected: FAIL, МТО отсутствует.

- [ ] **Step 3: Реализовать полную цепочку**

Поддержать потребность → заявку → приказ → выделение → подготовку → погрузку → движение → разгрузку → подтверждение → донесение. Списание, запас в пути и поступление связаны одной поставкой; отмена после отправки не телепортирует груз. Проверять ёмкость транспорта, склада, дороги и переправы, частичную поставку, дефицит, приоритет, ремонт и эвакуацию. Проводки идемпотентны, неизвестное не равно нулю.

- [ ] **Step 4: Проверить задержку, ремонт и реплей баланса**

Run: `npx vitest run packages/kshvi/tests/logistics.test.ts packages/kshvi/tests/supply-balance.test.ts`
Expected: PASS по каждой номенклатуре; задержка подвоза меняет задачу по профилю, одна единица не одновременно исправна в задаче и находится на ремонте.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/logistics packages/kshvi/tests apps/editor/src/modern/kshvi apps/editor/tests
git commit -m "КШВИ: реализовать непрерывное материально-техническое обеспечение"
```

---

### Task 21: Оперативное построение, движение и исполнение задач

**Files:** Create `packages/kshvi/src/forces/formation.ts`, `formation-validation.ts`; Create `packages/kshvi/src/simulation/movement.ts`, `task-execution.ts`; Create `apps/editor/src/modern/kshvi/preparation/FormationStep.tsx`; Test `packages/kshvi/tests/formation.test.ts`, `movement.test.ts`.

**Requirements:** ORG-14–ORG-16, SIM-07–SIM-08, SIM-24.

**Interfaces:** Consumes Tasks 9, 17–20; Produces `FormationPlan`, `RouteProgress`, `TaskExecution`, `validateFormation`, `advanceMovement`, `advanceTask`.

- [ ] **Step 1: Написать падающий тест остатка пути**

```ts
import { expect, it } from 'vitest';
import { advanceMovement } from '../src/simulation/movement';

it('сохраняет пройденный путь при изменении скорости', () => {
  const next = advanceMovement({ routeLengthMeters: 10000, remainingMeters: 6000, travelledMeters: 4000, delayMinutes: 0 }, { speedKph: 30, terrainFactor: 0.5, weatherFactor: 0.8, stateFactor: 1, hours: 1 });
  expect(next.remainingMeters).toBe(0);
  expect(next.travelledMeters).toBe(10000);
  expect(next.arrived).toBe(true);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/formation.test.ts packages/kshvi/tests/movement.test.ts`
Expected: FAIL, построение и движение отсутствуют.

- [ ] **Step 3: Реализовать план и исполнение**

`FormationPlan` задаёт эшелоны, колонны, резервы, районы, рубежи, пункты управления, маршруты и сроки. Валидатор отличает сложное допустимое построение от невозможного по назначению, площади, дороге, переправе, транспорту, запасам и связи. Движение использует только утверждённые коэффициенты; при пробеле — `REQUIRES_REVIEW`. Изменение приказа действует после получения, затраченное время/ресурсы не отменяются.

- [ ] **Step 4: Проверить частичное построение и конкуренцию маршрутов**

Run: `npx vitest run packages/kshvi/tests/formation.test.ts packages/kshvi/tests/movement.test.ts packages/kshvi/tests/terrain.test.ts`
Expected: PASS; сила остаётся на фактическом участке до прибытия, МПС/техника/местность/погода/МТО могут задержать или сорвать задачу.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/forces packages/kshvi/src/simulation packages/kshvi/tests apps/editor/src/modern/kshvi
git commit -m "КШВИ: добавить оперативное построение и исполнение движения"
```

### Task 22: Версионная карта исходной обстановки и приватные проекции

**Files:** Create `packages/kshvi/src/scenario/initial-map.ts`, `initial-map-validation.ts`; Create `apps/editor/src/modern/kshvi/preparation/InitialMapStep.tsx`, `InitialMapLayers.tsx`, `initial-map-import.ts`; Test `packages/kshvi/tests/initial-map.test.ts`, `apps/editor/tests/kshvi-initial-map.test.tsx`.

**Requirements:** PREP-13–PREP-15, ENV-12–ENV-15, ROLE-03–ROLE-06.

**Interfaces:** Consumes `EnvironmentSnapshot`, `SymbolSet`, дерево и силы; Produces `InitialSituationMap`, `MapMarker`, `importInitialMap`, `validateInitialMap`, `projectInitialMap`.

- [ ] **Step 1: Написать падающий тест ошибок нанесения**

```ts
import { expect, it } from 'vitest';
import { validateInitialMap } from '../src/scenario/initial-map-validation';

it('не подставляет координаты и проверяет мост', () => {
  const issues = validateInitialMap({ forces: [{ id: 'f1', position: null }], routes: [{ id: 'r1', loadTonnes: 42, crossingCapacityTonnes: 40 }], bounds: [0, 0, 1, 1] });
  expect(issues.map(x => x.code)).toEqual(expect.arrayContaining(['POSITION_UNKNOWN', 'CROSSING_OVERLOAD']));
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/initial-map.test.ts apps/editor/tests/kshvi-initial-map.test.tsx`
Expected: FAIL, редактор карты отсутствует.

- [ ] **Step 3: Реализовать десять шагов подготовки карты**

Редактор наносит силы, пункты управления, связь, МТО, медицинские/ремонтные объекты, районы, рубежи, колонны, маршруты, препятствия и переправы. Каждая отметка имеет геометрию, источник, автора, период, `OBSERVED/ASSUMED/PLANNED/UNKNOWN`, неопределённость, видимость и связь. Поддержать GeoJSON, внутренний JSON, копирование, групповое смещение, масштабы и отдельные проекции инстанций; утверждение включает хеш в начальный мир.

- [ ] **Step 4: Проверить проекции, импорт и печатную легенду**

Run: `npx vitest run packages/kshvi/tests/initial-map.test.ts apps/editor/tests/kshvi-initial-map.test.tsx`
Expected: PASS; истинное и донесённое положение различаются, объект вне области и несовместимые районы блокируются, символы и слои совпадают в реплее/PDF.

- [ ] **Step 5: Зафиксировать задачу со снимком**

```bash
git add packages/kshvi apps/editor services/kshvi docs/system.md docs/img/modern-kshvi-initial-map.jpg docs/system.pdf docs/system.docx
git commit -m "КШВИ: реализовать подготовку карты исходной обстановки"
```

### Task 23: Единый документооборот и неизменяемые подписанные редакции

**Files:** Create `packages/kshvi/src/documents/document.ts`, `document-lifecycle.ts`, `document-validation.ts`; Create `services/kshvi/src/http/document-routes.ts`, `src/store/document-store.ts`; Create `apps/editor/src/modern/kshvi/documents/DocumentEditor.tsx`; Test `packages/kshvi/tests/document-lifecycle.test.ts`, `services/kshvi/tests/documents.test.ts`.

**Requirements:** DOC-01–DOC-05, DOC-16.

**Interfaces:** Produces `Document`, `DocumentRevision`, `ApprovalSignature`, `transitionDocument`, `supersedeDocument`, `assertDocumentReady`.

- [ ] **Step 1: Написать падающий тест подписи**

```ts
import { expect, it } from 'vitest';
import { supersedeDocument, transitionDocument } from '../src/documents/document-lifecycle';

it('не перезаписывает подписанную редакцию', () => {
  const approved = transitionDocument({ state: 'IN_REVIEW', sha256: 'old' }, 'APPROVE');
  expect(approved.state).toBe('APPROVED');
  const next = supersedeDocument(approved, { reason: 'уточнение', sha256: 'new' });
  expect(next.supersedes).toBe('old');
  expect(approved.state).toBe('APPROVED');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/document-lifecycle.test.ts services/kshvi/tests/documents.test.ts`
Expected: FAIL, жизненный цикл документа отсутствует.

- [ ] **Step 3: Реализовать реквизиты и состояния**

Документ содержит структуру, текст, карту, вложения, адресатов, канал, основание, связи, маршрут и хеш. Поддержать `DRAFT → IN_REVIEW → APPROVED → ISSUED`, отдельные `DELIVERED/ACKNOWLEDGED/EXECUTION_STARTED`, `SUPERSEDED/CANCELLED` и возврат с замечаниями. Подпись фиксирует пользователя, роль, момент, редакцию и SHA-256; внешняя криптоподпись — отдельный необязательный объект.

- [ ] **Step 4: Проверить конфликт ревизий и видимость вложений**

Run: `npx vitest run packages/kshvi/tests/document-lifecycle.test.ts services/kshvi/tests/documents.test.ts`
Expected: PASS; устаревшая `expectedRevision` даёт 409, выдача с данными вне видимости блокируется, прежние подписи остаются.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/documents services/kshvi apps/editor docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить версионный документооборот и подписи"
```

### Task 24: Шаблоны, автозаполнение и локальные PDF/DOCX/JSON

**Files:** Create `packages/kshvi/src/documents/template.ts`, `template-fill.ts`; Create `services/kshvi/src/documents/export-pdf.ts`, `export-docx.ts`, `export-json.ts`, `templates/`; Test `services/kshvi/tests/document-export.test.ts`.

**Requirements:** DOC-06–DOC-09, NF-01, NF-16–NF-18, NF-21.

**Interfaces:** Consumes редакцию Task 23, снимок среды и знаки; Produces `DocumentTemplate`, `fillTemplate`, `exportDocument`, `verifyExportSet`.

- [ ] **Step 1: Написать падающий тест единого содержания**

```ts
import { expect, it } from 'vitest';
import { exportDocument } from '../src/documents/export-json';

it('экспорт содержит редакцию, легенду и атрибуцию', async () => {
  const result = await exportDocument({ id: 'd1', revision: 2, title: 'Приказ', operationalAt: '2030-01-01T06:00:00+03:00', legend: ['cp:v1'], attribution: ['OSM'] });
  expect(result.schemaVersion).toBe(1);
  expect(result.source.revision).toBe(2);
  expect(result.legend).toEqual(['cp:v1']);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run services/kshvi/tests/document-export.test.ts`
Expected: FAIL, генераторы отсутствуют.

- [ ] **Step 3: Реализовать двенадцать типов шаблонов**

Создать приказ, распоряжение, директиву, план, донесение, доклад, заявку, разведсводку, оперативное задание, вводную, журнал дежурного, лист оценки и материалы разбора. Автозаполнение использует только разрешённую проекцию и остаётся проектом. PDF/DOCX/JSON формируются локально с единым источником, реквизитами, временем, единицами, атрибуцией, легендой, нумерацией и хешем; бумажный обмен вносится отдельными фактами.

- [ ] **Step 4: Проверить открытие файлов без сети**

Run: `npx vitest run services/kshvi/tests/document-export.test.ts && node scripts/kshvi-check-document-export.mjs`
Expected: PASS; PDF/DOCX валидны, содержательные блоки совпадают с JSON, повторная генерация отличается только явной метадатой экспорта.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/documents services/kshvi/src/documents services/kshvi/tests scripts/kshvi-check-document-export.mjs
git commit -m "КШВИ: добавить автономные печатные и машинные документы"
```

### Task 25: Двойная вертикаль, маршруты согласования и каскадная выдача

**Files:** Create `packages/kshvi/src/documents/approval-router.ts`, `dual-chain.ts`, `cascade.ts`; Create `apps/editor/src/modern/kshvi/documents/ApprovalPanel.tsx`; Test `packages/kshvi/tests/approval-router.test.ts`, `cascade.test.ts`.

**Requirements:** DOC-10–DOC-16, ORG-03.

**Interfaces:** Consumes Tasks 23–24 и дерево Task 15; Produces `ApprovalRoute`, `RouteDecision`, `CascadeDelivery`, `advanceApproval`, `issueCascade`.

- [ ] **Step 1: Написать падающий тест разногласия**

```ts
import { expect, it } from 'vitest';
import { advanceApproval } from '../src/documents/dual-chain';

it('не заменяет общее согласование согласием одной ветви', () => {
  const result = advanceApproval({ command: 'APPROVED', service: 'CHANGES_REQUESTED' }, { actor: 'commander', decision: 'APPROVED' });
  expect(result.state).toBe('CONFLICT');
  expect(result.finalApprover).toBe('designatedAuthority');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/approval-router.test.ts packages/kshvi/tests/cascade.test.ts`
Expected: FAIL, маршруты отсутствуют.

- [ ] **Step 3: Реализовать настраиваемые маршруты**

Поддержать последовательное/параллельное согласование, обязательные/совещательные подписи, замещение, делегирование, сроки, напоминания, возврат и эскалацию. Командная и функциональная ветви не взаимозаменяются; конфликт разрешает назначенная инстанция. Каждое плечо каскада имеет собственные сообщение, задержку, подтверждение и ретранслятор; получение не равно согласию или исполнению.

- [ ] **Step 4: Проверить частичную доставку и ошибки адресации**

Run: `npx vitest run packages/kshvi/tests/approval-router.test.ts packages/kshvi/tests/cascade.test.ts services/kshvi/tests/documents.test.ts`
Expected: PASS; ретрансляция ссылается на исходную редакцию, нижестоящая инстанция не получает документ автоматически.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/documents packages/kshvi/tests apps/editor/src/modern/kshvi services/kshvi
git commit -m "КШВИ: реализовать двойную вертикаль и каскад документов"
```

### Task 26: Имитация связи, отказы, дубликаты и табель донесений

**Files:** Create `packages/kshvi/src/communications/channel.ts`, `message.ts`, `failure-model.ts`, `report-schedule.ts`, `paper-exchange.ts`; Test `packages/kshvi/tests/communications.test.ts`, `report-schedule.test.ts`.

**Requirements:** COM-01–COM-10, DOC-09.

**Interfaces:** Produces `Channel`, `Message`, `MessageAttempt`, `routeMessage`, `advanceMessage`, `applyFailure`, `checkReportDeadline`, `recordPaperExchange`.

- [ ] **Step 1: Написать падающий тест идемпотентного доменного эффекта**

```ts
import { expect, it } from 'vitest';
import { deliverAttempt } from '../src/communications/message';

it('показывает дубликат доставки, но не дублирует приказ', () => {
  const first = deliverAttempt({ messageId: 'm1', attempt: 1, domainKey: 'order-1', appliedDomainKeys: [] });
  const second = deliverAttempt({ ...first, attempt: 2, appliedDomainKeys: first.appliedDomainKeys });
  expect(second.duplicate).toBe(true);
  expect(second.appliedDomainKeys).toEqual(['order-1']);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/communications.test.ts packages/kshvi/tests/report-schedule.test.ts`
Expected: FAIL, транспорт сообщений отсутствует.

- [ ] **Step 3: Реализовать каналы и жизненный цикл**

Канал содержит узлы, направление, ёмкость, задержку, приоритет, резерв и период. Поддержать `queued/inTransit/delivered/failed/cancelled`, повторные попытки, потерю, дублирование, частичную доставку, деградацию и восстановление. Каждый сбой имеет учебный вопрос и правило обхода. Табель различает неизвестное событие, неотправленное и недоставленное донесение; напоминание не создаёт содержание.

- [ ] **Step 4: Проверить резерв, ёмкость и бумажный резерв**

Run: `npx vitest run packages/kshvi/tests/communications.test.ts packages/kshvi/tests/report-schedule.test.ts`
Expected: PASS; отказ узла влияет только на зависимые маршруты, приоритет не вытесняет начатую передачу, ручной обмен не создаёт скрытый приказ.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/communications packages/kshvi/tests services/kshvi apps/editor/src/modern/kshvi
git commit -m "КШВИ: реализовать имитацию связи и донесений"
```

### Task 27: Полная валидация, персональные подтверждения, репетиция и SEALED

**Files:** Create `packages/kshvi/src/scenario/validation.ts`, `readiness-checklist.ts`, `sealing.ts`, `rehearsal.ts`; Create `services/kshvi/src/http/version-routes.ts`, `src/store/version-store.ts`; Create `apps/editor/src/modern/kshvi/preparation/ValidationStep.tsx`, `RehearsalStep.tsx`; Test `packages/kshvi/tests/sealing.test.ts`, `services/kshvi/tests/versions.test.ts`.

**Requirements:** PREP-05–PREP-12, ARCH-20–ARCH-22, NF-13, UI-05–UI-06.

**Interfaces:** Consumes Tasks 7–26; Produces `ValidationIssue`, `ReadinessConfirmation`, `RehearsalReport`, `validateScenario`, `sealScenario`, `startInstance`.

- [ ] **Step 1: Написать падающий тест блокирующей ошибки**

```ts
import { expect, it } from 'vitest';
import { sealScenario } from '../src/scenario/sealing';

it('не фиксирует сценарий с ошибкой и неподтверждённым контуром', () => {
  expect(() => sealScenario({ state: 'APPROVED', issues: [{ severity: 'ERROR', code: 'MAP_INVALID' }], confirmations: [], requiredConfirmations: ['environment'] })).toThrow('MAP_INVALID');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/sealing.test.ts services/kshvi/tests/versions.test.ts`
Expected: FAIL, фиксация отсутствует.

- [ ] **Step 3: Реализовать валидацию всех контуров**

Проверки включают структуру, дерево, среду, исходную карту, время, вводные, силы, технику/МПС/готовность, МТО/построение, автономию/агентов, знаки, связь, документы, видимость, модель и восстановление. `ERROR` блокирует; `WARNING` требует автора, основания, срока и области; нарушения видимости/хешей/снимка не принимаются предупреждением. Перед `SEALED` нужны персональные подтверждения всех контуров и сухая репетиция на копии; после изменения устаревают только зависимые подтверждения плюс обязательный интеграционный прогон.

- [ ] **Step 4: Проверить запуск только из SEALED и изоляцию репетиции**

Run: `npx vitest run packages/kshvi/tests/sealing.test.ts services/kshvi/tests/versions.test.ts`
Expected: PASS; канонический JSON, среда, карта, события, агенты, модели, роли и репетиция имеют хеши; один `SEALED` допускает несколько изолированных сеансов, повторный запуск идемпотентен.

- [ ] **Step 5: Зафиксировать задачу и контрольную точку G1**

```bash
git add packages/kshvi services/kshvi apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx docs/release/kshvi
git commit -m "КШВИ: завершить подготовку, репетицию и фиксацию сценария"
```

**Контрольная точка G1:** AC-01 в подготовительной части, AC-04 в документной части, AC-15, AC-22 и подготовительные части AC-23–AC-24/AC-26 выполнены. Это разрешение начать сетевой контур, не выпуск продукта.

---

## Этап 3 — авторитетный сетевой сеанс и полный цикл решений

### Task 28: Запуск Instance, команды и серверные проекции ролей

**Files:** Create `services/kshvi/src/instances/instance-service.ts`, `command-service.ts`, `projection-service.ts`; Create `packages/kshvi/src/projections/project.ts`, `visibility-policy.ts`; Create `services/kshvi/src/http/instance-routes.ts`, `projection-routes.ts`; Test `services/kshvi/tests/projections.test.ts`, `instance-commands.test.ts`.

**Requirements:** ARCH-02, ROLE-01–ROLE-08, GEN-05.

**Interfaces:** Consumes SEALED Task 27 и auth Task 6; Produces `startInstance`, `executeCommand`, `projectWorld`, `ParticipantProjection`.

- [ ] **Step 1: Написать падающий отрицательный тест утечки**

```ts
import { expect, it } from 'vitest';
import { projectWorld } from '../src/projections/project';

it('не возвращает истинный объект противника и будущую вводную', () => {
  const projection = projectWorld({ forces: [{ id: 'secret-force', side: 'red', position: [1, 1] }], inputs: [{ id: 'future', availableAt: 'later' }] }, { side: 'blue', role: 'TRAINEE', operationalAt: 'now', scope: 'own' });
  expect(JSON.stringify(projection)).not.toContain('secret-force');
  expect(JSON.stringify(projection)).not.toContain('future');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run services/kshvi/tests/projections.test.ts services/kshvi/tests/instance-commands.test.ts`
Expected: FAIL, Instance и проекции отсутствуют.

- [ ] **Step 3: Реализовать единый командный путь**

Запуск только из `SEALED`; каждый запрос вычисляет проекцию заново по пользователю, активной роли, стороне, инстанции, участку, времени, каналу, раскрытию и объекту. Полный мир не покидает сервис. Запретить совмещение обучаемого и руководства без явной демонстрационной метки. Прямые чужие UUID дают безопасный 403; администратор получает содержание только отдельным аудируемым правом.

- [ ] **Step 4: Проверить все каналы выдачи и отзыв роли**

Run: `npx vitest run services/kshvi/tests/projections.test.ts services/kshvi/tests/instance-commands.test.ts services/kshvi/tests/auth.test.ts`
Expected: PASS для API, поиска, вложений, реплея и экспорта; после отзыва роли старая ссылка не выдаёт данные.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/projections services/kshvi apps/editor/src/modern/kshvi
git commit -m "КШВИ: запустить авторитетный сеанс и серверные проекции"
```

### Task 29: SSE, reconnect, кэш и безопасная передача рабочего места

**Files:** Create `services/kshvi/src/http/sse.ts`, `subscription-service.ts`; Create `apps/editor/src/modern/kshvi/live/event-stream.ts`, `projection-cache.ts`, `HandoverScreen.tsx`; Test `services/kshvi/tests/sse-reconnect.test.ts`, `apps/editor/tests/kshvi-handover.test.tsx`.

**Requirements:** ARCH-15, ARCH-17–ARCH-18, NF-14, ROLE-07, UI-17–UI-19.

**Interfaces:** Produces `/instances/:id/events`, `resumeProjection`, `clearPrivilegedState`, `groupNotifications`.

- [ ] **Step 1: Написать падающий тест изменения прав во время обрыва**

```ts
import { expect, it } from 'vitest';
import { resumeProjection } from '../src/live/event-stream';

it('требует новый снимок при смене политики и пропуске sequence', async () => {
  const result = await resumeProjection({ lastSequence: 8, projectionRevision: 2 }, { minAvailableSequence: 10, policyRevision: 3, currentPolicyRevision: 4 });
  expect(result).toEqual({ kind: 'SNAPSHOT_REQUIRED', reason: 'POLICY_CHANGED' });
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run services/kshvi/tests/sse-reconnect.test.ts apps/editor/tests/kshvi-handover.test.tsx`
Expected: FAIL, поток и передача устройства отсутствуют.

- [ ] **Step 3: Реализовать серверную фильтрацию и восстановление**

До отправки сервер проверяет право и формирует отдельный payload; обобщённое уведомление не содержит скрытых UUID. Клиент передаёт `Last-Event-ID` и ревизию проекции, отбрасывает повторы, не применяет пропуски. Передача устройства показывает нейтральный экран, завершает сессию, очищает DOM, Query/IndexedDB-кэш, проектор и приватные черновики; неотправленный черновик экспортируется только явно.

- [ ] **Step 4: Проверить обрыв, «Назад» и повторный вход**

Run: `npx vitest run services/kshvi/tests/sse-reconnect.test.ts apps/editor/tests/kshvi-handover.test.tsx`
Expected: PASS; мир продолжается без клиента, показан период потери связи, прежний экран не восстанавливается историей браузера.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add services/kshvi apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить защищённый SSE и передачу рабочих мест"
```

### Task 30: Два времени, единая очередь, пауза, ускорение и транзакционный скачок

**Files:** Create `packages/kshvi/src/runtime/clock.ts`, `queue.ts`, `jump.ts`, `stop-modes.ts`; Create `services/kshvi/src/runtime/runtime-worker.ts`, `time-service.ts`; Test `packages/kshvi/tests/clock.test.ts`, `queue.test.ts`, `jump.test.ts`.

**Requirements:** RUN-01–RUN-04, RUN-08–RUN-12, ENV-08, NF-05.

**Interfaces:** Produces `OperationalClock`, `ScheduledAction`, `JumpTransaction`, `orderActions`, `executeJump`, `applyStopMode`.

- [ ] **Step 1: Написать падающий тест порядка и паузы**

```ts
import { expect, it } from 'vitest';
import { orderActions, operationalAt } from '../src/runtime/index';

it('не зависит от порядка сети и не двигает мир на паузе', () => {
  const actions = [{ operationalAt: '2030-01-01T00:00:00Z', priority: 2, dependencyOrder: 0, sequence: 9 }, { operationalAt: '2030-01-01T00:00:00Z', priority: 1, dependencyOrder: 0, sequence: 10 }];
  expect(orderActions(actions).map(x => x.sequence)).toEqual([10, 9]);
  expect(operationalAt({ anchorOperational: '2030-01-01T00:00:00Z', anchorWall: '2030-01-01T00:00:00Z', speed: 4, paused: true }, '2030-01-01T01:00:00Z')).toBe('2030-01-01T00:00:00Z');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/clock.test.ts packages/kshvi/tests/queue.test.ts packages/kshvi/tests/jump.test.ts`
Expected: FAIL, часы и очередь отсутствуют.

- [ ] **Step 3: Реализовать семь шагов скачка**

Скачок фиксирует границу решений, останавливает команды интервала, рассчитывает мир, показывает неопределённости, получает утверждение/ручные решения, создаёт снимок и возобновляет ход. Обратное официальное время запрещено. Пауза, частный/общий отбой и `ABORTED` различимы; частный отбой показывает накопленное опоздание. Все остатки, сообщения, поставки, техника, МПС, местность и причины сохраняются.

- [ ] **Step 4: Проверить повтор скачка и сдвиг часов клиента**

Run: `npx vitest run packages/kshvi/tests/clock.test.ts packages/kshvi/tests/queue.test.ts packages/kshvi/tests/jump.test.ts`
Expected: PASS; повтор не применяет эффекты дважды, погода следует оперативному времени без нового зерна, клиентские часы не меняют мир.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/runtime packages/kshvi/tests services/kshvi/src/runtime
git commit -m "КШВИ: реализовать оперативное время и транзакционный скачок"
```

### Task 31: Плановые, реактивные и адаптивные вводные, триггеры и заявки

**Files:** Create `packages/kshvi/src/runtime/input.ts`, `triggers.ts`, `delegation.ts`, `approval-request.ts`, `conflicts.ts`; Create `services/kshvi/src/runtime/input-worker.ts`; Test `packages/kshvi/tests/inputs.test.ts`, `triggers.test.ts`.

**Requirements:** RUN-05–RUN-11.

**Interfaces:** Produces `Input`, `TriggerRule`, `ApprovalRequest`, `evaluateTrigger`, `proposeInput`, `applyDelegation`, `resolveConflict`.

- [ ] **Step 1: Написать падающий тест цикла и неизвестного условия**

```ts
import { expect, it } from 'vitest';
import { evaluateTrigger, validateTriggerGraph } from '../src/runtime/triggers';

it('не считает неизвестное ложным и находит цикл', () => {
  expect(evaluateTrigger({ left: { status: 'UNKNOWN' }, operator: 'EQ', right: true })).toBe('UNRESOLVED');
  expect(validateTriggerGraph([{ id: 'a', emits: ['b'] }, { id: 'b', emits: ['a'] }])).toContainEqual(expect.objectContaining({ code: 'TRIGGER_CYCLE' }));
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/inputs.test.ts packages/kshvi/tests/triggers.test.ts`
Expected: FAIL, вводные и триггеры отсутствуют.

- [ ] **Step 3: Реализовать типы наращивания и полномочия**

Вводная хранит источник-роль, адресатов, канал, два срока, этап, основание, геометрию, видимость и отмену; скрытая и видимая копии связаны. Делегирование ограничивает типы, этапы, географию, ресурсы и последствия. Внеплановая вводная вне пределов становится заявкой. Очередь поддерживает конфликтные правила, отмену до применения, компенсацию после, фильтры, массовое согласование и пообъектный результат.

- [ ] **Step 4: Проверить досрочную выдачу, заявку и защиту от цикла**

Run: `npx vitest run packages/kshvi/tests/inputs.test.ts packages/kshvi/tests/triggers.test.ts services/kshvi/tests/projections.test.ts`
Expected: PASS; отклонение расписания журналируется, неразрешённая адаптация не действует, руководитель видит причину и diff.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/runtime packages/kshvi/tests services/kshvi/src/runtime apps/editor/src/modern/kshvi
git commit -m "КШВИ: добавить плановое и адаптивное наращивание"
```

### Task 32: Цикл решения обучаемого, плейбук и исполнение приказов

**Files:** Create `packages/kshvi/src/decisions/decision.ts`, `decision-cycle.ts`, `playbook.ts`, `order-execution.ts`; Create `apps/editor/src/modern/kshvi/conduct/DecisionEditor.tsx`, `OrdersPanel.tsx`; Test `packages/kshvi/tests/decisions.test.ts`, `playbook.test.ts`.

**Requirements:** RUN-13–RUN-18, GEN-04–GEN-05, SIM-15.

**Interfaces:** Consumes Tasks 21, 23–26, 30–31; Produces `Decision`, `Playbook`, `OrderExecution`, `evaluatePlaybook`, `issueOrder`, `advanceOrder`.

- [ ] **Step 1: Написать падающий тест непредусмотренного условия**

```ts
import { expect, it } from 'vitest';
import { evaluatePlaybook } from '../src/decisions/playbook';

it('не выдумывает действие вне плейбука', () => {
  expect(evaluatePlaybook({ rules: [{ when: 'contact', command: 'report' }] }, { kind: 'unknown' })).toEqual({ kind: 'ESCALATE', reason: 'NO_RULE' });
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/decisions.test.ts packages/kshvi/tests/playbook.test.ts`
Expected: FAIL, решения и плейбук отсутствуют.

- [ ] **Step 3: Реализовать полный цикл**

Поддержать девять элементов цикла RUN-13 без жёсткого навязывания порядка. Решение хранит цели, задачи, ресурсы, сроки, взаимодействие, резервы, условия и допущения; статусы не смешиваются. Приказ проходит доставку, обработку, подготовку, исполнение и доклад; частичное/невыполнение/отклонение имеют причины. Плейбук и системный агент имеют явную иерархию, неизвестное условие эскалируется. Завершение не объявляет победителя.

- [ ] **Step 4: Проверить отмену до/после получения и двустороннюю независимость**

Run: `npx vitest run packages/kshvi/tests/decisions.test.ts packages/kshvi/tests/playbook.test.ts services/kshvi/tests/projections.test.ts`
Expected: PASS; отмена после начала не стирает затраты, замыслы сторон не утекают, новая модель этапа назначена явно.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/decisions packages/kshvi/tests apps/editor/src/modern/kshvi services/kshvi
git commit -m "КШВИ: реализовать решения, плейбук и исполнение приказов"
```

### Task 33: Ручные, детерминированные, стохастические и гибридные расчёты

**Files:** Create `packages/kshvi/src/simulation/calculation.ts`, `deterministic.ts`, `stochastic.ts`, `aggregate.ts`, `explanation.ts`, `manual-override.ts`; Create `services/kshvi/src/http/calculation-routes.ts`; Test `packages/kshvi/tests/calculations.test.ts`, `calculation-replay.test.ts`.

**Requirements:** SIM-02–SIM-04, SIM-09–SIM-10, SIM-14–SIM-17, GEN-06–GEN-07.

**Interfaces:** Produces `Calculation`, `CalculationMode`, `calculate`, `approveCalculation`, `overrideCalculation`, `explainCalculation`.

- [ ] **Step 1: Написать падающий тест ручной замены**

```ts
import { expect, it } from 'vitest';
import { overrideCalculation } from '../src/simulation/manual-override';

it('сохраняет исходный расчёт после ручного решения', () => {
  const original = { id: 'c1', state: 'CALCULATED', result: { delay: 10 } } as const;
  const manual = overrideCalculation(original, { author: 'u1', reason: 'методическое решение', result: { delay: 15 } });
  expect(manual.supersedes).toBe('c1');
  expect(original.result.delay).toBe(10);
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/calculations.test.ts packages/kshvi/tests/calculation-replay.test.ts`
Expected: FAIL, расчётный контур отсутствует.

- [ ] **Step 3: Реализовать версионный расчётный журнал**

Поддержать `CALCULATED → APPROVED → APPLIED`, `REQUIRES_REVIEW/SUPERSEDED`. Сохранять входной хеш, причину, режим, версии, единицы, неизвестные, ключи, промежуточные результаты и события. Агрегированный эпизод меняет состояние, задачи, ресурсы, время и неопределённость, не сводится к 3:1. Объяснение не выдумывает числовые вклады. Осипов–Ланчестер/Dupuy не включать в базовый профиль; отдельный модуль допускается только со своим паспортом и проверками.

- [ ] **Step 4: Проверить повтор и запрет незаметной замены исхода**

Run: `npx vitest run packages/kshvi/tests/calculations.test.ts packages/kshvi/tests/calculation-replay.test.ts`
Expected: PASS; стохастический повтор использует сохранённый ключ, ручное решение связано с исходным и не меняет оценку автоматически.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/simulation packages/kshvi/tests services/kshvi apps/editor/src/modern/kshvi
git commit -m "КШВИ: добавить объяснимые расчёты и ручные решения"
```

### Task 34: Разведка, наблюдения, неопределённость и устаревание сведений

**Files:** Create `packages/kshvi/src/simulation/observation.ts`, `observation-merge.ts`, `observation-projection.ts`; Create `apps/editor/src/modern/kshvi/conduct/ObservationCard.tsx`; Test `packages/kshvi/tests/observations.test.ts`.

**Requirements:** SIM-11–SIM-12, ROLE-03–ROLE-06, ENV-13.

**Interfaces:** Produces `Observation`, `createObservation`, `mergeObservations`, `projectObservation`, `markStale`.

- [ ] **Step 1: Написать падающий тест скрытого идентификатора**

```ts
import { expect, it } from 'vitest';
import { projectObservation } from '../src/simulation/observation-projection';

it('не раскрывает истинный id и фактическую ошибку', () => {
  const result = projectObservation({ id: 'o1', trueForceId: 'secret', actualErrorMeters: 12, reportedAccuracyMeters: 100, observedAt: 't1' });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(JSON.stringify(result)).not.toContain('actualErrorMeters');
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run packages/kshvi/tests/observations.test.ts`
Expected: FAIL, наблюдения отсутствуют.

- [ ] **Step 3: Реализовать наблюдение вместо копии истины**

Наблюдение содержит источник, наблюдение/доставку, предполагаемую геометрию, точность, полноту, достоверность и срок. Несколько наблюдений связываются версионным правилом без удаления исходных докладов. Ошибка и задержка берутся из профиля источника и среды; устаревание помечает запись. Собственные сведения также проходят модель донесений.

- [ ] **Step 4: Проверить слияние и приватность агентов**

Run: `npx vitest run packages/kshvi/tests/observations.test.ts services/kshvi/tests/projections.test.ts`
Expected: PASS; скрытый истинный идентификатор, эталон и фактическая погрешность отсутствуют в API, SSE, поиске, реплее и агентском входе.

- [ ] **Step 5: Зафиксировать задачу**

```bash
git add packages/kshvi/src/simulation packages/kshvi/tests apps/editor/src/modern/kshvi
git commit -m "КШВИ: реализовать разведку и неопределённые наблюдения"
```

### Task 35: Рабочие места руководителя, группы, посредника, обучаемого и аналитика

**Files:** Create `apps/editor/src/modern/kshvi/conduct/LeaderWorkspace.tsx`, `PlaygroupWorkspace.tsx`, `IntermediaryWorkspace.tsx`, `TraineeWorkspace.tsx`, `AnalystWorkspace.tsx`, `ProjectorWorkspace.tsx`, `ForceStateTabs.tsx`, `shared/`; Test `apps/editor/tests/kshvi-workspaces.test.tsx`, `kshvi-projector.test.tsx`, `kshvi-workspaces.spec.ts`.

**Requirements:** UI-02–UI-03, UI-07–UI-16, UI-18–UI-19, UI-22.

**Interfaces:** Consumes все проекции Tasks 28–34; Produces шесть рабочих мест, связанные карта/лента/документы/время, аудиторные профили и вкладки состояния силы.

- [ ] **Step 1: Написать падающий тест связанной навигации**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TraineeWorkspace } from '../src/modern/kshvi/conduct/TraineeWorkspace';

it('не меняет официальные часы при просмотре прошлого', () => {
  render(<TraineeWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Просмотреть событие' }));
  expect(screen.getByText('Режим просмотра прошлого')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'К текущему времени' })).toBeTruthy();
});
```

- [ ] **Step 2: Запустить тест**

Run: `npx vitest run apps/editor/tests/kshvi-workspaces.test.tsx apps/editor/tests/kshvi-projector.test.tsx`
Expected: FAIL, рабочие места отсутствуют.

- [ ] **Step 3: Реализовать полный интерфейс ролей**

Руководитель получает этап, два времени, истина/эталон/факт, отклонения, заявки, состояние и критические команды с последствиями. Группа — очередь, план, карту, дерево, связь и причинные связи. Посредник — только участок и полномочия. Обучаемый — личную проекцию, решения и исполнение без служебных материалов. Аналитик — доказательства и перспективы. Проектор требует явной аудитории. Вкладки силы: оснащённость, МПС, готовность, построение, МТО.

- [ ] **Step 4: Проверить состояния, клавиатуру и проектор**

Run: `npx vitest run apps/editor/tests/kshvi-workspaces.test.tsx apps/editor/tests/kshvi-projector.test.tsx && npx playwright test apps/editor/tests/kshvi-workspaces.spec.ts && npm run build`
Expected: PASS; различаются загрузка, пусто, нет прав, нет данных, устарело, частичный и полный сбой; Playwright проверяет 1440×900, 125 % и 1920×1080.

- [ ] **Step 5: Зафиксировать задачу со снимками всех рабочих мест**

```bash
git add apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: реализовать рабочие места всех участников"
```

### Task 36: Интеграционный контур официального проведения

**Files:** Create `services/kshvi/tests/e2e/conduct-cycle.test.ts`, `apps/editor/tests/kshvi-conduct-cycle.test.tsx`, `scripts/kshvi-run-acceptance.mjs`; Create `docs/release/kshvi/g2-conduct.json`.

**Requirements:** интеграция GEN-01–GEN-07, CLASS-01–CLASS-04, ARCH-01–ARCH-23, PREP-01–PREP-18, RUN-01–RUN-18.

**Interfaces:** Consumes Tasks 1–35; Produces воспроизводимый сценарий G2 и доказательства AC-01, AC-03–AC-07, AC-09, AC-11, AC-15, AC-18.

- [ ] **Step 1: Написать падающий сквозной сценарий**

Сценарий запускает реальные PostgreSQL, картографию, шлюз и КШВИ; создаёт двустороннее трёхступенчатое учение, фиксирует среду, проходит документы, запускает независимые решения, паузу/скачок, связь и исполнение. Тест должен падать, если любой шаг подменён прямой записью результата в БД.

- [ ] **Step 2: Запустить сценарий до интеграционных исправлений**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/kshvi_test npx vitest run services/kshvi/tests/e2e/conduct-cycle.test.ts`
Expected: FAIL на первом незамкнутом контракте; зафиксировать конкретный разрыв, не ослаблять ожидания.

- [ ] **Step 3: Замкнуть интеграцию без изменения требований**

Каждое исправление выполняется в модуле-владельце и получает регрессионный тест. Проверить независимые сеансы одной редакции, отсутствие телепортации/создания ресурсов, частичное исполнение, ручную замену с сохранением исходного расчёта и отсутствие автоматического победителя.

- [ ] **Step 4: Повторить полный связанный набор**

Run: `npx vitest run services/kshvi/tests apps/editor/tests/kshvi-conduct-cycle.test.tsx && npm run typecheck 2>&1 | tail -3`
Expected: PASS; журнал и хеши приложены к `g2-conduct.json`.

- [ ] **Step 5: Зафиксировать контрольную точку G2**

```bash
git add packages services apps/editor scripts docs/release/kshvi docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: замкнуть полный сетевой цикл официального учения"
```

**Контрольная точка G2:** доказан сетевой `CONDUCT`, но автономия, архив, эксплуатационная готовность и экспозиция ещё не дают основания для релиза.

---

## Этап 4 — самостоятельное наращивание, электронный посредник и системный противник

### Task 37: Версионная схема `EventTemplate` и строгий валидатор событий

**Files:** Create `packages/kshvi-events/src/model/event-template.ts`, `event-effect.ts`, `template-schema.ts`, `validate-template.ts`, `catalog-manifest.ts`; Create `packages/kshvi-events/schemas/event-template.schema.json`; Test `packages/kshvi-events/tests/template-validation.test.ts`, `template-schema.test.ts`, `fixtures/valid-template.ts`.

**Requirements:** AUTO-02–AUTO-03, AUTO-07, PREP-09–PREP-10, NF-19.

**Interfaces:** Produces `EventTemplate`, `EventEffect`, `EventCategory`, `CatalogManifest`, `validateEventTemplate`, `validateCatalogManifest`; шаблон содержит только данные и идентификаторы типизированных операций, но не исполняемый код.

- [ ] **Step 1: Написать падающие тесты неизвестной операции и неизвестного предусловия**

```ts
import { expect, it } from 'vitest';
import { validateEventTemplate } from '../src/validate-template';
import { validTemplate } from './fixtures/valid-template';

it('отклоняет произвольную операцию и функцию в данных', () => {
  const unknown = { ...validTemplate, effects: [{ type: 'executeJavaScript', source: 'world = {}' }] };
  expect(validateEventTemplate(unknown).issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_EFFECT' }));
  expect(validateEventTemplate({ ...validTemplate, predicate: () => true }).valid).toBe(false);
});
```

Добавить фикстуру полного валидного шаблона и отдельные случаи: неизвестная единица, обратный диапазон, отрицательный вес, неизвестный этап/сторона, отсутствующий источник или учебное допущение, отсутствующая компенсация, цикл разрешённых последующих событий и предусловие, принимающее `UNKNOWN` за истину.

- [ ] **Step 2: Запустить валидационные тесты**

Run: `npx vitest run packages/kshvi-events/tests/template-validation.test.ts packages/kshvi-events/tests/template-schema.test.ts`
Expected: FAIL, модель, JSON Schema и валидатор ещё не существуют.

- [ ] **Step 3: Реализовать закрытый типизированный контракт шаблона**

Зафиксировать русские название/описание, категорию, учебный вопрос, источник или допущение, версию схемы, масштабы/этапы/стороны, географические и временные предусловия, параметры с единицами/диапазонами, вес, тяжесть, `cooldown`, максимум срабатываний, взаимоисключения, последующие события, бюджет каскада, эффекты, наблюдения/донесения и компенсации. Схема использует закрытый `discriminated union` для разрешённых эффектов; дополнительные поля и функции отклоняются. Манифест связывает `templateId`, версию, хеш канонического содержимого и статус рецензирования.

Валидатор проверяет ссылки на операции, типы и владельцев ресурсов, неотрицательность изменений, совместимость единиц, граф каскадов, конфликт компенсаций, ограничения видимости и сохранение целей/оценки обучаемого. Все сообщения содержат путь JSON и русское содержательное объяснение.

- [ ] **Step 4: Проверить схему и доменный валидатор совместно**

Run: `npx vitest run packages/kshvi-events/tests packages/kshvi/tests/event-envelope.test.ts && npm run typecheck 2>&1 | tail -3`
Expected: PASS; TypeScript и JSON Schema не расходятся, произвольный код не исполняется, каждый дефект получает отдельный код и путь.

- [ ] **Step 5: Зафиксировать контракт библиотеки**

```bash
git add packages/kshvi-events packages/kshvi/tests/event-envelope.test.ts docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить строгую схему шаблонов событий"
```

### Task 38: Целевой каталог из 240 содержательно различных событий

**Files:** Create `packages/kshvi-events/data/catalog/control.json`, `reconnaissance.json`, `maneuver.json`, `combat.json`, `engineering.json`, `environment.json`, `logistics.json`, `maintenance.json`, `personnel.json`, `medical.json`, `settlements.json`, `interaction.json`; Create `packages/kshvi-events/data/catalog/manifest.json`, `sources.json`; Create `packages/kshvi-events/src/catalog.ts`, `catalog-quality.ts`; Create `scripts/kshvi-catalog-quality.mjs`; Test `packages/kshvi-events/tests/catalog-completeness.test.ts`, `catalog-rehearsal.test.ts`, `catalog-quality.test.ts`; Create `docs/release/kshvi/catalog-quality.json`.

**Requirements:** AUTO-02–AUTO-03, AUTO-07–AUTO-08, AC-20, NF-22.

**Interfaces:** Consumes Task 37 и современные типизированные эффекты Tasks 7–27; Produces версионный каталог минимум из 240 шаблонов, отчёт покрытия и результаты репетиции каждого шаблона.

- [ ] **Step 1: Написать падающий тест количества, категорий и содержательной уникальности**

```ts
import { expect, it } from 'vitest';
import { catalog, catalogQuality } from '../src/catalog';

it('содержит полный целевой каталог без числовых клонов', () => {
  expect(catalogQuality(catalog).approvedDistinct).toBeGreaterThanOrEqual(240);
  for (const category of catalogQuality(catalog).requiredCategories) {
    expect(category.approvedDistinct).toBeGreaterThanOrEqual(20);
  }
  expect(catalogQuality(catalog).duplicateMechanisms).toEqual([]);
});
```

Отпечаток механизма включает предусловия, типизированные эффекты, наблюдения, компенсации и учебный вопрос, но исключает название, адресата и числовые значения параметров. Добавить заведомо дефектные записи AC-20: числовой клон, цикл, неизвестную операцию, отрицательный ресурс, отсутствие источника и неподходящее состояние.

- [ ] **Step 2: Запустить проверку каталога до наполнения**

Run: `npx vitest run packages/kshvi-events/tests/catalog-completeness.test.ts packages/kshvi-events/tests/catalog-quality.test.ts`
Expected: FAIL с фактическим числом записей по каждой категории; тест нельзя ослаблять до промежуточного количества.

- [ ] **Step 3: Наполнить и методически проверить все двенадцать категорий**

Создать не менее 20 различных шаблонов в каждой категории: управление/связь; разведка; манёвр/построение; боевые эпизоды; инженерные препятствия/восстановление; погода/гидрология/сезонность; МТО; техническая исправность/ремонт; личный состав/МПС; медицинские процессы; населённые пункты/инфраструктура; взаимодействие/информационные/специальные условия. Каждый шаблон привязать к конкретному учебному вопросу и современному доменному контуру, без исторических нормативов и без медицинской или психологической диагностики реальных людей.

Для каждого события записать допустимые и недопустимые состояния, границы параметров, компенсацию и ожидаемые доказательства. Провести независимое методическое рецензирование: статус `APPROVED` получает только запись с источником или явным учебным допущением, проверенным эффектом и успешной репетицией. Добавление числовых вариаций сверх минимума допускается, но не увеличивает `approvedDistinct`.

- [ ] **Step 4: Сформировать отчёт качества и прогнать репетицию каждого шаблона**

Run: `node scripts/kshvi-catalog-quality.mjs --catalog packages/kshvi-events/data/catalog --require-minimum 240 --require-per-category 20 --output docs/release/kshvi/catalog-quality.json && npx vitest run packages/kshvi-events/tests`
Expected: PASS; отчёт содержит не менее 240 различных записей, минимум 20 в категории, переход к каждой записи, результат подходящего/неподходящего состояния и пустой список дефектов утверждённого каталога.

- [ ] **Step 5: Зафиксировать содержательный каталог и доказательства**

```bash
git add packages/kshvi-events scripts/kshvi-catalog-quality.mjs docs/release/kshvi/catalog-quality.json docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: наполнить и проверить каталог автономных событий"
```

### Task 39: Воспроизводимый вероятностный планировщик, интенсивность, каскады и репетиции

**Files:** Create `packages/kshvi-events/src/profile/autonomy-profile.ts`, `intensity-levels.ts`; Create `packages/kshvi-events/src/scheduler/interval-scheduler.ts`, `candidate-selector.ts`, `weighted-choice.ts`, `cascade-guard.ts`, `candidate-trace.ts`; Create `packages/kshvi-events/src/rehearsal/rehearse.ts`, `rehearsal-report.ts`; Create `services/kshvi/src/runtime/autonomy-worker.ts`; Test `packages/kshvi-events/tests/scheduler.test.ts`, `random-streams.test.ts`, `candidate-trace.test.ts`, `cascade-guard.test.ts`, `rehearsal.test.ts`; Create `services/kshvi/tests/autonomy-worker.test.ts`.

**Requirements:** AUTO-01, AUTO-04–AUTO-08, SIM-22, RUN-05, AC-19, ARCH-20–ARCH-22.

**Interfaces:** Consumes Tasks 3, 14, 27–31, 37–38; Produces `AutonomyProfile`, `EventCandidateTrace`, `RehearsalReport`, `scheduleInterval`, `selectCandidate`, `rehearseCatalog`; серверный worker использует только оперативное время и общую командную очередь.

- [ ] **Step 1: Написать падающий тест нулевой интенсивности и разделённых потоков**

```ts
import { expect, it } from 'vitest';
import { scheduleInterval } from '../src/scheduler/interval-scheduler';

it('полностью отключает вероятностную область при интенсивности ноль', () => {
  const result = scheduleInterval({ ...highIntensityContext, intensity: 0 });
  expect(result.attempts).toBe(0);
  expect(result.createdEvents).toEqual([]);
  expect(result.trace.rejection).toBe('ZERO_INTENSITY');
});
```

Добавить контроль: плановые/реактивные события продолжаются при нуле; добавление шаблона в категорию A не меняет ключи и выбор категории B; одинаковые версии/зерно/оперативный интервал дают одинаковый результат при другом UI, паузах и сетевом порядке; повтор скачка не создаёт новый розыгрыш.

- [ ] **Step 2: Запустить планировщик до реализации**

Run: `npx vitest run packages/kshvi-events/tests/scheduler.test.ts packages/kshvi-events/tests/random-streams.test.ts packages/kshvi-events/tests/candidate-trace.test.ts packages/kshvi-events/tests/cascade-guard.test.ts packages/kshvi-events/tests/rehearsal.test.ts`
Expected: FAIL, профиль, планировщик, следы и репетиции отсутствуют.

- [ ] **Step 3: Реализовать полный серверный алгоритм наращивания**

`AutonomyProfile` хранит уровни `OFF/LOW/MEDIUM/HIGH/CUSTOM`, числовые значения в версионном методическом профиле, интенсивности по категориям/этапам/сторонам/районам, ожидаемые попытки на оперативный час, лимиты интервала/этапа, тяжесть, глубину каскада и долю ручного утверждения. После `SEALED` обычная команда изменения отклоняется.

Для каждого фиксированного интервала получать воспроизводимое число попыток по заданному распределению и `λ·Δt`; стабильно сортировать кандидатов по `templateId`; вычислять эффективные веса и выбирать с раздельными ключами категории/цели. Сохранять след каждой попытки, включая пустые, отклонённых кандидатов и причины, веса, параметры, ключи, бюджет и события. Неизвестное обязательное предусловие отклоняет кандидата.

Каскадный страж проверяет причинность, географию, доступный источник наблюдения, взаимоисключения, повторы, тяжесть, глубину/число, ресурсный баланс и неизменность целей/оценки. Исчерпание бюджета завершает попытку или создаёт заявку, без бесконечного повтора. Worker восстанавливается по журналу, использует идемпотентные команды и создаёт мир/наблюдения/документы/вводные только через общие доменные операции.

- [ ] **Step 4: Проверить распределение и граничные репетиции**

Run: `npx vitest run packages/kshvi-events/tests services/kshvi/tests/autonomy-worker.test.ts && node scripts/kshvi-catalog-quality.mjs --catalog packages/kshvi-events/data/catalog --rehearse-boundaries --output docs/release/kshvi/autonomy-rehearsal.json`
Expected: PASS; отчёт содержит частоты, пустые интервалы, причины отклонений, максимальные каскады, учебные вопросы и предупреждения перегрузки для нулевого/высокого профилей и нескольких зёрен; совпадение числа событий в разных зернах не требуется.

- [ ] **Step 5: Зафиксировать автономное наращивание**

```bash
git add packages/kshvi-events services/kshvi scripts/kshvi-catalog-quality.mjs docs/release/kshvi/autonomy-rehearsal.json docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: реализовать воспроизводимое наращивание обстановки"
```

### Task 40: Электронный посредник с серверными циклами, перехватом и объяснением

**Files:** Create `packages/kshvi-agents/src/model/assignment.ts`, `agent-mode.ts`, `decision-trace.ts`; Create `packages/kshvi-agents/src/intermediary/classify.ts`, `assess.ts`, `plan.ts`, `act.ts`, `escalate.ts`, `observe.ts`, `cycle.ts`; Create `packages/kshvi-agents/src/llm/optional-language-port.ts`, `guarded-text.ts`; Create `services/kshvi/src/agents/intermediary-worker.ts`, `agent-command-client.ts`, `agent-recovery.ts`; Test `packages/kshvi-agents/tests/intermediary-cycle.test.ts`, `delegation.test.ts`, `decision-trace.test.ts`, `optional-llm.test.ts`, `services/kshvi/tests/intermediary-worker.test.ts`.

**Requirements:** AUTO-09–AUTO-15, ARCH-24, ROLE-04, RUN-13–RUN-18, AC-25, NF-06, NF-19.

**Interfaces:** Consumes серверные проекции и команды Tasks 28–34; Produces `ElectronicIntermediaryAssignment`, `AgentDecisionTrace`, `IntermediaryCycle`, `runIntermediaryCycle`, `escalateAssignment`; режимы `ADVISORY/DELEGATED/AUTONOMOUS` не расширяют серверные права.

- [ ] **Step 1: Написать падающий тест самостоятельного цикла и запрета выхода за полномочия**

```ts
import { expect, it } from 'vitest';
import { runIntermediaryCycle } from '../src/intermediary/cycle';

it('исполняет разрешённое и эскалирует запрещённое без человека-посредника', async () => {
  const result = await runIntermediaryCycle(delegatedFixture);
  expect(result.commands.map(command => command.kind)).toContain('issueDocument');
  expect(result.escalation).toEqual(expect.objectContaining({ reason: 'OUTSIDE_DELEGATION' }));
  expect(result.appliedForbiddenEffects).toEqual([]);
  expect(result.trace.actor.kind).toBe('system');
});
```

Добавить три режима, собственную системную подпись, перехват без отката, повтор сетевой команды, остановку браузера, перезапуск сервиса, истечение тайм-бюджета, недостаток данных, противоречие, отказ модели и обязательное продолжение локального контура без языковой модели.

- [ ] **Step 2: Запустить тесты электронного посредника**

Run: `npx vitest run packages/kshvi-agents/tests services/kshvi/tests/intermediary-worker.test.ts`
Expected: FAIL, назначение, цикл, следы и worker ещё не существуют.

- [ ] **Step 3: Реализовать полный программный контур посредника**

Назначение содержит инстанции/участки, служебную идентичность, роли, видимость, полномочия, современный профиль, расписание и эскалацию; по умолчанию `DELEGATED`. Цикл пробуждается событием/расписанием, получает только серверную проекцию, оценивает изменения, формирует варианты, проверяет права/ресурсы, подаёт идемпотентные команды, контролирует результат и пишет объяснение. Поддержать классификацию, рабочую карту, оценку, решения, задачи, документы, вводные/донесения по связи, расчёты, исполнение, сроки, запросы данных, доклады и лист наблюдений.

`AgentDecisionTrace` сохраняет проекцию/хеш, приказ, варианты, ограничения, оценки, выбор, версии, ключи, изолированные проигрыши, команды/ответы и эскалацию. При перехвате мир продолжается; человек видит задачу, данные и предложение, может подтвердить/изменить/отклонить/приостановить. Языковая модель подключается только через необязательный порт для текста; её факты проходят валидатор и права, свободный текст никогда не исполняется напрямую.

- [ ] **Step 4: Проверить автономность, восстановление и приватность следов**

Run: `npx vitest run packages/kshvi-agents/tests services/kshvi/tests/intermediary-worker.test.ts services/kshvi/tests/projections.test.ts`
Expected: PASS; весь делегированный цикл выполняется без браузера и человека, повтор не даёт второго эффекта, след объясняет выбор/альтернативы/неизвестные и не содержит чужой проекции.

- [ ] **Step 5: Зафиксировать электронного посредника**

```bash
git add packages/kshvi-agents services/kshvi/src/agents services/kshvi/tests docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить автономного электронного посредника"
```

### Task 41: Современный системный противник и адаптер `agents-core`

**Files:** Create `packages/kshvi-agents/src/ports/agent-engine.ts`, `world-fork.ts`, `modern-choice.ts`; Create `crates/agents-kshvi/Cargo.toml`, `src/lib.rs`, `src/profile.rs`, `src/choice.rs`, `src/utility.rs`, `src/hierarchy.rs`, `src/fork.rs`, `src/rng.rs`; Create `services/kshvi/src/agents/rust-worker.ts`, `agent-process.ts`; Test `crates/agents-kshvi/tests/modern_opponent.rs`, `packages/kshvi-agents/tests/opponent.test.ts`, `world-fork.test.ts`, `services/kshvi/tests/opponent-worker.test.ts`; Create `packages/kshvi-agents/data/modern-profiles/`.

**Requirements:** AUTO-16–AUTO-19, ARCH-03, ARCH-24, MPS-07, SIM-23, ROLE-03–ROLE-06, AC-27.

**Interfaces:** Consumes `agents-core` через изолированный современный адаптер; Produces `ModernAgentProfile`, `ModernChoice`, `WorldFork`, `AgentEnginePort`, `evaluateChoices`, `runOpponentCycle`; официальный мир доступен только через команды сервиса.

- [ ] **Step 1: Написать падающий тест изолированного варианта и современного профиля**

```rust
#[test]
fn option_fork_does_not_change_official_world_or_random_stream() {
    let fixture = modern_fixture();
    let official_before = fixture.official_hash();
    let rng_before = fixture.official_rng_cursor();
    let evaluation = evaluate_choices(&fixture);
    assert!(evaluation.fork_hashes.iter().all(|hash| hash != &official_before));
    assert_eq!(fixture.official_hash(), official_before);
    assert_eq!(fixture.official_rng_cursor(), rng_before);
    assert!(fixture.profile_sources().iter().all(|source| source.era == "modern"));
}
```

TypeScript-тесты проверяют назначение `HUMAN/SCRIPT/PLAYBOOK/AGENT/HYBRID`, противника по умолчанию при одностепенном учении, влияние доступных наблюдений на выбор, отсутствие влияния скрытой истины, МПС/техники/запасов/местности/погоды, идемпотентность, одинаковый выбор при одинаковом зерне и отказ запроса черновиков/будущих вводных.

- [ ] **Step 2: Запустить Rust и TypeScript тесты адаптера**

Run: `cargo test --manifest-path crates/agents-kshvi/Cargo.toml && npx vitest run packages/kshvi-agents/tests/opponent.test.ts packages/kshvi-agents/tests/world-fork.test.ts services/kshvi/tests/opponent-worker.test.ts`
Expected: FAIL, современный crate, профили и worker отсутствуют; историческая реализация не импортируется как обходной путь.

- [ ] **Step 3: Реализовать переиспользование механизмов без исторических нормативов**

Перенести через порт профили командиров/мотивы, риск, настойчивость, допустимость потерь, исполнительность, типизированные `Choice`, полезность, иерархические штабы, приказы/донесения, изолированные форки и RNG `seed + agent + tick + stream`. Современные профили имеют источник/допущение, версию, глубину поиска, число вариантов, горизонт, цикл пересмотра и инициативу; уровень сложности никогда не открывает истину.

Worker получает собственные приказы, наблюдения, донесения и ресурсы, формирует решение, оформляет задачи, использует модель связи и пересматривает по новым сведениям. Форк уничтожается после оценки и не имеет канала записи в официальную БД/outbox. При нехватке данных агент продолжает действующий приказ/безопасное состояние либо эскалирует, не создавая силы, ресурсы и события.

- [ ] **Step 4: Проверить причинное влияние и воспроизводимость системного противника**

Run: `cargo test --manifest-path crates/agents-kshvi/Cargo.toml && npx vitest run packages/kshvi-agents/tests services/kshvi/tests/opponent-worker.test.ts`
Expected: PASS; парные прогоны различаются только при изменении доступной проекции/состояния, скрытая истина не влияет, форки не меняют официальные хеши/RNG, повторный след совпадает.

- [ ] **Step 5: Зафиксировать современный адаптер и профили**

```bash
git add crates/agents-kshvi packages/kshvi-agents services/kshvi/src/agents services/kshvi/tests Cargo.lock docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: подключить современного системного противника"
```

### Task 42: Панели интенсивности, кандидатов, программных участников и перехвата

**Files:** Create `apps/editor/src/modern/kshvi/preparation/AutonomyEditor.tsx`, `CatalogBrowser.tsx`, `RehearsalReport.tsx`; Create `apps/editor/src/modern/kshvi/conduct/AutonomyMonitor.tsx`, `AgentAssignmentPanel.tsx`, `AgentDecisionTraceView.tsx`, `InterventionDialog.tsx`; Test `apps/editor/tests/kshvi-autonomy-ui.test.tsx`, `kshvi-agent-privacy.test.tsx`, `kshvi-autonomy-ui.spec.ts`.

**Requirements:** UI-20–UI-21, UI-08–UI-10, AUTO-04–AUTO-15, PREP-09–PREP-11, NF-16–NF-17.

**Interfaces:** Consumes Tasks 37–41; Produces редактор профиля, каталог, отчёт репетиции, монитор попыток, назначение/перехват агентов и объяснение решений без раскрытия скрытых проекций.

- [ ] **Step 1: Написать падающий тест интенсивности и эскалации**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AutonomyEditor } from '../src/modern/kshvi/preparation/AutonomyEditor';

it('объясняет нулевую интенсивность и не отменяет плановые вводные', () => {
  render(<AutonomyEditor profile={mediumProfile} />);
  fireEvent.change(screen.getByLabelText('Интенсивность разведки'), { target: { value: '0' } });
  expect(screen.getByText('Вероятностные события разведки отключены; плановые и реактивные сохранены')).toBeTruthy();
});
```

Добавить сценарии пустого интервала с причинами, ручного утверждения, исчерпания каскада, `ADVISORY/DELEGATED/AUTONOMOUS`, перехвата без отката, недоступной LLM, устаревшего назначения и запрета чужого `AgentDecisionTrace`.

- [ ] **Step 2: Запустить интерфейсные тесты**

Run: `npx vitest run apps/editor/tests/kshvi-autonomy-ui.test.tsx apps/editor/tests/kshvi-agent-privacy.test.tsx`
Expected: FAIL, панели автономии и агентов отсутствуют.

- [ ] **Step 3: Реализовать связанный интерфейс контроля автономии**

Редактор показывает общий и областной уровень, единицы интенсивности, лимиты/тяжесть/каскады, числовой профиль и последствия до `SEALED`. Каталог поддерживает поиск по категории, учебному вопросу, источнику, эффекту и статусу, сравнение версий и переход к репетиции. Монитор показывает успешные и пустые попытки, отклонения и созданные события с причинными ссылками.

Панель агента отображает режим, текущую задачу, использованные разрешённые данные, варианты, команды/ответы, тайм-бюджет и причину эскалации. Перехват требует подтверждения и фиксирует нового автора. Никакой экран не получает общий серверный журнал для локальной фильтрации.

- [ ] **Step 4: Проверить доступность и снимки экранов**

Run: `npx vitest run apps/editor/tests/kshvi-autonomy-ui.test.tsx apps/editor/tests/kshvi-agent-privacy.test.tsx && npx playwright test apps/editor/tests/kshvi-autonomy-ui.spec.ts`
Expected: PASS; клавиатура, русские состояния, 1440×900, 125 % и 1920×1080 проверены, служебные данные отсутствуют в DOM и сетевых ответах.

- [ ] **Step 5: Зафиксировать панели и документацию**

```bash
git add apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить управление автономией и агентами"
```

### Task 43: Интеграционный барьер полного `full-simulation`

**Files:** Create `services/kshvi/tests/e2e/autonomous-full-simulation.test.ts`, `services/kshvi/tests/e2e/modern-domains.test.ts`, `apps/editor/tests/kshvi-full-simulation.spec.ts`; Create `scripts/kshvi-run-g3.mjs`; Create `docs/release/kshvi/g3-full-simulation.json`, `g3-known-gaps.json`.

**Requirements:** интеграция AUTO-01–AUTO-19, MPS-01–MPS-08, LOG-01–LOG-08, ORG-08–ORG-16, SIM-18–SIM-24, ENV-18–ENV-23, SYM-01–SYM-10; AC-19–AC-27 и AC-29 как предварительные доказательства.

**Interfaces:** Consumes Tasks 1–42; Produces единый автономный прогон G3 без человека за посредников/противника, доказательства причинного влияния МПС, местности, техники, МТО и готовности; релизный статус по-прежнему запрещён.

- [ ] **Step 1: Написать падающий сквозной набор причинных сценариев**

Набор запускает реальные PostgreSQL, КШВИ, среду, каталог, электронного посредника и Rust worker. Он включает нулевую/высокую интенсивность, репетицию 240 событий, пороговую пару МПС, исходную карту с ошибками, ограниченные мост/переправу, поставку/ремонт, частичную готовность, добавление силы из базы, делегированный цикл без человека и одностепенного противника. Каждый тест проверяет доменные события и хеши, а не только экран.

- [ ] **Step 2: Запустить G3 и зафиксировать первый реальный разрыв**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/kshvi_test node scripts/kshvi-run-g3.mjs`
Expected: FAIL на любом незамкнутом контракте; `g3-known-gaps.json` содержит владельца и failing test, ожидания не ослабляются.

- [ ] **Step 3: Замкнуть автономный контур без прямой записи исходов**

Исправления выполнять в модуле-владельце с регрессионным тестом. Доказать, что события проходят очередь, агенты не читают истину, МПС меняет приказ/исполнение/выбор, местность меняет граф/снабжение, поставка имеет путь и баланс, ремонт требует ресурсов/времени, готовность влияет после разрешённого перехода, а повторы и скачки не создают второй эффект.

- [ ] **Step 4: Повторить весь G3 в двух процессах и с обрывом worker**

Run: `node scripts/kshvi-run-g3.mjs --repeat 2 --restart-workers --output docs/release/kshvi/g3-full-simulation.json && npm run typecheck 2>&1 | tail -3`
Expected: PASS; сохранены следы кандидатов/агентов, контрольные хеши и журналы перезапуска, AC-19–AC-27 и AC-29 имеют предварительные доказательства.

- [ ] **Step 5: Зафиксировать контрольную точку G3**

```bash
git add packages crates services apps/editor scripts docs/release/kshvi docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: замкнуть полный автономный имитационный контур"
```

**Контрольная точка G3:** полный `full-simulation` работает, но без реплея, автономного архива, эксплуатационной приёмки и экспозиции выпуск по-прежнему запрещён.

---

## Этап 5 — реплей, разбор, архив, эксплуатация и экспозиция

### Task 44: Полный синхронизированный реплей и перспективы участника/истины

**Files:** Create `packages/kshvi/src/replay/replay-engine.ts`, `snapshot-restore.ts`, `replay-clock.ts`, `perspective.ts`, `causal-links.ts`; Create `services/kshvi/src/replay/replay-service.ts`, `replay-projection.ts`; Create `apps/editor/src/modern/kshvi/replay/ReplayWorkspace.tsx`, `ReplayTimeline.tsx`, `PerspectiveBadge.tsx`, `SynchronizedPanels.tsx`; Test `packages/kshvi/tests/replay.test.ts`, `replay-domains.test.ts`, `services/kshvi/tests/replay-privacy.test.ts`, `apps/editor/tests/kshvi-replay.test.tsx`, `apps/editor/tests/kshvi-replay.spec.ts`.

**Requirements:** REPLAY-01–REPLAY-04, REPLAY-16, NF-15, ARCH-18, AC-08, AC-12.

**Interfaces:** Consumes версионный reducer, снимки, события и серверные проекции всех задач; Produces `ReplayCursor`, `ReplayPerspective`, `restoreAt`, `projectReplayAt`, `traceCauses`; реплей никогда не вызывает планировщик, генератор, LLM или внешний сервис.

- [ ] **Step 1: Написать падающий тест отсутствия повторного розыгрыша**

```ts
import { expect, it, vi } from 'vitest';
import { restoreAt } from '../src/replay/replay-engine';

it('восстанавливает сохранённый выбор без обращения к генераторам', () => {
  const scheduler = vi.fn(() => { throw new Error('повторный розыгрыш запрещён'); });
  const languageModel = vi.fn(() => { throw new Error('внешний вызов запрещён'); });
  const first = restoreAt({ archive, cursor: 500, scheduler, languageModel });
  const second = restoreAt({ archive, cursor: 500, scheduler, languageModel });
  expect(first.stateHash).toBe(second.stateHash);
  expect(scheduler).not.toHaveBeenCalled();
  expect(languageModel).not.toHaveBeenCalled();
});
```

Добавить полный перечень журналируемых фактов REPLAY-01 и доменов REPLAY-16, повтор команды, отклонённые команды, сбои, доступ администратора, две шкалы времени, ближайший снимок, разный порядок экранов и старую версию reducer.

- [ ] **Step 2: Запустить тесты реплея до реализации**

Run: `npx vitest run packages/kshvi/tests/replay.test.ts packages/kshvi/tests/replay-domains.test.ts services/kshvi/tests/replay-privacy.test.ts apps/editor/tests/kshvi-replay.test.tsx`
Expected: FAIL, восстановление из архива и синхронизированные перспективы отсутствуют.

- [ ] **Step 3: Реализовать журнал, восстановление и серверную перспективу**

Восстановление выбирает ближайший предшествующий снимок и последовательно применяет сохранённые события/результаты выборов. Скорость затрагивает только отображение. На курсоре синхронизируются карта, погода, ресурсы, МПС/готовность/техника, мероприятия, построение, поставки/ремонт, версии местности, попытки планировщика, циклы/перехваты агентов, задачи, документы, связь, решения, оценки и лента.

Сервер строит отдельный кадр «как видел участник» из проекции на тот момент и кадр истины только для уполномоченных. Источник каждого объекта явно обозначен; истина имеет постоянную метку. Ссылки причинности ведут от метрики/замечания к событию и расчёту. Старый архив выбирает сохранённую версию reducer либо открывается с меткой несовместимого чтения без заявления идентичности.

- [ ] **Step 4: Проверить идентичность и приватность в разных процессах**

Run: `npx vitest run packages/kshvi/tests/replay.test.ts packages/kshvi/tests/replay-domains.test.ts services/kshvi/tests/replay-privacy.test.ts apps/editor/tests/kshvi-replay.test.tsx && npx playwright test apps/editor/tests/kshvi-replay.spec.ts`
Expected: PASS; контрольные хеши совпадают на поддерживаемых клиентах, UI/скорость не меняют исход, скрытые объекты отсутствуют в кадре участника, карта и все панели синхронны.

- [ ] **Step 5: Зафиксировать реплей и экранные доказательства**

```bash
git add packages/kshvi services/kshvi apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: реализовать воспроизводимый реплей и перспективы"
```

### Task 45: Альтернативные ветви, сравнение, исследования и повторные прохождения

**Files:** Create `packages/kshvi/src/replay/branch.ts`, `branch-diff.ts`, `research-card.ts`, `rerun.ts`; Create `services/kshvi/src/replay/branch-service.ts`, `research-service.ts`; Create `apps/editor/src/modern/kshvi/replay/BranchComparison.tsx`, `ResearchCardEditor.tsx`, `RerunDialog.tsx`; Test `packages/kshvi/tests/branches.test.ts`, `research.test.ts`, `rerun.test.ts`, `services/kshvi/tests/branch-isolation.test.ts`, `apps/editor/tests/kshvi-branches.test.tsx`.

**Requirements:** REPLAY-05–REPLAY-06, REPLAY-12–REPLAY-13, ARCH-20–ARCH-22, AC-10, AC-12.

**Interfaces:** Produces `Branch`, `BranchDiff`, `ResearchCard`, `RerunComparison`, `createBranch`, `compareBranches`, `createRerun`; официальная линия доступна ветви только для чтения.

- [ ] **Step 1: Написать падающий тест изоляции ветви**

```ts
import { expect, it } from 'vitest';
import { applyBranchDecision } from '../src/replay/branch';

it('не меняет официальные документы, оценку и хеш', () => {
  const before = officialFixture.hash;
  const branch = applyBranchDecision(officialFixture, alternativeDecision);
  expect(branch.branchId).not.toBe(officialFixture.branchId);
  expect(officialFixture.hash).toBe(before);
  expect(officialFixture.assessment).toEqual(originalAssessment);
});
```

Добавить сравнение, где версии модели/среды выводятся до последствий решения; исследование без доказанной причинности; повторное прохождение с новыми участниками; запрет обычной публикации ветви и запрет единого рейтинга разных учений.

- [ ] **Step 2: Запустить тесты ветвей и исследований**

Run: `npx vitest run packages/kshvi/tests/branches.test.ts packages/kshvi/tests/research.test.ts packages/kshvi/tests/rerun.test.ts services/kshvi/tests/branch-isolation.test.ts apps/editor/tests/kshvi-branches.test.tsx`
Expected: FAIL, ветвления и исследовательские карточки отсутствуют.

- [ ] **Step 3: Реализовать изолированные исследовательские контуры**

Ветвь создаётся от снимка с новым `branchId`, событиями, расчётами, правами, зерном и явными заменами версий. Сравнение показывает расхождения времени, задач, ресурсов, документов и исходов после блока различий среды/модели. Перенос в официальную линию возможен только новым решением руководителя с основанием и без переписывания прошлого.

`ResearchCard` содержит вопрос, гипотезу, переменные, метод, ответственных, данные, наблюдения, сроки, результаты, ограничения и вывод, связанные доказательства и уровень доказанности причинности. Повторное прохождение копирует редакцию, получает новый сеанс/участников и протокол различий среды, модели, состава и ролей.

- [ ] **Step 4: Проверить сравнение и неизменность официальной линии**

Run: `npx vitest run packages/kshvi/tests/branches.test.ts packages/kshvi/tests/research.test.ts packages/kshvi/tests/rerun.test.ts services/kshvi/tests/branch-isolation.test.ts apps/editor/tests/kshvi-branches.test.tsx`
Expected: PASS; официальные хеши/документы/оценки неизменны, различия условий видны первыми, исследование не заявляет недоказанную причинность.

- [ ] **Step 5: Зафиксировать ветви и исследования**

```bash
git add packages/kshvi services/kshvi apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить ветви, сравнение и исследования"
```

### Task 46: Доказательные метрики, человеческая оценка и материалы разборов

**Files:** Create `packages/kshvi/src/assessment/metric-definition.ts`, `metric-engine.ts`, `evidence-link.ts`, `assessment-sheet.ts`, `debrief.ts`; Create `services/kshvi/src/assessment/metric-service.ts`, `debrief-service.ts`, `publication-service.ts`; Create `apps/editor/src/modern/kshvi/assessment/MetricExplorer.tsx`, `AssessmentEditor.tsx`, `DebriefWorkspace.tsx`; Test `packages/kshvi/tests/metrics.test.ts`, `assessment.test.ts`, `debrief.test.ts`, `apps/editor/tests/kshvi-assessment.test.tsx`.

**Requirements:** REPLAY-07–REPLAY-11, GEN-04, ROLE-07, AC-12, NF-16, NF-18.

**Interfaces:** Produces `MetricDefinition`, `MetricResult`, `AssessmentSheet`, `DebriefPackage`, `calculateMetric`, `draftAssessment`, `publishDebrief`; автоматический балл не утверждает итоговую оценку.

- [ ] **Step 1: Написать падающий тест неизвестного значения и ручного утверждения**

```ts
import { expect, it } from 'vitest';
import { calculateMetric } from '../src/assessment/metric-engine';

it('не заменяет пропущенные события нулевой задержкой', () => {
  const result = calculateMetric(deliveryDelayMetric, eventsWithoutDelivery);
  expect(result.value).toBe('UNKNOWN');
  expect(result.missingData).toContain('delivery.timestamp');
  expect(result.evidence.length).toBeGreaterThan(0);
});
```

Добавить все семь групп показателей, формулу/версию/единицы/период/источник, несовместимые профили, индивидуальный/коллективный лист, проект оценки, человеческое подтверждение, общий/частный разбор и публикацию без черновых комментариев.

- [ ] **Step 2: Запустить тесты оценки и разбора**

Run: `npx vitest run packages/kshvi/tests/metrics.test.ts packages/kshvi/tests/assessment.test.ts packages/kshvi/tests/debrief.test.ts apps/editor/tests/kshvi-assessment.test.tsx`
Expected: FAIL, расчёт показателей и материалы разбора отсутствуют.

- [ ] **Step 3: Реализовать доказательный аналитический контур**

Метрики сроков, документов, взаимодействия, связи, ресурсов, обстановки и замысла вычисляются версионными определениями со ссылками на исходные события. Пропуски возвращают `UNKNOWN`, разные профили сопровождаются предупреждением. Лист оценки содержит критерии, шкалу, наблюдения, положительные/отрицательные факты, комментарий, оценивающего и подтверждение руководителя; проект системы отделён от итога человека.

Разбор включает цели/этапы, исходную обстановку, решения, план/факт, хронологию, документы, связь, ресурсы, исследования, показатели и выводы. Частный разбор ограничен инстанцией/вопросами, общий — разрешёнными материалами сторон. Эталон представлен как замысел, обоснованные отклонения разбираются по последствиям. Публикация фиксирует редакцию и аудиторию.

- [ ] **Step 4: Проверить доказательства, права и локальные печатные формы**

Run: `npx vitest run packages/kshvi/tests/metrics.test.ts packages/kshvi/tests/assessment.test.ts packages/kshvi/tests/debrief.test.ts apps/editor/tests/kshvi-assessment.test.tsx services/kshvi/tests/projections.test.ts`
Expected: PASS; каждый показатель ведёт к событию, неизвестное не равно нулю, итог требует человека, PDF/DOCX/JSON соответствуют одной редакции и не раскрывают черновики.

- [ ] **Step 5: Зафиксировать оценку и разбор**

```bash
git add packages/kshvi services/kshvi apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить доказательную оценку и разборы"
```

### Task 47: Автономный архив, проверка импорта, offline viewer и длительные задания

**Files:** Create `packages/kshvi/src/archive/archive-manifest.ts`, `file-digest.ts`, `archive-schema.ts`; Create `services/kshvi/src/archive/archive-exporter.ts`, `archive-importer.ts`, `integrity-check.ts`, `offline-viewer-builder.ts`, `retention-export.ts`; Create `apps/editor/src/modern/kshvi/archive/ArchiveWorkspace.tsx`, `ArchiveImportDialog.tsx`, `JobQueuePanel.tsx`; Create `apps/archive-viewer/`; Test `packages/kshvi/tests/archive-manifest.test.ts`, `services/kshvi/tests/archive-roundtrip.test.ts`, `archive-offline.test.ts`, `archive-jobs.test.ts`, `apps/editor/tests/kshvi-archive.test.tsx`.

**Requirements:** REPLAY-14–REPLAY-15, REPLAY-17, ARCH-19, NF-04, NF-18, NF-21, AC-12, AC-28.

**Interfaces:** Consumes все версии и следы Tasks 1–46; Produces `ArchiveManifest`, `ArchiveImportResult`, `Job`, `exportArchive`, `verifyArchive`, `buildOfflineViewer`; пакет содержит манифест, SHA-256 файлов и контрольную сумму манифеста.

- [ ] **Step 1: Написать падающий тест полного автономного кругового цикла**

```ts
import { expect, it } from 'vitest';
import { verifyArchive } from '../src/archive/integrity-check';

it('отклоняет неполный пакет для автономной приёмки', () => {
  const result = verifyArchive(archiveWithoutWeather);
  expect(result.autonomous).toBe(false);
  expect(result.missing).toContain('environment.weather');
  expect(result.mode).toBe('LIMITED_RESEARCH');
});
```

Добавить обязательный состав REPLAY-14, все расширения REPLAY-16–17, изменённый файл, отсутствующую ссылку, старую схему, ограниченную лицензию атласа, права экспорта, повтор/отмену задания и открытие viewer без исходных сервисов, Интернета и TTF.

- [ ] **Step 2: Запустить архивные тесты до реализации**

Run: `npx vitest run packages/kshvi/tests/archive-manifest.test.ts services/kshvi/tests/archive-roundtrip.test.ts services/kshvi/tests/archive-offline.test.ts services/kshvi/tests/archive-jobs.test.ts`
Expected: FAIL, экспорт, проверка и автономный viewer отсутствуют.

- [ ] **Step 3: Реализовать самодостаточный версионный пакет и фоновые задания**

Включить сценарии/допущения, снимки/журнал/хеши, карту/атлас/тайлы/высоты/погоду/местность/атрибуцию, силы/технику/МПС/готовность/построение/МТО/связь/документы, каталог/интенсивность/кандидатов/RNG, агентов/профили/следы/форки, знаки/источники/правила/легенды, решения/расчёты/модели, оценки/разборы/исследования/ветви и разрешённый список участников. Манифест хранит версии схем, обязательность и хеш каждого файла.

Импорт проверяет хеши, ссылки и права до публикации. Неполный пакет доступен только с меткой ограниченного исследования. При запрете выгрузки атласа разрешённый экспорт ссылки/стиля получает явную метку неавтономности. Offline viewer содержит локальный движок реплея и ресурсы, не обращается к сети. Экспорт/импорт/проверка/массовый расчёт работают как `queued/running/succeeded/failed/cancelled` с прогрессом, лимитами ресурсов, правами и безопасным повтором.

- [ ] **Step 4: Проверить изолированную машину и неблокирующие задания**

Run: `npx vitest run packages/kshvi/tests/archive-manifest.test.ts services/kshvi/tests/archive-roundtrip.test.ts services/kshvi/tests/archive-offline.test.ts services/kshvi/tests/archive-jobs.test.ts apps/editor/tests/kshvi-archive.test.tsx`
Expected: PASS; полный архив воспроизводит контрольные хеши offline, повреждение обнаружено, неполный пакет не принят, тяжёлая задача не блокирует команды и не снижает видимость.

- [ ] **Step 5: Зафиксировать архивный контур**

```bash
git add packages/kshvi services/kshvi apps/editor apps/archive-viewer docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: реализовать автономный архив и проверку"
```

### Task 48: Локальное администрирование, организации, роли, аудит и конфигурация

**Files:** Create `services/kshvi/src/auth/local-directory.ts`, `account-service.ts`, `assignment-service.ts`, `organization-policy.ts`, `temporary-access.ts`, `security-audit.ts`; Create `services/kshvi/src/admin/config-catalog.ts`, `retention-service.ts`, `deletion-service.ts`; Create `apps/editor/src/modern/kshvi/admin/AccountsWorkspace.tsx`, `RoleAssignments.tsx`, `SecurityAudit.tsx`, `ConfigCatalog.tsx`; Test `services/kshvi/tests/accounts.test.ts`, `organization-isolation.test.ts`, `role-revocation.test.ts`, `security-audit.test.ts`, `config-catalog.test.ts`, `apps/editor/tests/kshvi-admin.test.tsx`.

**Requirements:** ADM-01–ADM-03, ADM-07–ADM-08, ADM-10, UI-15, NF-06–NF-10, NF-19–NF-20, AC-03, AC-13, AC-17.

**Interfaces:** Produces `LocalAccount`, `RoleAssignment`, `OrganizationPolicy`, `SecurityAuditEvent`, `ConfigVersion`, `RetentionPolicy`, `DeletionRequest`; техническая и предметная авторизация являются разными разрешениями.

- [ ] **Step 1: Написать падающий тест технического администратора и отзыва роли**

```ts
import { expect, it } from 'vitest';
import { authorize } from '../src/auth/authorize';

it('не даёт техническому администратору содержание и предметные права', () => {
  expect(authorize(technicalAdmin, { action: 'scenario.approve' }).allowed).toBe(false);
  expect(authorize(technicalAdmin, { action: 'document.read', resource: secretDocument }).allowed).toBe(false);
  expect(authorize(technicalAdmin, { action: 'backup.create' }).allowed).toBe(true);
});
```

Добавить блокировку/архивирование учётной записи, срок/замещение/конфликт роли, немедленный отзыв SSE/API, организацию каждого объекта/файла, общий справочник, демонстрационные/тренировочные/официальные метки, временный доступ, двойное подтверждение удаления и аудит экспорта аудита.

- [ ] **Step 2: Запустить тесты администрирования и безопасности**

Run: `npx vitest run services/kshvi/tests/accounts.test.ts services/kshvi/tests/organization-isolation.test.ts services/kshvi/tests/role-revocation.test.ts services/kshvi/tests/security-audit.test.ts services/kshvi/tests/config-catalog.test.ts apps/editor/tests/kshvi-admin.test.tsx`
Expected: FAIL, локальный каталог и разделённые права не реализованы полностью.

- [ ] **Step 3: Реализовать эксплуатационное управление закрытой установки**

Локальный каталог поддерживает создание/блокировку/архивирование, организацию, технические права, сессии/отзыв, Argon2id или эквивалентное локальное хеширование, локальный TLS и секреты вне клиентского пакета. Предметные роли назначает руководитель/методист с инстанцией/стороной/участком/сроком/действиями/замещением. Совмещение демонстрационных ролей не копируется в официальный сеанс.

Каждый запрос, SSE, файл и задание проверяет `organizationId`, сессию и минимальные права. Аудит безопасности append-only фиксирует входы, неудачи, роли, доступ администратора, конфигурацию, копии, восстановление, экспорт и удаление без скрытого payload. Метки распространения и хранение настраиваются организацией; интерфейс прямо указывает, что сертификация секретности не заявляется.

Каталог профилей документов/масштабов/связи/погоды/моделей/оценки версионируется, тестируется и утверждается без ручной правки production-БД. Политика хранения ограничивает архивы/копии/аудит/носители; удаление требует специального права, второго лица, проверки удержания, логической блокировки и отложенного задания.

- [ ] **Step 4: Проверить изоляцию и аудит всех административных действий**

Run: `npx vitest run services/kshvi/tests/accounts.test.ts services/kshvi/tests/organization-isolation.test.ts services/kshvi/tests/role-revocation.test.ts services/kshvi/tests/security-audit.test.ts services/kshvi/tests/config-catalog.test.ts apps/editor/tests/kshvi-admin.test.tsx`
Expected: PASS; техническая панель не раскрывает содержание, отзыв действует немедленно, организации изолированы, временный доступ ограничен и весь аудит защищён хешами.

- [ ] **Step 5: Зафиксировать администрирование и политику безопасности**

```bash
git add services/kshvi apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: реализовать локальное администрирование и аудит"
```

### Task 49: Копии, аварийный перезапуск, расхождения и безопасные обновления

**Files:** Create `services/kshvi/src/admin/backup-service.ts`, `restore-service.ts`, `restore-verification.ts`, `divergence-report.ts`, `incident-service.ts`, `update-service.ts`, `preflight-check.ts`; Create `scripts/kshvi-backup.mjs`, `kshvi-restore.mjs`, `kshvi-disaster-drill.mjs`; Test `services/kshvi/tests/backup.test.ts`, `restart-recovery.test.ts`, `restore-divergence.test.ts`, `preflight.test.ts`, `update.test.ts`; Create `docs/release/kshvi/recovery-drill.json`.

**Requirements:** ADM-05–ADM-06, ADM-09, ADM-11, ARCH-09, NF-11–NF-14, AC-09, AC-16.

**Interfaces:** Produces `BackupManifest`, `RestoreResult`, `DivergenceReport`, `Incident`, `PreflightReport`, `UpdateReport`; подтверждение команды следует только после долговременной фиксации.

- [ ] **Step 1: Написать падающий тест нулевого RPO и защиты позднего журнала**

```ts
import { expect, it } from 'vitest';
import { planRestore } from '../src/admin/restore-service';

it('не затирает более поздние подтверждённые события старой копией', () => {
  const result = planRestore({ backupLastSequence: 100, activeLastSequence: 140 });
  expect(result.allowed).toBe(false);
  expect(result.requiredReport).toBe('DIVERGENCE');
  expect(result.preservedSequence).toBe(140);
});
```

Добавить отказ после фиксации до ответа, повтор с прежним ключом, перезапуск ≤ 5 мин, восстановление узла ≤ 30 мин, предстартовую копию, инкремент ≤ 5 мин, копии перед скачком/завершением, периодическое пробное восстановление и обрыв клиента со сменой прав.

- [ ] **Step 2: Запустить аварийные сценарии до реализации**

Run: `npx vitest run services/kshvi/tests/backup.test.ts services/kshvi/tests/restart-recovery.test.ts services/kshvi/tests/restore-divergence.test.ts services/kshvi/tests/preflight.test.ts services/kshvi/tests/update.test.ts`
Expected: FAIL, полный регламент копирования и восстановления отсутствует.

- [ ] **Step 3: Реализовать измеримый контур непрерывности**

Перед стартом копировать сценарий, среду и назначения; журнал инкрементально не реже 5 мин, снимки по расписанию, контрольные копии перед скачком/завершением. Манифест копии содержит хеши/версии; годность подтверждается проверкой и пробным восстановлением. PostgreSQL фиксирует событие/результат идемпотентности до ответа, RPO подтверждённых событий равен нулю.

Перезапуск восстанавливает последнее событие и workers без повторного эффекта. Полное восстановление выполняется в изолированную область, затем сравнивается с активным журналом. Расхождение требует отдельного решения и не стирает поздние события. Инцидент фиксирует время/контур/влияние/действия/результат; методическое продолжение решает руководитель. Предстартовый контроль проверяет диск, копии, сертификаты, NTP, ресурсы, рабочие места, тестовое восстановление и печать; обычная перезагрузка активного сеанса защищена подтверждением руководителя.

Обновление активного официального сеанса запрещено, аварийная процедура требует паузы/снимка/совместимости/журнала. Миграции проверяются на копии, имеют план отката приложения и не переписывают исторические payload без протокола. После обновления проверяются архивы, проекции, карта/погода, документы и контрольный расчёт.

- [ ] **Step 4: Провести измеряемую аварийную репетицию**

Run: `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/kshvi_test node scripts/kshvi-disaster-drill.mjs --output docs/release/kshvi/recovery-drill.json && npx vitest run services/kshvi/tests/backup.test.ts services/kshvi/tests/restart-recovery.test.ts services/kshvi/tests/restore-divergence.test.ts services/kshvi/tests/update.test.ts`
Expected: PASS; подтверждённые события сохранены, повтор без дубликата, фактические перезапуск/восстановление ≤ 5/30 мин, старая копия не затирает журнал, reconnect применяет новые права.

- [ ] **Step 5: Зафиксировать восстановление и протокол**

```bash
git add services/kshvi scripts/kshvi-backup.mjs scripts/kshvi-restore.mjs scripts/kshvi-disaster-drill.mjs docs/release/kshvi/recovery-drill.json docs/system.md docs/system.pdf docs/system.docx
git commit -m "КШВИ: обеспечить копирование и аварийное восстановление"
```

### Task 50: Эксплуатационные состояния, наблюдаемость, доступность и локальные наборы данных

**Files:** Create `services/kshvi/src/admin/health-service.ts`, `metrics-service.ts`, `notification-service.ts`, `resource-budget.ts`; Create `apps/editor/src/modern/kshvi/admin/OperationsDashboard.tsx`, `DataSetsPanel.tsx`; Create `apps/editor/src/modern/kshvi/shared/AsyncState.tsx`, `OfflineBanner.tsx`, `AccessibleCommandDialog.tsx`; Create `packages/kshvi/assets/`; Test `services/kshvi/tests/observability.test.ts`, `resource-budget.test.ts`, `apps/editor/tests/kshvi-accessibility.test.tsx`, `kshvi-async-states.test.tsx`, `kshvi-offline-assets.test.ts`, `kshvi-projector-accessibility.spec.ts`.

**Requirements:** ADM-04, UI-17–UI-19, NF-01, NF-04–NF-05, NF-08, NF-16–NF-21, AC-13–AC-14, AC-17.

**Interfaces:** Produces health/readiness, технические метрики по `correlationId`, очередь тяжёлых заданий, единые состояния загрузки/пусто/нет прав/нет данных/устарело/частичный и полный сбой, локальный набор шрифтов/библиотек/генераторов/справочников.

- [ ] **Step 1: Написать падающие тесты технической приватности и доступной критической команды**

```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OperationsDashboard } from '../src/modern/kshvi/admin/OperationsDashboard';

it('показывает технический сбой без скрытого содержания', () => {
  render(<OperationsDashboard snapshot={degradedOperations} />);
  expect(screen.getByText('Очередь событий превышает порог')).toBeTruthy();
  expect(screen.queryByText('Скрытый замысел стороны')).toBeNull();
});
```

Добавить health/readiness, число/состояние соединений без содержания, очереди/задержки/диск/копии/версии, расхождение NTP, период обрыва, клавиатурное подтверждение, нецветовые статусы, 125 %, длинные таблицы/карты и отсутствие внешних URL в клиентском пакете.

- [ ] **Step 2: Запустить эксплуатационные и интерфейсные проверки**

Run: `npx vitest run services/kshvi/tests/observability.test.ts services/kshvi/tests/resource-budget.test.ts apps/editor/tests/kshvi-accessibility.test.tsx apps/editor/tests/kshvi-async-states.test.tsx apps/editor/tests/kshvi-offline-assets.test.ts`
Expected: FAIL, единые эксплуатационные состояния и локальный пакет не завершены.

- [ ] **Step 3: Реализовать наблюдаемость и устойчивый русский интерфейс**

Техническая панель показывает сервисы/БД/среду, соединения, очереди, задержки, место, копии, ошибки и версии без замысла/вводных/решений/оценок. Метрики включают длительность команд, SSE, проекции, расчёты, размер журнала и копии; оповещения не раскрывают учение. По `correlationId` восстанавливается технический путь без скрытого payload.

Тяжёлые задания получают отдельные лимиты CPU/памяти/очереди; при перегрузке ожидают, не блокируя команды/критические события. Серверное астрономическое время и локальный NTP показывают расхождение/потерю синхронизации. Общие компоненты различают все состояния UI, неизвестное и устаревшее, сохраняют русские даты/числа/единицы, клавиатуру, фокус, текстовые статусы и доступные диалоги.

Собрать локальные шрифты, клиентские библиотеки, атласы, погодные наборы, генераторы PDF/DOCX, знаки и справочники. Экспорт сохраняет версию схемы, легенду, единицы, атрибуцию, страницы и редакцию. Наборы данных показывают источник, версию, лицензию, хеш и пригодность автономного архива.

- [ ] **Step 4: Проверить офлайн-пакет, доступность и проектор**

Run: `npx vitest run services/kshvi/tests/observability.test.ts apps/editor/tests/kshvi-accessibility.test.tsx apps/editor/tests/kshvi-async-states.test.tsx apps/editor/tests/kshvi-offline-assets.test.ts && npx playwright test apps/editor/tests/kshvi-projector-accessibility.spec.ts`
Expected: PASS; 1440×900, 125 % и 1920×1080 читаемы, критические действия доступны с клавиатуры, внешние запросы отсутствуют, технические журналы не содержат секретов/скрытого payload.

- [ ] **Step 5: Зафиксировать эксплуатационный интерфейс и локальные ресурсы**

```bash
git add services/kshvi apps/editor packages/kshvi/assets package-lock.json docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: завершить наблюдаемость и офлайн-интерфейс"
```

### Task 51: Экспозиционный редактор, архивный и автономный показ

**Files:** Create `packages/kshvi/src/exposition/exposition-program.ts`, `exposition-session.ts`, `camera-route.ts`, `audience-policy.ts`; Create `services/kshvi/src/exposition/exposition-service.ts`, `exposition-projection.ts`, `exposition-export.ts`; Create `apps/editor/src/modern/kshvi/exposition/ExpositionEditor.tsx`, `PresenterWorkspace.tsx`, `AudienceProjector.tsx`, `ChapterTimeline.tsx`; Test `packages/kshvi/tests/exposition.test.ts`, `services/kshvi/tests/exposition-privacy.test.ts`, `exposition-origin.test.ts`, `apps/editor/tests/kshvi-exposition.test.tsx`, `kshvi-exposition.spec.ts`.

**Requirements:** AUTO-20–AUTO-22, REPLAY-17, UI-23, CLASS-01 с назначением `EXPOSITION`, AC-28, NF-01, NF-16–NF-18.

**Interfaces:** Consumes принятый `full-simulation`, архив и автономных агентов; Produces `ExpositionProgram`, `ExpositionSession`, `AudiencePolicy`, `startArchiveShow`, `startAutonomousShow`, `continueFromCheckpoint`; официальный архив доступен только для чтения.

- [ ] **Step 1: Написать падающий тест отдельной демонстрационной ветви**

```ts
import { expect, it } from 'vitest';
import { startAutonomousShow } from '../src/exposition/exposition-session';

it('не смешивает автономный показ с официальным учением', () => {
  const before = officialArchive.manifestHash;
  const show = startAutonomousShow({ sourceArchive: officialArchive, program, seed: 42 });
  expect(show.purpose).toBe('EXPOSITION');
  expect(show.branchId).not.toBe(officialArchive.branchId);
  expect(show.officialAssessmentCreated).toBe(false);
  expect(officialArchive.manifestHash).toBe(before);
});
```

Добавить архивный показ без новых случайных исходов, продолжение автономного расчёта от разрешённой точки, повтор сохранённой линии и явное создание новой, главы/камеру/темп/паузы/подписи/ветки, сравнение план/факт, скрытые данные ведущего/аудитории и связь производного архива с источником.

- [ ] **Step 2: Запустить тесты экспозиции**

Run: `npx vitest run packages/kshvi/tests/exposition.test.ts services/kshvi/tests/exposition-privacy.test.ts services/kshvi/tests/exposition-origin.test.ts apps/editor/tests/kshvi-exposition.test.tsx`
Expected: FAIL, экспозиционный контур отсутствует.

- [ ] **Step 3: Реализовать оба источника показа и безопасную аудиторию**

Редактор задаёт главы, ключевые кадры, маршрут камеры, слои, темп, паузы, подписи, пояснения и ветки. Ведущий запускает/останавливает/ускоряет, переходит к главе/моменту, сравнивает замысел/факт, открывает решение и продолжает расчёт от разрешённой точки. Общая карта показывает погоду, динамическую местность, МТО и современные знаки.

Архивный показ использует реплей; автономный использует те же мир/события/агентов/правила, новый сеанс, зерно, журнал и постоянную метку «Экспозиция». Официальные оценки не создаются. Публикация проходит серверную проекцию аудитории и отдельный проекторный профиль; управление ведущего не добавляет закрытые поля в поток. Производный архив содержит программу/пояснения/политику, другой идентификатор и связь происхождения без изменения исходных хешей.

- [ ] **Step 4: Проверить оба показа и приватность проектора**

Run: `npx vitest run packages/kshvi/tests/exposition.test.ts services/kshvi/tests/exposition-privacy.test.ts services/kshvi/tests/exposition-origin.test.ts apps/editor/tests/kshvi-exposition.test.tsx && npx playwright test apps/editor/tests/kshvi-exposition.spec.ts`
Expected: PASS; архивный повтор идентичен, автономный повтор воспроизводит сохранённую линию, исходный архив/оценки неизменны, 1920×1080 не содержит служебных данных и внешних ресурсов.

- [ ] **Step 5: Зафиксировать обязательную экспозицию**

```bash
git add packages/kshvi services/kshvi apps/editor docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: добавить полный экспозиционный режим"
```

**Контрольная точка G4:** функциональный состав, включая архив и экспозицию, собран. До независимой приёмки AC/NF, полной регрессии и оформления доказательств это ещё не релиз.

---

## Этап 6 — цельная интеграция и независимая приёмка

### Task 52: Сквозная контрактная интеграция всех функциональных контуров

**Files:** Create `services/kshvi/tests/contracts/full-domain-contract.test.ts`, `legacy-regression.test.ts`, `openapi-contract.test.ts`; Create `apps/editor/tests/kshvi-full-navigation.spec.ts`; Create `scripts/kshvi-contract-matrix.mjs`; Create `docs/release/kshvi/functional-contract-matrix.json`, `g5-functional-integration.json`; Modify `packages/kshvi/schemas/openapi.json` и профильные JSON Schema по фактическим контрактам.

**Requirements:** GEN-01–GEN-07, CLASS-01–CLASS-04, ROLE-01–ROLE-08, ARCH-01–ARCH-24, PREP-01–PREP-18, ENV-01–ENV-23, ORG-01–ORG-16, MPS-01–MPS-08, LOG-01–LOG-08, DOC-01–DOC-16, RUN-01–RUN-18, COM-01–COM-10, SIM-01–SIM-24, UI-01–UI-23, SYM-01–SYM-10, REPLAY-01–REPLAY-17, AUTO-01–AUTO-22, ADM-01–ADM-11, NF-19.

**Interfaces:** Consumes Tasks 1–51; Produces машинную матрицу каждого функционального требования к реализации, тесту и доказательству, сквозной официальный сценарий и регрессию исторического режима/карты/погоды.

- [ ] **Step 1: Написать падающий тест полной матрицы и единого маршрута пользователя**

```ts
import { expect, it } from 'vitest';
import matrix from '../../../docs/release/kshvi/functional-contract-matrix.json';

it('связывает каждое функциональное требование с реальным доказательством', () => {
  expect(matrix.total).toBe(267);
  expect(matrix.unimplemented).toEqual([]);
  expect(matrix.missingTests).toEqual([]);
  expect(matrix.missingEvidence).toEqual([]);
});
```

Сквозной маршрут проходит современный режим → КШВИ → соседнюю карту/погоду → подготовку/подтверждения/`SEALED` → `ACTIVE/PAUSED/COMPLETED` → реплей/разбор/архив → экспозицию. Отдельно открывается справочник знаков. Проверяются все классы учений и источники инстанций, без расширения `AppMode`.

- [ ] **Step 2: Запустить матрицу до устранения разрывов**

Run: `node scripts/kshvi-contract-matrix.mjs --spec docs/superpowers/specs/2026-11-20-kshvi-modern-design.md --require-total 267 --output docs/release/kshvi/functional-contract-matrix.json && npx vitest run services/kshvi/tests/contracts/full-domain-contract.test.ts`
Expected: FAIL с перечнем непокрытых идентификаторов или несвязанных контрактов; нельзя заменять отсутствующее поведение текстовой пометкой.

- [ ] **Step 3: Устранить функциональные разрывы и синхронизировать контракты**

Для каждого разрыва добавить доменный failing test в модуль-владелец, реализацию и доказательство. Проверить жизненный цикл, изолированные сеансы, полномочия, среду, дерево, силы/базу знаний, технику, МПС, готовность, МТО, построение, карту, документы, связь, вводные, решения, расчёты, наблюдения, знаки, автономность, агентов, реплей, архив, администрирование и экспозицию как единый мир.

OpenAPI/JSON Schema генерируются из фактических типов, старые архивы проверяются версионными контрактами. Чистое ядро не импортирует React, браузерное хранилище и транспорт. Исторический режим, соседняя карта/погода и существующие знания не получают регрессий; их ранее существовавшие ограничения не маскируются под новые функции КШВИ.

- [ ] **Step 4: Проверить полный функциональный и навигационный контур**

Run: `node scripts/kshvi-contract-matrix.mjs --spec docs/superpowers/specs/2026-11-20-kshvi-modern-design.md --require-total 267 --require-complete --output docs/release/kshvi/functional-contract-matrix.json && npx vitest run services/kshvi/tests/contracts && npx playwright test apps/editor/tests/kshvi-full-navigation.spec.ts`
Expected: PASS; 267 требований связаны с реализацией/тестами/доказательствами, сквозной маршрут и регрессии проходят, результаты записаны в `g5-functional-integration.json`.

- [ ] **Step 5: Зафиксировать функциональную интеграцию G5**

```bash
git add packages crates services apps/editor scripts docs/release/kshvi docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: замкнуть контракты всех функциональных требований"
```

### Task 53: Приёмочные сценарии AC-01–AC-10

**Files:** Create `services/kshvi/tests/acceptance/ac01-preparation.test.ts`, `ac02-environment.test.ts`, `ac03-visibility.test.ts`, `ac04-documents.test.ts`, `ac05-inputs.test.ts`, `ac06-communications.test.ts`, `ac07-time.test.ts`, `ac08-replay.test.ts`, `ac09-reconnect.test.ts`, `ac10-branch.test.ts`; Create `scripts/kshvi-run-acceptance.mjs`; Create `docs/release/kshvi/acceptance/AC-01.json` и отдельные файлы аналогичной структуры для каждого критерия через AC-10.

**Requirements:** AC-00–AC-10; связанные GEN, CLASS, ROLE, ARCH, PREP, ENV, DOC, RUN, COM, SIM и REPLAY.

**Interfaces:** Produces исполняемый пакет первых десяти критериев на новой установке, исходные редакции, журналы, хеши, снимки/протоколы, фактические метрики и ограничения по каждому AC.

- [ ] **Step 1: Записать все ожидаемые результаты как падающие проверки**

Каждый файл полностью воспроизводит исходные условия, действия и ожидания спецификации: трёхступенчатую подготовку/два сеанса; неизменность среды; утечки всех каналов; двойную вертикаль/каскад; плановый/реактивный/адаптивный ввод и цикл; отказ/задержку/дубль/бумажную связь; паузу/ускорение/скачок; два вида реплея; обрыв/идемпотентность/смену роли; изоляцию ветви. Запрещена ручная подстановка результата в БД.

- [ ] **Step 2: Запустить AC-01–AC-10 на чистом стенде**

Run: `node scripts/kshvi-run-acceptance.mjs --from 1 --to 10 --fresh-install --offline --evidence docs/release/kshvi/acceptance`
Expected: FAIL при любом несоответствии; протокол содержит конкретный необработанный результат, а не только скриншот экрана.

- [ ] **Step 3: Исправить несоответствия без изменения приёмочных ожиданий**

Каждое исправление снабдить модульным/интеграционным регрессионным тестом. Проверить неизменность исходных версий, серверную фильтрацию, сохранение подписей и событий, отсутствие дубликатов/телепортации/создания ресурсов, человеческое решение для ручных исходов и независимость ветви.

- [ ] **Step 4: Повторить все десять сценариев в другом порядке**

Run: `node scripts/kshvi-run-acceptance.mjs --from 1 --to 10 --fresh-install --offline --reverse --evidence docs/release/kshvi/acceptance`
Expected: PASS для каждого обязательного ожидания AC-01–AC-10; десять JSON содержат `status:"passed"`, команду, коммит, артефакты и пустой список открытых ошибок.

- [ ] **Step 5: Зафиксировать первый пакет приёмки**

```bash
git add services/kshvi/tests/acceptance scripts/kshvi-run-acceptance.mjs docs/release/kshvi/acceptance packages services apps/editor
git commit -m "КШВИ: пройти приёмочные сценарии AC-01–AC-10"
```

### Task 54: Приёмочные сценарии AC-11–AC-20

**Files:** Create `services/kshvi/tests/acceptance/ac11-decision-cycle.test.ts`, `ac12-debrief-archive.test.ts`, `ac13-admin.test.ts`, `ac14-load.test.ts`, `ac15-weather-gaps.test.ts`, `ac16-recovery.test.ts`, `ac17-handover.test.ts`, `ac18-playbook.test.ts`, `ac19-autonomy.test.ts`, `ac20-catalog.test.ts`; Create отдельные `docs/release/kshvi/acceptance/AC-11.json`–`AC-20.json`; Create `apps/editor/tests/acceptance/ac12-ac20.spec.ts`.

**Requirements:** AC-00, AC-11–AC-20; связанные RUN, SIM, REPLAY, ADM, ENV, AUTO и NF.

**Interfaces:** Produces доказательства двустороннего цикла, автономного архива, разделения администрирования, нагрузки, погодных пробелов, восстановления, передачи устройства, плейбука, наращивания и полноты каталога.

- [ ] **Step 1: Записать все ожидаемые результаты как падающие проверки**

Сценарии включают независимые решения/отмену до и после получения; перспективы/метрики/исследование/offline архив; технического администратора/временный доступ; 50 мест и тяжёлый экспорт; погодный пропуск без коэффициента 1; аварийный перезапуск/старая копия; передачу устройства/кэши; известное/неизвестное условие плейбука; нулевую/высокую интенсивность/паузу/скачок; 240 событий и заведомо дефектные записи.

- [ ] **Step 2: Запустить AC-11–AC-20 на чистом стенде**

Run: `node scripts/kshvi-run-acceptance.mjs --from 11 --to 20 --fresh-install --offline --evidence docs/release/kshvi/acceptance`
Expected: FAIL при первом несоответствии; нагрузочный AC-14 дополнительно сохраняет распределения и карточку стенда.

- [ ] **Step 3: Устранить разрывы и повторить модульные регрессии**

Исправления не должны ослаблять независимость сторон, права, автономность, идемпотентность, полноту архива и качество каталога. Для AC-19 подтвердить идентичность двух процессов при разном UI/сетевом порядке и отсутствие вероятностных событий при нуле. Для AC-20 доказать содержательную уникальность и результат репетиции каждого шаблона.

- [ ] **Step 4: Повторить AC-11–AC-20 и проверить автономный просмотр доказательств**

Run: `node scripts/kshvi-run-acceptance.mjs --from 11 --to 20 --fresh-install --offline --reverse --evidence docs/release/kshvi/acceptance && npx playwright test apps/editor/tests/acceptance/ac12-ac20.spec.ts`
Expected: PASS всех обязательных ожиданий; AC-12 открыт без сервисов/Интернета, AC-14 удовлетворяет NF-02–NF-04, все десять протоколов имеют `status:"passed"`.

- [ ] **Step 5: Зафиксировать второй пакет приёмки**

```bash
git add services/kshvi/tests/acceptance apps/editor/tests/acceptance scripts/kshvi-run-acceptance.mjs docs/release/kshvi/acceptance packages services apps/editor
git commit -m "КШВИ: пройти приёмочные сценарии AC-11–AC-20"
```

### Task 55: Приёмочные сценарии AC-21–AC-30, включая экспозицию

**Files:** Create `services/kshvi/tests/acceptance/ac21-morale.test.ts`, `ac22-initial-map.test.ts`, `ac23-logistics-formation.test.ts`, `ac24-readiness.test.ts`, `ac25-intermediary.test.ts`, `ac26-equipment-knowledge.test.ts`, `ac27-opponent.test.ts`, `ac28-exposition.test.ts`, `ac29-terrain.test.ts`, `ac30-symbols.test.ts`; Create отдельные `docs/release/kshvi/acceptance/AC-21.json`–`AC-30.json`; Create `apps/editor/tests/acceptance/ac21-ac30.spec.ts`.

**Requirements:** AC-00, AC-21–AC-30; связанные MPS, PREP, LOG, ORG, AUTO, ENV, SYM, REPLAY и UI.

**Interfaces:** Produces доказательства реального влияния МПС, исходной карты, МТО/построения, готовности, электронного посредника, оснащённости/базы знаний, системного противника, экспозиции, сложной местности и современных знаков.

- [ ] **Step 1: Записать все ожидаемые результаты как падающие проверки**

Построить пороговую пару МПС и контроль несвязанного ресурса; ошибочную/исправленную исходную карту; ограниченные транспорт/дорогу/переправу и ремонт; частичную готовность после `SEALED`; посредника без человека/перехват; сценарные копии базы и повреждение/ремонт; противника с изменением доступной и скрытой обстановки; архивный/автономный показ; лес/болото/распутицу/разлив/переправы; справочник/карту/экспорт знаков без TTF.

- [ ] **Step 2: Запустить AC-21–AC-30 на чистом стенде**

Run: `node scripts/kshvi-run-acceptance.mjs --from 21 --to 30 --fresh-install --offline --evidence docs/release/kshvi/acceptance`
Expected: FAIL при любом отсутствующем причинном эффекте или доказательстве; экспозиция не исключается из обязательного набора.

- [ ] **Step 3: Устранить разрывы и доказать причинность контрольными прогонами**

Для МПС/местности/оснащённости/МТО/готовности сохранить парные входы, единственное различие, след воздействия и контрольные хеши. Для агентов доказать отсутствие чтения истины и изоляцию форков. Для экспозиции — неизменность официального архива/оценок. Для знаков — происхождение, ручное утверждение, версии, читаемость и работу без TTF.

- [ ] **Step 4: Повторить AC-21–AC-30 в другом процессе и на поддерживаемых клиентах**

Run: `node scripts/kshvi-run-acceptance.mjs --from 21 --to 30 --fresh-install --offline --reverse --evidence docs/release/kshvi/acceptance && npx playwright test apps/editor/tests/acceptance/ac21-ac30.spec.ts`
Expected: PASS всех ожиданий AC-21–AC-30; десять протоколов имеют `status:"passed"`, AC-28 содержит оба вида показа, AC-30 содержит проверку исходного SHA-256 и отсутствие TTF.

- [ ] **Step 5: Зафиксировать полный набор из тридцати критериев**

```bash
git add services/kshvi/tests/acceptance apps/editor/tests/acceptance scripts/kshvi-run-acceptance.mjs docs/release/kshvi/acceptance packages services apps/editor
git commit -m "КШВИ: пройти приёмочные сценарии AC-21–AC-30"
```

### Task 56: Эталонный закрытый стенд и нагрузочная приёмка NF-01–NF-05

**Files:** Create `deploy/kshvi/closed-lan/`, `deploy/kshvi/ntp/`, `services/kshvi/tests/performance/load-generator.ts`, `latency-collector.ts`, `fixture-generator.ts`, `resource-isolation.test.ts`; Create `scripts/kshvi-load-test.mjs`, `kshvi-offline-check.mjs`; Create `docs/release/kshvi/nonfunctional/NF-01.json`–`NF-05.json`, `stand-card.json`, `load-distributions.json`.

**Requirements:** NF-01–NF-05, AC-00–AC-01, AC-09, AC-14, ARCH-19.

**Interfaces:** Produces воспроизводимый эталонный набор 100 инстанций/1 000 сил/10 000 событий, 50 соединений/25 активных, распределения p50/p95/p99, время/состояние NTP и доказательства отсутствия внешней сети.

- [ ] **Step 1: Написать падающий нагрузочный тест с жёсткими порогами**

```ts
import { expect, it } from 'vitest';

it('выдерживает эталонную нагрузку без потерь и нарушения p95', () => {
  expect(report.connections).toBe(50);
  expect(report.activeParticipants).toBeGreaterThanOrEqual(25);
  expect(report.delivery.p95Ms).toBeLessThanOrEqual(5000);
  expect(report.map.p95Ms).toBeLessThanOrEqual(2000);
  expect(report.confirmedLost).toBe(0);
  expect(report.duplicateEffects).toBe(0);
});
```

Нагрузка включает 5 команд/с устойчиво и 20 команд/с 60 с, одновременную карту/документы/связь/расчёты/реплей/архивный экспорт. Отдельные проверки: 2 места, 50 мест, отключение внешней сети, сценарная задержка отделена от инфраструктурной, ручной перевод часов клиента не меняет оперативное время.

- [ ] **Step 2: Запустить стенд до оптимизации**

Run: `node scripts/kshvi-load-test.mjs --connections 50 --active 25 --rate 5 --burst-rate 20 --burst-seconds 60 --output docs/release/kshvi/nonfunctional/load-distributions.json`
Expected: FAIL при превышении любого порога или потере; среднее значение не заменяет распределения.

- [ ] **Step 3: Настроить закрытый контур и устранить узкие места измеримо**

Локально развернуть PostgreSQL, сервисы, TLS, NTP, клиентские ресурсы, карты/погоду/генераторы/справочники. Карточка стенда фиксирует CPU/ОЗУ/сеть/версии браузеров. Оптимизировать проекции/outbox/SSE/снимки и лимиты тяжёлых заданий без снижения прав, долговременности и порядка. Каждая оптимизация получает до/после и регрессионный тест.

- [ ] **Step 4: Повторить нагрузку, всплеск и полное отключение внешней сети**

Run: `node scripts/kshvi-offline-check.mjs --deny-external --output docs/release/kshvi/nonfunctional/offline.json && node scripts/kshvi-load-test.mjs --connections 50 --active 25 --rate 5 --burst-rate 20 --burst-seconds 60 --output docs/release/kshvi/nonfunctional/load-distributions.json`
Expected: PASS; p95 доставки ≤ 5 с, карты ≤ 2 с, подтверждённые команды не потеряны/не продублированы, экспорт не нарушает сроки, NF-01–NF-05 имеют отдельные пройденные протоколы.

- [ ] **Step 5: Зафиксировать стенд и фактические показатели**

```bash
git add deploy/kshvi services/kshvi/tests/performance scripts/kshvi-load-test.mjs scripts/kshvi-offline-check.mjs docs/release/kshvi/nonfunctional
git commit -m "КШВИ: подтвердить закрытый контур и нагрузку"
```

### Task 57: Безопасность, восстановление и воспроизводимость NF-06–NF-15

**Files:** Create `services/kshvi/tests/security/authentication.test.ts`, `tenant-isolation.test.ts`, `log-redaction.test.ts`, `security-audit.test.ts`, `distribution-labels.test.ts`; Create `services/kshvi/tests/recovery/rpo-zero.test.ts`, `recovery-time.test.ts`, `backup-schedule.test.ts`, `reconnect.test.ts`, `archive-compatibility.test.ts`; Create `scripts/kshvi-security-acceptance.mjs`, `kshvi-recovery-acceptance.mjs`; Create `docs/release/kshvi/nonfunctional/NF-06.json`–`NF-15.json`.

**Requirements:** NF-06–NF-15, ADM-01–ADM-11, ARCH-09, ARCH-18, REPLAY-15, AC-03, AC-08–AC-09, AC-12–AC-13, AC-16–AC-17.

**Interfaces:** Produces протоколы каждого NF с фактическими проверками API/SSE/файлов/заданий, RPO/RTO, копий, reconnect и идентичности архивов на поддерживаемых версиях.

- [ ] **Step 1: Написать падающий набор безопасности и отказов**

Проверки включают срок/отзыв сессии, локальный TLS, хеширование паролей, секреты, организацию каждого ресурса, редактирование технических логов, append-only аудит, метки/отсутствие заявления сертификации; отказ после commit до ответа, RPO 0, перезапуск ≤ 5 мин, узел ≤ 30 мин, расписание копий/пробное восстановление, обрыв/смену прав и старый reducer.

- [ ] **Step 2: Запустить NF-06–NF-15 до устранения несоответствий**

Run: `node scripts/kshvi-security-acceptance.mjs --evidence docs/release/kshvi/nonfunctional && node scripts/kshvi-recovery-acceptance.mjs --evidence docs/release/kshvi/nonfunctional`
Expected: FAIL при любом раскрытии, потере, превышении времени или расхождении хеша; частичный успех группы не засчитывается.

- [ ] **Step 3: Устранить риски без скрытого ослабления контроля**

Все endpoints/SSE/экспорты/jobs проверяют авторизацию и организацию. Логи очищаются от паролей/токенов/закрытого содержания; аудит неизменяем. Подтверждение отправляется после durable commit, повторы используют прежний ключ. Копии проверяются хешами и восстановлением. При reconnect новые права применяются до данных. Новая версия использует старый reducer либо явную несовместимую метку.

- [ ] **Step 4: Повторить атаки доступа и аварийные сценарии на новой установке**

Run: `node scripts/kshvi-security-acceptance.mjs --fresh-install --evidence docs/release/kshvi/nonfunctional && node scripts/kshvi-recovery-acceptance.mjs --fresh-install --evidence docs/release/kshvi/nonfunctional`
Expected: PASS NF-06–NF-15; фактические RPO/RTO соответствуют целям, контрольные хеши архивов совпадают, открытые уязвимости/потери/несанкционированные выдачи отсутствуют.

- [ ] **Step 5: Зафиксировать протоколы безопасности и восстановления**

```bash
git add services/kshvi/tests/security services/kshvi/tests/recovery scripts/kshvi-security-acceptance.mjs scripts/kshvi-recovery-acceptance.mjs docs/release/kshvi/nonfunctional
git commit -m "КШВИ: подтвердить безопасность и восстановление"
```

### Task 58: Сопровождение, переносимость и уровни автоматизации NF-16–NF-22

**Files:** Create `apps/editor/tests/i18n/russian-consistency.test.ts`, `accessibility/full-workspace.spec.ts`, `export/local-formats.test.ts`; Create `packages/kshvi/tests/contracts/schema-purity.test.ts`, `archive-migration.test.ts`; Create `services/kshvi/tests/contracts/test-pyramid.test.ts`; Create `scripts/kshvi-nf-quality.mjs`, `kshvi-test-pyramid.mjs`; Create `docs/release/kshvi/nonfunctional/NF-16.json`–`NF-22.json`, `test-pyramid.json`; Create `docs/kshvi-user-guide.md`, `docs/kshvi-operations-guide.md`.

**Requirements:** NF-16–NF-22, UI-01–UI-23, ARCH-01–ARCH-03, REPLAY-14–REPLAY-15, AC-00, AC-12, AC-18, AC-20, AC-28, AC-30.

**Interfaces:** Produces русское руководство пользователя/эксплуатации, проверки разрешений/клавиатуры/форматов/атрибуции, чистых контрактов и автоматизированной пирамиды модульных → контрактных → интеграционных → E2E → нагрузочных/аварийных тестов.

- [ ] **Step 1: Написать падающие проверки качества и обязательных уровней NF-22**

```ts
import { expect, it } from 'vitest';
import pyramid from '../../../docs/release/kshvi/test-pyramid.json';

it('содержит все обязательные уровни автоматизации', () => {
  expect(pyramid.levels.map(level => level.kind)).toEqual([
    'unit', 'contract', 'integration', 'endToEnd', 'loadAndRecovery',
  ]);
  expect(pyramid.levels.every(level => level.status === 'passed' && level.command)).toBe(true);
});
```

Добавить русские ошибки/печать/руководство, единые даты/единицы, 1440×900/125 %/1920×1080, клавиатуру/нецветовые статусы/длинные панели, локальные PDF/DOCX/JSON/архив, схемы/миграции/чистое ядро, health/metrics/correlationId и лицензии атласов.

- [ ] **Step 2: Запустить NF-16–NF-22 до завершения сопровождения**

Run: `node scripts/kshvi-nf-quality.mjs --from 16 --to 22 --evidence docs/release/kshvi/nonfunctional`
Expected: FAIL при любом непроверенном разрешении, формате, контракте, уровне тестов или отсутствующем руководстве.

- [ ] **Step 3: Завершить документацию, переносимость и тестовую пирамиду**

Руководства описывают реальные роли/подготовку/проведение/разбор/архив/экспозицию и техническое дежурство/копии/инциденты/обновления без выдуманных возможностей. Исправить интерфейсные дефекты и контракты с регрессионными тестами. Автоматизировать модульные тесты всех доменов, контракты схем/проекций/миграций, интеграции PostgreSQL/среды/связи/агентов, E2E критических ролей и нагрузочные/аварийные сценарии; каждый уровень имеет команду, свежий результат и артефакты.

- [ ] **Step 4: Проверить всю группу NF-16–NF-22 на чистой установке**

Run: `node scripts/kshvi-nf-quality.mjs --from 16 --to 22 --fresh-install --offline --evidence docs/release/kshvi/nonfunctional && node scripts/kshvi-test-pyramid.mjs --require-complete --output docs/release/kshvi/test-pyramid.json`
Expected: PASS; все семь протоколов пройдены, пять уровней NF-22 автоматизированы и зелёные, документы/архивы открываются локально, атрибуция и версии сохранены.

- [ ] **Step 5: Зафиксировать сопровождение и доказательства качества**

```bash
git add apps/editor packages services scripts docs/release/kshvi docs/kshvi-user-guide.md docs/kshvi-operations-guide.md docs/system.md docs/img docs/system.pdf docs/system.docx
git commit -m "КШВИ: завершить сопровождение и приёмку качества"
```

**Контрольная точка G6:** все AC/NF имеют пройденные отдельные протоколы. Остаётся единая чистая регрессия, документарная сверка и окончательный релизный барьер.

---

## Этап 7 — полная регрессия и выпуск версии 1.0

### Task 59: Полная чистая проверка, документация, ведомость ограничений и релизный барьер

**Files:** Create `docs/release/kshvi/final-evidence-index.json`, `limitations.json`, `release-manifest.json`, `acceptance-summary.md`; Create `scripts/kshvi-final-verify.mjs`; Modify `docs/release/kshvi/requirements.json`; Modify `docs/system.md`, затронутые `docs/img/*.jpg`, `docs/system.pdf`, `docs/system.docx`, при применимости `packages/knowledge/data/seed.json` и `packages/knowledge/data/model-index.json`; Test `scripts/tests/kshvi-final-verify.test.mjs`.

**Requirements:** все 267 функциональных требований, NF-01–NF-22, AC-00–AC-30, все обязательные группы и экспозиционный режим; окончательный G7.

**Interfaces:** Consumes все доказательства Tasks 1–58; Produces единый индекс доказательств и `node scripts/kshvi-release-gate.mjs --require-complete`, успешный только при полном продукте, закрытых ограничениях и актуальных документах.

- [ ] **Step 1: Написать падающий финальный тест полноты и неприемлемости открытых ограничений**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { finalReleaseGaps } from '../kshvi-final-verify.mjs';

test('открытое ограничение или экспозиция без доказательства блокирует релиз', () => {
  const gaps = finalReleaseGaps({
    functionalPassed: 267,
    nfPassed: 22,
    acPassed: 30,
    expositionPassed: true,
    openLimitations: [{ id: 'L1', severity: 'blocker' }],
    fullChecksPassed: true,
  });
  assert.deepEqual(gaps, ['OPEN_LIMITATION:L1']);
});
```

Добавить случаи 266/267 функциональных, 21/22 NF, 29/30 AC, отсутствующей экспозиции, несуществующего доказательства, устаревшего коммита, неполного архива и неудачной регрессии. Каждый обязан блокировать выпуск.

- [ ] **Step 2: Запустить финальный тест до формирования индекса**

Run: `node --test scripts/tests/kshvi-final-verify.test.mjs`
Expected: FAIL, окончательный верификатор и полный индекс ещё не существуют.

- [ ] **Step 3: Выполнить чистую регрессию и собрать окончательные документы**

На новой установке без внешней сети выполнить:

```bash
npm ci
npm run typecheck 2>&1 | tail -3
npm test 2>&1 | grep -E "Test Files|Tests |FAIL"
cargo test --workspace
node scripts/kshvi-contract-matrix.mjs --require-total 267 --require-complete
node scripts/kshvi-run-acceptance.mjs --from 1 --to 30 --fresh-install --offline --evidence docs/release/kshvi/acceptance
node scripts/kshvi-nf-quality.mjs --from 1 --to 22 --fresh-install --offline --evidence docs/release/kshvi/nonfunctional
node scripts/kshvi-test-pyramid.mjs --require-complete --output docs/release/kshvi/test-pyramid.json
node scripts/voice-e2e.mjs
npm run docs:system
```

Дополнительно запустить существующие E2E карты/погоды/исторического режима и все КШВИ Playwright, повторить offline архив/экспозицию, восстановление и нагрузку на эталонном стенде. Если затронуты часть II описания или код/нормативы модели, выполнить `npm run kb:seed` и `npm run model:index` и проверить связанные тесты. Переснять все изменённые интерфейсы Playwright при 1440×900 в JPEG, проверить подписи и фактически видимое содержимое.

Свести доказательства в индекс: идентификатор, владелец, команда, коммит, хеш, журнал, снимки, метрики, протокол. `limitations.json` содержит только закрытые записи с доказательством устранения; любое открытое функциональное, методическое, лицензионное, производительное или эксплуатационное ограничение блокирует заявление полного релиза. Не объявлять сертификацию секретности и не переносить исторические нормативы.

- [ ] **Step 4: Запустить окончательный барьер и проверить его отрицательное управление**

Run: `node --test scripts/tests/kshvi-final-verify.test.mjs && node scripts/kshvi-final-verify.mjs --spec docs/superpowers/specs/2026-11-20-kshvi-modern-design.md --require-functional 267 --require-nf 22 --require-ac 30 --require-exposition --output docs/release/kshvi/final-evidence-index.json && node scripts/kshvi-release-gate.mjs --require-complete`
Expected: PASS; машинно подтверждены 267 функциональных требований, 22 NF, 30 AC, экспозиция, полные проверки, актуальные документы и отсутствие открытых ограничений. Отдельный negative-control с удалённым доказательством должен завершиться FAIL.

- [ ] **Step 5: Зафиксировать выпуск только после зелёного барьера**

```bash
git add docs/release/kshvi docs/system.md docs/img docs/system.pdf docs/system.docx docs/kshvi-user-guide.md docs/kshvi-operations-guide.md packages/knowledge/data scripts/kshvi-final-verify.mjs scripts/tests/kshvi-final-verify.test.mjs
node scripts/kshvi-release-gate.mjs --require-complete
git commit -m "КШВИ: выпустить полный современный контур"
```

**Контрольная точка G7 — полный релиз:** разрешена только после успешного последнего `--require-complete`. Если хотя бы один тест, AC, NF, функциональный идентификатор, обязательный архивный компонент, методический статус или экспозиционный сценарий не закрыт, статус остаётся «не выпущено»; никакой промежуточный G0–G6 не подменяет этот результат.
