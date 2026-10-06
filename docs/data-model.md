# Модель данных: реестр объектов и время

## Идея

Карта (документ) — это **знаки**: как и где нарисовано. Реестр — это **объекты**:
что обозначено и какими характеристиками обладает. Один объект («150-я стрелковая
дивизия») может быть обозначен знаками на многих картах; характеристики хранятся
один раз — в реестре — и видны со всех карт.

И у знаков, и у объектов есть время:

| Что | Где хранится | Как меняется во времени |
|---|---|---|
| Присутствие знака на карте | документ, `feature.time = {from, to}` | период [from, to) |
| Положение знака | документ, `feature.keyframes[] = {t, points/at}` | ступенчато: с момента t — новая геометрия |
| Постоянные характеристики объекта (номер, род войск) | реестр, `entity.attrs` | не меняются |
| Временные характеристики (командир, численность, подчинение, положение) | реестр, факты `fact = {validFrom, validTo?, attrs, geometry?, source}` | с validFrom по validTo; более поздний факт перекрывает более ранний |

Момент времени — строка ISO 8601 (`1945-04-25` или `1945-04-25T06:00`); без часового
пояса трактуется как UTC. Период — [from, to): from включительно, to — нет.

Карта показывает обстановку **на выбранный момент**: `documentAt(doc, t)` убирает
отсутствующие знаки и подставляет геометрию из ключевых кадров; отрисовка,
привязка стрелок к линиям фронта и экспорт работают поверх этого без изменений.

Контракт — в `packages/core/src/temporal.ts` и `packages/core/src/registry.ts`
(типы, `stateAt`, `validateAttrs`, встроенные типы объектов `ENTITY_TYPES`).

## Типы объектов и схемы характеристик

Тип объекта задаёт поля: `{key, label, type, temporal?, required?, unit?, options?, refType?}`.
Типы значений: `string`, `text`, `integer`, `number`, `boolean`, `date`, `enum`, `ref`
(ссылка на другой объект, например «Подчинение» → вышестоящее формирование).

Встроенные типы: **Формирование** (номер, ступень, род войск; во времени — подчинение,
командир, положение, численность, танки, орудия, потери, почётные наименования),
**Сооружение** (вид, материал; во времени — состояние, кто занимает, гарнизон),
**Населённый пункт / объект местности** (во времени — контроль, кто удерживает),
**Операция, бой** (период, масштаб, замысел, итог; во времени — этап).

Организация может добавлять свои типы и поля; поля, которых нет в схеме,
тоже допускаются (произвольные характеристики).

## Хранение (PostgreSQL + PostGIS)

Одна база, у каждого сервиса своя схема; сервис сам накатывает свои миграции
(`@def-ops/db`: `migrate(pool, schema, migrations)`), чужие схемы не читает.

### Схема `registry` (сервис реестра)

```sql
entity_types(tenant text, id text, name text, description text, fields jsonb, builtin bool,
             primary key (tenant, id))           -- встроенные типы — tenant '*'
entities(tenant text, id uuid, type text, name text, short_name text, side text,
         attrs jsonb, existence tstzrange, source text, created_at, updated_at,
         primary key (tenant, id))
facts(tenant text, id uuid, entity_id uuid, valid tstzrange,   -- [validFrom, validTo)
      attrs jsonb, geom geometry(Geometry, 4326), source text, note text, created_at,
      primary key (tenant, id))
-- индексы: gist(valid), gist(geom), (tenant, entity_id), gin(attrs), поиск по имени
```

Пространственно-временной запрос «какие объекты были в этом районе на 25 апреля»:
для каждого объекта берётся последний действующий на момент факт с положением и
проверяется пересечение с прямоугольником (`ST_Intersects`).

### Схема `documents` (сервис документов)

```sql
documents(tenant, id, name, revision, data jsonb, created_at, updated_at)
document_revisions(tenant, id, revision, data jsonb, updated_at)   -- последние 50
```

Документ хранится целиком (JSON), как и раньше; файловое хранилище осталось для
работы без СУБД (`STORAGE=file`).

## API реестра (через шлюз: `/api/registry/...`)

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/registry/types` | типы объектов (встроенные и организации) |
| PUT | `/registry/types/{id}` | создать/изменить тип организации (встроенный — только добавить поля) |
| GET | `/registry/entities?q=&type=&side=&at=&bbox=&limit=` | поиск; с `at` — с состоянием на момент; с `bbox` и `at` — объекты в районе на момент |
| POST | `/registry/entities` | создать объект (постоянные характеристики проверяются по схеме) |
| GET | `/registry/entities/{id}?at=` | объект; с `at` — состояние на момент |
| PATCH | `/registry/entities/{id}` | изменить постоянные характеристики |
| DELETE | `/registry/entities/{id}` | удалить объект с фактами |
| GET | `/registry/entities/{id}/facts` | все факты по времени |
| POST | `/registry/entities/{id}/facts` | добавить факт (временные характеристики и/или положение с даты) |
| PATCH / DELETE | `/registry/entities/{id}/facts/{factId}` | исправить / удалить факт |
| GET | `/registry/entities/{id}/history?key=` | история одной характеристики |
| POST | `/registry/states` | состояния многих объектов на момент: `{ids, at}` (для карты) |

Изменения реестра публикуются в поток событий реестра `GET /registry/events`
(Server-Sent Events: `entity.created`, `entity.updated`, `entity.deleted`,
`fact.changed`), чтобы открытые карты обновляли характеристики сразу.
