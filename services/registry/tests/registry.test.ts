/**
 * Поведение сервиса реестра. Один и тот же набор тестов выполняется для хранилища
 * в памяти и для PostgreSQL/PostGIS (только если задан DATABASE_URL; схема —
 * временная registry_test_<случайное>, удаляется после тестов).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { stateAt, type Entity, type Fact } from '@def-ops/core';
import { MemoryRepo, type RegistryRepo } from '../src/repo';
import { PgRepo } from '../src/pg-repo';
import { EventBus } from '../src/events';
import { buildRouter } from '../src/app';
import { normTime } from '../src/validate';

type Setup = () => Promise<{ repo: RegistryRepo; cleanup: () => Promise<void> }>;

function behaviour(name: string, setup: Setup, skip = false) {
  describe.skipIf(skip)(`реестр: ${name}`, () => {
    let base = '';
    let done: () => Promise<void> = async () => undefined;

    beforeAll(async () => {
      const { repo, cleanup } = await setup();
      const svc = createService({ name: 'registry', port: 0, router: buildRouter(repo, new EventBus()) });
      const port = await svc.listen();
      base = `http://127.0.0.1:${port}`;
      done = async () => { await svc.close(); await cleanup(); };
    });
    afterAll(() => done());

    const call = async (method: string, path: string, body?: unknown, tenant = 'orgA') => {
      const r = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    };
    const get = (p: string, t?: string) => call('GET', p, undefined, t);
    const post = (p: string, b: unknown, t?: string) => call('POST', p, b, t);

    const division = (over: Record<string, unknown> = {}) => ({
      type: 'formation', name: '150-я стрелковая Идрицкая дивизия', shortName: '150 сд', side: 'own',
      attrs: { number: '150', echelon: 'division', branch: 'rifle' }, existence: { from: '1943-06-01' }, source: 'ЦАМО', ...over,
    });
    const point = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });

    let div: Entity;

    it('типы: встроенные и организации; встроенный тип — только добавление полей', async () => {
      const t = await get('/registry/types');
      expect(t.status).toBe(200);
      expect(t.body.map((x: { id: string }) => x.id)).toEqual(['formation', 'structure', 'place', 'operation']);

      // свой тип организации
      const own = await call('PUT', '/registry/types/airfield', {
        name: 'Аэродром', description: 'Полевой аэродром',
        fields: [{ key: 'surface', label: 'Покрытие', type: 'enum', options: [{ value: 'grass', label: 'грунт' }, { value: 'concrete', label: 'бетон' }] },
          { key: 'planes', label: 'Самолёты', type: 'integer', temporal: true, unit: 'ед.' }],
      });
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ id: 'airfield', name: 'Аэродром', builtin: false });

      // к встроенному типу добавляется поле; встроенные поля можно не передавать
      const ext = await call('PUT', '/registry/types/formation', { fields: [{ key: 'archive', label: 'Архивный фонд', type: 'string' }] });
      expect(ext.status).toBe(200);
      expect(ext.body.builtin).toBe(true);
      expect(ext.body.name).toBe('Формирование');
      expect(ext.body.fields.map((f: { key: string }) => f.key)).toContain('number');
      expect(ext.body.fields.at(-1).key).toBe('archive');

      // изменить встроенное поле нельзя
      const bad = await call('PUT', '/registry/types/formation', { fields: [{ key: 'number', label: 'Номер', type: 'integer', required: true }] });
      expect(bad.status).toBe(422);
      expect(bad.body.error.message).toContain('«Номер» — поле встроенного типа');
      // некорректное описание поля
      expect((await call('PUT', '/registry/types/x1', { name: 'X', fields: [{ key: 'e', label: 'E', type: 'enum' }] })).status).toBe(422);
      expect((await call('PUT', '/registry/types/x2', { fields: [] })).status).toBe(422);

      const all = (await get('/registry/types')).body;
      expect(all.map((x: { id: string }) => x.id)).toEqual(['formation', 'structure', 'place', 'operation', 'airfield']);
      // другие организации изменений не видят
      const b = (await get('/registry/types', 'orgB')).body;
      expect(b.map((x: { id: string }) => x.id)).toEqual(['formation', 'structure', 'place', 'operation']);
      expect(b[0].fields.some((f: { key: string }) => f.key === 'archive')).toBe(false);
    });

    it('создание объекта: проверка постоянных характеристик по схеме', async () => {
      const r = await post('/registry/entities', division({ attrs: { number: '150', echelon: 'division', branch: 'rifle', archive: 'ф. 1234' } }));
      expect(r.status).toBe(201);
      div = r.body;
      expect(div.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(div).toMatchObject({ type: 'formation', shortName: '150 сд', side: 'own', existence: { from: '1943-06-01', to: null } });
      expect(div.createdAt).toBe(div.updatedAt);

      const missing = await post('/registry/entities', division({ attrs: { echelon: 'division' } }));
      expect(missing.status).toBe(422);
      expect(missing.body.error.message).toContain('«Номер» — обязательное поле');
      const temporal = await post('/registry/entities', division({ attrs: { number: '1', echelon: 'division', commander: 'Шатилов' } }));
      expect(temporal.status).toBe(422);
      expect(temporal.body.error.message).toContain('«Командир» меняется во времени');
      const badEnum = await post('/registry/entities', division({ attrs: { number: '1', echelon: 'legion' } }));
      expect(badEnum.body.error.message).toContain('«Ступень»: недопустимое значение «legion»');
      expect((await post('/registry/entities', division({ type: 'ufo' }))).status).toBe(422);
      expect((await post('/registry/entities', division({ name: '  ' }))).status).toBe(422);
      expect((await post('/registry/entities', division({ side: 'red' }))).status).toBe(422);
      expect((await post('/registry/entities', division({ existence: { from: '1945-01-01', to: '1944-01-01' } }))).status).toBe(422);
      expect((await post('/registry/entities', division({ existence: { from: 'вчера' } }))).status).toBe(422);
      expect((await post('/registry/entities', [1, 2])).status).toBe(400);
    });

    it('факты: проверка, состояние на момент, история', async () => {
      const add = (b: unknown) => post(`/registry/entities/${div.id}/facts`, b);
      const f1 = await add({ validFrom: '1945-04-16', attrs: { commander: 'В. М. Шатилов', personnel: 9000, status: 'offensive' }, geometry: point(14.3, 52.6), source: 'ЖБД' });
      expect(f1.status).toBe(201);
      expect(f1.body).toMatchObject({ entityId: div.id, validFrom: '1945-04-16', validTo: null, geometry: point(14.3, 52.6), source: 'ЖБД' });
      const f2 = await add({ validFrom: '1945-04-29T06:00', attrs: { personnel: 7200 }, geometry: point(13.38, 52.52) });
      expect(f2.status).toBe(201);
      // ограниченный по времени факт и факт без положения
      const f3 = await add({ validFrom: '1945-04-20', validTo: '1945-04-22', attrs: { status: 'defense' } });
      expect(f3.body.validTo).toBe('1945-04-22');
      // момент с часовым поясом приводится к UTC
      const f4 = await add({ validFrom: '1945-05-02T03:00:00+03:00', attrs: { honorifics: 'Идрицкая', personnel: null } });
      expect(f4.body.validFrom).toBe('1945-05-02');

      // ошибки
      const e1 = await add({ validFrom: '25 апреля', attrs: { personnel: 1 } });
      expect(e1.status).toBe(422);
      expect(e1.body.error.message).toContain('validFrom');
      expect((await add({ validFrom: '1945-04-25', validTo: '1945-04-25', attrs: { personnel: 1 } })).body.error.message).toContain('validTo должен быть позже validFrom');
      expect((await add({ validFrom: '1945-04-25', attrs: { number: '151' } })).body.error.message).toContain('«Номер» — постоянная характеристика');
      expect((await add({ validFrom: '1945-04-25', attrs: { personnel: 'много' } })).body.error.message).toContain('«Численность»: ожидается целое число');
      expect((await add({ validFrom: '1945-04-25' })).status).toBe(422);
      expect((await add({ validFrom: '1945-04-25', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] } })).status).toBe(422);
      expect((await add({ validFrom: '1945-04-25', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } })).body.error.message).toContain('замкнут');
      expect((await add({ validFrom: '1945-04-25', geometry: point(200, 10) })).body.error.message).toContain('вне диапазона');
      expect((await add({ validFrom: '1945-04-25', geometry: { type: 'Circle', coordinates: [0, 0] } })).status).toBe(422);
      expect((await post('/registry/entities/00000000-0000-4000-8000-000000000000/facts', { validFrom: '1945-04-25', attrs: { personnel: 1 } })).status).toBe(404);

      // факты — по времени
      const facts: Fact[] = (await get(`/registry/entities/${div.id}/facts`)).body;
      expect(facts.map((f) => f.id)).toEqual([f1.body.id, f3.body.id, f2.body.id, f4.body.id]);

      // состояние на моменты между фактами
      const at = async (t: string) => (await get(`/registry/entities/${div.id}?at=${encodeURIComponent(t)}`)).body;
      const s0 = await at('1945-04-10');
      expect(s0.entity.id).toBe(div.id);
      expect(s0.state).toMatchObject({ exists: true, geometry: null, attrs: { number: '150', echelon: 'division' } });
      expect(s0.state.attrs.personnel).toBeUndefined();
      const s1 = await at('1945-04-21');
      expect(s1.state.attrs).toMatchObject({ personnel: 9000, status: 'defense', commander: 'В. М. Шатилов' });
      expect(s1.state.geometry).toEqual(point(14.3, 52.6));
      expect(s1.state.from.status).toBe(f3.body.id);
      const s2 = await at('1945-04-25');
      expect(s2.state.attrs.status).toBe('offensive'); // ограниченный факт закончился
      const s3 = await at('1945-04-29T05:59');
      expect(s3.state.attrs.personnel).toBe(9000);
      const s4 = await at('1945-04-29T06:00');
      expect(s4.state.attrs.personnel).toBe(7200);
      expect(s4.state.geometry).toEqual(point(13.38, 52.52));
      const s5 = await at('1945-05-09');
      expect(s5.state.attrs.personnel).toBeUndefined(); // null — значение снято
      expect(s5.state.attrs.honorifics).toBe('Идрицкая');
      expect((await at('1943-01-01')).state.exists).toBe(false);
      // ровно то же, что считает stateAt из ядра (редактор и сервис согласованы)
      for (const t of ['1945-04-10', '1945-04-21', '1945-04-29T06:00', '1945-05-09']) {
        expect((await at(t)).state).toEqual(stateAt(div, facts, normTime(t)));
      }
      expect((await get(`/registry/entities/${div.id}?at=потом`)).status).toBe(400);
      expect((await get(`/registry/entities/${div.id}`)).body).toEqual({ entity: div });

      // история характеристики
      const h = await get(`/registry/entities/${div.id}/history?key=personnel`);
      expect(h.body.map((x: { value: unknown }) => x.value)).toEqual([9000, 7200, null]);
      expect(h.body[1]).toMatchObject({ t: '1945-04-29T06:00', factId: f2.body.id });
      expect((await get(`/registry/entities/${div.id}/history`)).status).toBe(400);
    });

    it('правка и удаление фактов', async () => {
      const f = (await post(`/registry/entities/${div.id}/facts`, { validFrom: '1945-03-01', attrs: { guns: 120 }, note: 'черновик' })).body;
      const p = await call('PATCH', `/registry/entities/${div.id}/facts/${f.id}`, { validTo: '1945-04-01', note: null, geometry: point(15, 52) });
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ id: f.id, validFrom: '1945-03-01', validTo: '1945-04-01', attrs: { guns: 120 }, geometry: point(15, 52) });
      expect(p.body.note).toBeUndefined();
      expect(p.body.createdAt).toBe(f.createdAt);
      expect((await call('PATCH', `/registry/entities/${div.id}/facts/${f.id}`, { validTo: '1945-02-01' })).status).toBe(422);
      expect((await call('PATCH', `/registry/entities/${div.id}/facts/${f.id}`, { attrs: { echelon: 'army' } })).status).toBe(422);
      // снять положение
      const ng = await call('PATCH', `/registry/entities/${div.id}/facts/${f.id}`, { geometry: null });
      expect(ng.body.geometry).toBeUndefined();
      expect((await call('DELETE', `/registry/entities/${div.id}/facts/${f.id}`)).status).toBe(204);
      expect((await call('DELETE', `/registry/entities/${div.id}/facts/${f.id}`)).status).toBe(404);
      expect((await call('PATCH', `/registry/entities/${div.id}/facts/not-a-uuid`, {})).status).toBe(404);
    });

    it('изменение объекта: слияние attrs, проверка, оптимистичная блокировка', async () => {
      const p = await call('PATCH', `/registry/entities/${div.id}`, { attrs: { branch: null, archive: 'ф. 5678' }, shortName: '150 сд (Идрицкая)', updatedAt: div.updatedAt });
      expect(p.status).toBe(200);
      expect(p.body.attrs).toEqual({ number: '150', echelon: 'division', archive: 'ф. 5678' });
      expect(p.body.shortName).toBe('150 сд (Идрицкая)');
      expect(p.body.createdAt).toBe(div.createdAt);
      expect(Date.parse(p.body.updatedAt)).toBeGreaterThan(Date.parse(div.updatedAt!));
      // устаревшая отметка — конфликт
      expect((await call('PATCH', `/registry/entities/${div.id}`, { name: 'X', updatedAt: div.updatedAt })).status).toBe(409);
      // проверка по схеме и неизменяемость типа
      expect((await call('PATCH', `/registry/entities/${div.id}`, { attrs: { number: null } })).body.error.message).toContain('«Номер» — обязательное поле');
      expect((await call('PATCH', `/registry/entities/${div.id}`, { attrs: { personnel: 5 } })).status).toBe(422);
      expect((await call('PATCH', `/registry/entities/${div.id}`, { type: 'place' })).status).toBe(422);
      // null у необязательного поля — снять значение
      const q = await call('PATCH', `/registry/entities/${div.id}`, { source: null, existence: null });
      expect(q.body.source).toBeUndefined();
      expect(q.body.existence).toBeUndefined();
      div = (await call('PATCH', `/registry/entities/${div.id}`, { existence: { from: '1943-06-01' } })).body;
      expect((await get(`/registry/entities/${div.id}`)).body.entity).toEqual(div);
      expect((await call('PATCH', '/registry/entities/00000000-0000-4000-8000-000000000000', { name: 'X' })).status).toBe(404);
    });

    it('поиск: текст, тип, сторона, лимит; состояние на момент', async () => {
      await post('/registry/entities', { type: 'formation', name: '171-я стрелковая дивизия', shortName: '171 сд', side: 'own', attrs: { number: '171', echelon: 'division' } });
      await post('/registry/entities', { type: 'formation', name: '9-я парашютная дивизия', side: 'enemy', attrs: { number: '9', echelon: 'division' } });
      await post('/registry/entities', { type: 'place', name: 'Рейхстаг', attrs: { kind: 'other' } });
      await post('/registry/entities', { type: 'formation', name: '100% условная_часть', attrs: { number: 'x', echelon: 'company' } });

      const names = async (qs: string) => (await get(`/registry/entities${qs}`)).body.map((e: Entity) => e.name);
      expect(await names('?q=' + encodeURIComponent('СТРЕЛКОВАЯ'))).toEqual(['150-я стрелковая Идрицкая дивизия', '171-я стрелковая дивизия']);
      expect(await names('?q=' + encodeURIComponent('171 СД'))).toEqual(['171-я стрелковая дивизия']);
      expect(await names('?q=9')).toEqual(['9-я парашютная дивизия']);
      expect(await names('?q=' + encodeURIComponent('%'))).toEqual(['100% условная_часть']);
      expect(await names('?q=' + encodeURIComponent('_'))).toEqual(['100% условная_часть']);
      expect(await names('?type=place')).toEqual(['Рейхстаг']);
      expect(await names('?side=enemy')).toEqual(['9-я парашютная дивизия']);
      expect(await names('?type=formation&side=own')).toEqual(['150-я стрелковая Идрицкая дивизия', '171-я стрелковая дивизия']);
      expect((await names('?limit=2')).length).toBe(2);
      expect((await get('/registry/entities?limit=0')).status).toBe(400);
      expect((await get('/registry/entities?limit=abc')).status).toBe(400);
      expect((await names('?limit=100000')).length).toBe(5);
      // без at — без состояния; с at — с состоянием
      const plain = (await get('/registry/entities?q=150')).body;
      expect(plain[0].state).toBeUndefined();
      const withState = (await get('/registry/entities?q=150&at=1945-04-30')).body;
      expect(withState[0].state).toMatchObject({ entityId: div.id, at: '1945-04-30', attrs: { personnel: 7200 }, geometry: point(13.38, 52.52) });
    });

    it('объекты в районе на момент (bbox + at)', async () => {
      // второй объект: стоит у Зеловских высот, 25 апреля переходит в Берлин, линия с 1 мая
      const e2 = (await post('/registry/entities', { type: 'formation', name: '8-я гвардейская армия', attrs: { number: '8 гв.', echelon: 'army' } })).body;
      await post(`/registry/entities/${e2.id}/facts`, { validFrom: '1945-04-16', geometry: point(14.45, 52.58) });
      await post(`/registry/entities/${e2.id}/facts`, { validFrom: '1945-04-25', geometry: { type: 'Polygon', coordinates: [[[13.3, 52.4], [13.5, 52.4], [13.5, 52.5], [13.3, 52.5], [13.3, 52.4]]] } });
      await post(`/registry/entities/${e2.id}/facts`, { validFrom: '1945-04-27', attrs: { commander: 'В. И. Чуйков' } }); // без положения
      await post(`/registry/entities/${e2.id}/facts`, { validFrom: '1945-05-01', validTo: '1945-05-03', geometry: { type: 'LineString', coordinates: [[12, 51], [12.5, 51.2]] } });

      const berlin = '13.2,52.35,13.6,52.6';
      const oder = '14.2,52.5,14.6,52.7';
      const ids = async (bbox: string, at: string) => (await get(`/registry/entities?bbox=${bbox}&at=${at}`)).body.map((e: Entity) => e.name).sort();
      expect(await ids(oder, '1945-04-20')).toEqual(['150-я стрелковая Идрицкая дивизия', '8-я гвардейская армия']);
      expect(await ids(berlin, '1945-04-20')).toEqual([]);
      expect(await ids(berlin, '1945-04-26')).toEqual(['8-я гвардейская армия']);
      // факт без положения не сбрасывает его
      expect(await ids(berlin, '1945-04-28')).toEqual(['8-я гвардейская армия']);
      expect(await ids(berlin, '1945-04-30')).toEqual(['150-я стрелковая Идрицкая дивизия', '8-я гвардейская армия']);
      // 1–3 мая армия «уходит» к Лейпцигу, после 3 мая действует снова положение с 25 апреля
      expect(await ids(berlin, '1945-05-02')).toEqual(['150-я стрелковая Идрицкая дивизия']);
      expect(await ids('11.9,50.9,12.6,51.3', '1945-05-02')).toEqual(['8-я гвардейская армия']);
      expect(await ids(berlin, '1945-05-05')).toEqual(['150-я стрелковая Идрицкая дивизия', '8-я гвардейская армия']);
      // в ответе — состояние на момент
      const r = (await get(`/registry/entities?bbox=${berlin}&at=1945-04-28&q=${encodeURIComponent('гвардейская')}`)).body;
      expect(r).toHaveLength(1);
      expect(r[0].state.attrs.commander).toBe('В. И. Чуйков');
      expect(r[0].state.geometry.type).toBe('Polygon');

      expect((await get(`/registry/entities?bbox=${berlin}`)).status).toBe(400);
      expect((await get('/registry/entities?bbox=1,2,3&at=1945-04-28')).status).toBe(400);
      expect((await get('/registry/entities?bbox=5,5,1,1&at=1945-04-28')).status).toBe(400);
    });

    it('состояния многих объектов на момент', async () => {
      const all: Entity[] = (await get('/registry/entities?type=formation')).body;
      const ids = [...all.map((e) => e.id), '00000000-0000-4000-8000-000000000000', 'мусор'];
      const r = await post('/registry/states', { ids, at: '1945-04-26' });
      expect(r.status).toBe(200);
      expect(r.body.states.map((s: { entityId: string }) => s.entityId)).toEqual(all.map((e) => e.id));
      const s150 = r.body.states.find((s: { entityId: string }) => s.entityId === div.id);
      expect(s150).toMatchObject({ at: '1945-04-26', exists: true, attrs: { personnel: 9000 } });
      expect((await post('/registry/states', { ids })).status).toBe(400);
      expect((await post('/registry/states', { ids: 'x', at: '1945-04-26' })).status).toBe(400);
      // другая организация чужих состояний не получает
      expect((await post('/registry/states', { ids, at: '1945-04-26' }, 'orgB')).body.states).toEqual([]);
    });

    it('изоляция организаций', async () => {
      expect((await get(`/registry/entities/${div.id}`, 'orgB')).status).toBe(404);
      expect((await get(`/registry/entities/${div.id}/facts`, 'orgB')).status).toBe(404);
      expect((await get('/registry/entities', 'orgB')).body).toEqual([]);
      expect((await get('/registry/entities?bbox=-180,-90,180,90&at=1945-04-30', 'orgB')).body).toEqual([]);
      expect((await call('PATCH', `/registry/entities/${div.id}`, { name: 'Чужое' }, 'orgB')).status).toBe(404);
      expect((await call('DELETE', `/registry/entities/${div.id}`, undefined, 'orgB')).status).toBe(404);
      expect((await post(`/registry/entities/${div.id}/facts`, { validFrom: '1945-04-25', attrs: { personnel: 1 } }, 'orgB')).status).toBe(404);
      // тот же объект у orgB создаётся независимо
      const own = await post('/registry/entities', division(), 'orgB');
      expect(own.status).toBe(201);
      expect((await get('/registry/entities', 'orgB')).body).toHaveLength(1);
      expect((await get(`/registry/entities/${div.id}`)).status).toBe(200);
    });

    it('события реестра (SSE) — только своей организации', async () => {
      const ctl = new AbortController();
      const got: string[] = [];
      const stream = await fetch(base + '/registry/events', { headers: { 'X-Tenant-Id': 'orgA' }, signal: ctl.signal });
      const reader = stream.body!.getReader();
      const dec = new TextDecoder();
      const reading = (async () => {
        let buf = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value);
            for (const m of buf.matchAll(/event: (\S+)\ndata: (.+)\n\n/g)) got.push(`${m[1]}:${JSON.parse(m[2]).tenant}`);
            buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
            if (got.length >= 4) break;
          }
        } catch { /* поток закрыт */ }
      })();
      await new Promise((r) => setTimeout(r, 50));
      await post('/registry/entities', division(), 'orgB'); // чужое событие не приходит
      const e = (await post('/registry/entities', division({ name: 'Временная' }))).body;
      const f = (await post(`/registry/entities/${e.id}/facts`, { validFrom: '1945-04-25', attrs: { personnel: 1 } })).body;
      await call('PATCH', `/registry/entities/${e.id}`, { shortName: 'вр' });
      await call('DELETE', `/registry/entities/${e.id}`);
      await Promise.race([reading, new Promise((r) => setTimeout(r, 2000))]);
      ctl.abort();
      expect(got).toEqual(['entity.created:orgA', 'fact.changed:orgA', 'entity.updated:orgA', 'entity.deleted:orgA']);
      expect(f.id).toBeTruthy();
    });

    it('удаление объекта удаляет его факты', async () => {
      const e = (await post('/registry/entities', division({ name: 'Удаляемая' }))).body;
      await post(`/registry/entities/${e.id}/facts`, { validFrom: '1945-04-25', attrs: { personnel: 1 }, geometry: point(13.4, 52.5) });
      expect((await call('DELETE', `/registry/entities/${e.id}`)).status).toBe(204);
      expect((await get(`/registry/entities/${e.id}`)).status).toBe(404);
      expect((await get(`/registry/entities/${e.id}/facts`)).status).toBe(404);
      expect((await call('DELETE', `/registry/entities/${e.id}`)).status).toBe(404);
      expect((await post('/registry/states', { ids: [e.id], at: '1945-04-26' })).body.states).toEqual([]);
      expect((await get('/registry/entities?bbox=13.3,52.4,13.5,52.6&at=1945-04-26')).body.map((x: Entity) => x.name)).not.toContain('Удаляемая');
    });
  });
}

behaviour('в памяти', async () => ({ repo: new MemoryRepo(), cleanup: async () => undefined }));

const url = process.env.DATABASE_URL;
behaviour('PostgreSQL + PostGIS', async () => {
  const repo = await new PgRepo({ url, schema: `registry_test_${Math.random().toString(36).slice(2, 10)}` }).init(10_000);
  return { repo, cleanup: async () => { await repo.drop(); await repo.close(); } };
}, !url);

describe('нормализация моментов', () => {
  it('канонический вид', () => {
    expect(normTime('1945-04-25')).toBe('1945-04-25');
    expect(normTime('1945-04-25T00:00')).toBe('1945-04-25');
    expect(normTime('1945-04-25T06:00:00Z')).toBe('1945-04-25T06:00');
    expect(normTime('1945-04-25T06:00:30')).toBe('1945-04-25T06:00:30');
    expect(normTime('1945-04-25T06:00:30.250+01:00')).toBe('1945-04-25T05:00:30.250');
  });
});
