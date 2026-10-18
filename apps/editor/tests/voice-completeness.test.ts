// Полнота голоса в «Командовании» (спецификация 3.7): каждый обработчик элемента управления (onClick, onChange,
// onSubmit, onKeyDown) в исходниках командования, разбора, входа в командование, окон голоса, вопросов dialogs.ts и тура
// вызывает действие реестра (act, ActButton, tap/press — обёртки act). Обработчик может звать свою вспомогательную
// функцию или свойство-обработчик компонента: тогда проверяется она (и то, что передано в свойство там, где компонент
// используется). Исключения — короткий список с причиной; каждое исключение должно что-то покрывать.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
/** Файлы и, для «Переигровки», только вход в командование (между пометками voice-entry). */
const FILES: { file: string; part?: [string, string] }[] = [
  { file: 'CommandView.tsx' },
  { file: 'ReviewView.tsx' },
  { file: 'ReplayView.tsx', part: ['{/* voice-entry: начало */}', '{/* voice-entry: конец */}'] },
  { file: 'voice/VoicePanel.tsx' },
  { file: 'voice/Calibration.tsx' },
  { file: 'voice/Voices.tsx' },
  { file: 'dialogs.ts' },
  { file: 'voice/tour.tsx' },
  { file: 'voice/TourLayer.tsx' },
];
/** Компоненты «Переигровки», которыми пользуется командование (карта): проверяются целиком. */
const REPLAY_SHARED = ['LayersMenu', 'LevelSwitch', 'LegendPanel'];

/** Исключения: где (файл), что в обработчике или рядом с ним (подстрока), почему. */
const EXCEPTIONS: { file: string; has: string; why: string }[] = [
  { file: 'CommandView.tsx', has: "setMob('", why: 'переключатель «Штаб / Карта / Советник» на телефоне — служебный элемент узкого экрана' },
  { file: 'CommandView.tsx', has: 'setPickMode(', why: 'выбор точки на карте мышью (цель, база, переправа, район, отмена выбора) — у голоса свой путь через названное место' },
  { file: 'CommandView.tsx', has: 'setPick(', why: 'точка цели на карте мышью — голосом цель называется пунктом или соединением' },
  { file: 'CommandView.tsx', has: 'onMap', why: 'точка на карте вместо пункта из списка — голосом пункт называется' },
  { file: 'CommandView.tsx', has: 'setPicking(', why: 'точки разграничительной линии на карте мышью — голосом «предложи линию между …»' },
  { file: 'CommandView.tsx', has: 'setPts(', why: 'сбросить точки линии на карте — часть рисования линии мышью' },
  { file: 'CommandView.tsx', has: 'setQ(', why: 'поиск пункта по буквам — голосом пункт называется сразу' },
  { file: 'CommandView.tsx', has: 'setFind(', why: 'поиск вопроса в темах советника — голосом вопрос задаётся своими словами' },
  { file: 'CommandView.tsx', has: 'setPath(', why: 'дерево тем советника (разделы, «все», хлебные крошки) — голосом вопрос задаётся своими словами: «спроси советника: …»' },
  { file: 'CommandView.tsx', has: 'setNavOpen(', why: 'свернуть / показать темы советника — вид экрана' },
  { file: 'CommandView.tsx', has: 'setMode(', why: 'вид списка целей в редакторе приказа (пункт / противник / точка) — голосом цель называется сразу' },
  { file: 'CommandView.tsx', has: 'setOpen(open', why: 'раскрыть список пунктов («перенести…», «ввести…») — голосом пункт называется сразу: «перенеси базу … в …», «введи … в районе …»' },
  { file: 'CommandView.tsx', has: 'setMore(', why: 'показать ещё / свернуть список резервов — вид экрана' },
  { file: 'CommandView.tsx', has: 'setText(', why: 'набор вопроса советнику с клавиатуры — голосом «спроси советника: …»' },
  { file: 'CommandView.tsx', has: 'e.target.value })', why: 'набор текста решения и указаний с клавиатуры — голосом диктовка («запиши в замысел: …», «указания: …»)' },
  { file: 'CommandView.tsx', has: 'setNotice(null)', why: 'закрыть уведомление щелчком — подсказка на экране; штаб говорит то же голосом' },
  { file: 'CommandView.tsx', has: 'openModelBasis(', why: '«Основа модели» уводит в другой раздел («Моделирование»); голосом — «открой моделирование»' },
  { file: 'CommandView.tsx', has: 'llm.recheck', why: 'проверить связь с моделью — голос перепроверяет связь сам, когда к модели обращаются' },
  { file: 'CommandView.tsx', has: 'openKbEntry(', why: 'ссылка «по базе: R1» уводит в «Знания» — голосом «открой знания»' },
  { file: 'CommandView.tsx', has: 'llm.set(', why: 'настройки моделей посредника и Ставки — раздел настройки модели, не командование; голосом — «открой ИИ»' },
  { file: 'ReviewView.tsx', has: 'onClick={pdf}', why: 'печать — открывается окно печати системы, оно управляется только мышью; голосом — «сохрани разбор» (PDF в «Загрузки»)' },
  { file: 'voice/VoicePanel.tsx', has: 'power(!enabled)', why: '«Выключить голос» — только рукой: голосом микрофон не закрывается (дежурный режим «Штаб, отбой»), включить голосом выключенный нельзя' },
  { file: 'voice/VoicePanel.tsx', has: 'startMic', why: 'микрофон не открылся — голосом сказать нечем' },
  { file: 'voice/VoicePanel.tsx', has: 'applySettings(', why: 'тонкая настройка (регуляторы, «перебивать голосом / словом») — главный путь голосом: «Штаб, калибровка»' },
  { file: 'voice/VoicePanel.tsx', has: 'resetSettings', why: '«По умолчанию» тонкой настройки — главный путь голосом: «Штаб, калибровка»' },
  { file: 'voice/VoicePanel.tsx', has: 'onChange(+e.target.value)', why: 'регуляторы тонкой настройки — главный путь голосом: «Штаб, калибровка»' },
  { file: 'voice/VoicePanel.tsx', has: 'resume', why: 'звук окна включается после первого действия человека (правило браузера) — не элемент управления' },
  { file: 'voice/Voices.tsx', has: 'setName(', why: 'имя нового голоса с клавиатуры — голосом имя называется в «запиши новый голос гость»' },
];

// ---------------------------------------------------------------- разбор исходника

/** Конец выражения от i (открывающая скобка): учитываются строки, шаблоны и вложенные скобки. */
function balanced(s: string, i: number): number {
  const open = s[i], close = ({ '{': '}', '(': ')', '[': ']' } as Record<string, string>)[open];
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'" || c === '`') { k = skipString(s, k); continue; }
    if (c === '/' && s[k + 1] === '/') { k = s.indexOf('\n', k); continue; }
    if (c === '/' && s[k + 1] === '*') { k = s.indexOf('*/', k) + 1; continue; }
    if (c === open || '{(['.includes(c)) depth++;
    else if (c === close || '})]'.includes(c)) { depth--; if (depth === 0) return k; }
  }
  return s.length;
}
function skipString(s: string, i: number): number {
  const q = s[i];
  for (let k = i + 1; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (q === '`' && s[k] === '$' && s[k + 1] === '{') { k = balanced(s, k + 1); continue; }
    if (s[k] === q) return k;
    // одиночная кавычка в тексте JSX («Ход без новых приказов противника») — не строка: конец строки — конец
    if (q !== '`' && s[k] === '\n') return i;
  }
  return s.length;
}
/** Выражение до конца оператора (;) или строки на нулевой глубине — тело `const f = …`. */
function statement(s: string, i: number): string {
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'" || c === '`') { k = skipString(s, k); continue; }
    if ('{(['.includes(c)) { k = balanced(s, k); continue; }
    if (c === ';' || (c === '\n' && !/^\s*[.?:&|]/.test(s.slice(k + 1, k + 40)))) return s.slice(i, k);
  }
  return s.slice(i);
}

interface Src { file: string; text: string; from: number; to: number }
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
const SOURCES: Src[] = FILES.flatMap(({ file, part }) => {
  const text = read(file);
  if (!part) return [{ file, text, from: 0, to: text.length }];
  // пометок может быть несколько пар: вход в командование — в разных местах раздела
  const out: Src[] = [];
  for (let a = text.indexOf(part[0]); a >= 0; a = text.indexOf(part[0], a + 1)) {
    const b = text.indexOf(part[1], a);
    if (b < 0) break;
    out.push({ file, text, from: a, to: b });
  }
  if (!out.length) throw new Error(`${file}: нет пометок входа в командование ${part.join(' … ')}`);
  return out;
});
// общие с командованием компоненты карты из «Переигровки» — целиком
{
  const text = read('ReplayView.tsx');
  for (const name of REPLAY_SHARED) {
    const a = text.indexOf(`function ${name}(`);
    if (a < 0) throw new Error(`ReplayView.tsx: нет компонента ${name}`);
    SOURCES.push({ file: 'ReplayView.tsx', text, from: a, to: text.indexOf('\n}\n', a) });
  }
}

/** Компонент (функция верхнего уровня), внутри которой позиция, и имена его свойств. */
function owner(text: string, at: number): { name: string; props: string[]; start: number; end: number } | null {
  const re = /^(?:export )?function (\w+)\s*\(/gm;
  let best: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  for (; (m = re.exec(text)) && m.index < at;) best = m;
  if (!best) return null;
  const end = m ? m.index : text.length;
  const open = best.index + best[0].length - 1;
  const params = text.slice(open + 1, balanced(text, open));
  const destr = /^\s*\{/.test(params) ? params.slice(params.indexOf('{') + 1, balanced(params, params.indexOf('{'))) : '';
  const props = destr.split(',').map((x) => x.trim().split(/[:=\s]/)[0]).filter((x) => /^\w+$/.test(x));
  return { name: best[1], props, start: best.index, end };
}

const ROUTES = /\b(?:act|tap|press)\s*\(/;
const INERT = /^\(?\s*\w*\s*\)?\s*=>\s*\{?\s*\w+\.stopPropagation\(\);?\s*\}?$/;
const SKIP = new Set(['if', 'void', 'return', 'await', 'async', 'new', 'typeof', 'catch', 'then', 'String', 'Number', 'Boolean', 'Math', 'Date', 'JSON', 'Object', 'Array', 'Set', 'Map', 'localStorage', 'sessionStorage', 'window', 'document', 'console', 'setTimeout', 'Promise']);

/** Обработчик идёт через реестр: прямо, через свою функцию или через свойство компонента. */
function routes(expr: string, text: string, at: number, depth = 0, seen = new Set<string>()): boolean {
  if (ROUTES.test(expr) || INERT.test(expr.trim())) return true;
  if (depth > 5) return false;
  const own = owner(text, at);
  const called = new Set<string>();
  const bare = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(expr);
  if (bare) called.add(bare[1]);
  for (const m of expr.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!SKIP.has(m[1])) called.add(m[1]);
  for (const name of called) {
    const key = `${own?.name}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // своя функция компонента (внутри него) или модуля (с начала строки)
    const re = new RegExp(`(?:const|let) ${name}\\s*=\\s*|function ${name}\\s*\\(`, 'g');
    let def: RegExpExecArray | null = null;
    for (let m; (m = re.exec(text));) {
      const inOwn = own && m.index > own.start && m.index < own.end;
      const top = text[m.index - 1] === '\n' || (text.slice(text.lastIndexOf('\n', m.index) + 1, m.index) === 'export ');
      if (inOwn || (top && !def)) def = m;
    }
    if (def) {
      const body = def[0].startsWith('function') ? text.slice(def.index, balanced(text, text.indexOf('{', def.index + def[0].length)) + 1) : statement(text, def.index + def[0].length);
      if (routes(body, text, def.index, depth + 1, seen)) return true;
      continue;
    }
    // свойство компонента: что ему передают там, где компонент используется
    if (own?.props.includes(name)) {
      for (const src of SOURCES) {
        for (const m of src.text.matchAll(new RegExp(`<${own.name}[\\s>]`, 'g'))) {
          const end = tagEnd(src.text, m.index!);
          const tag = src.text.slice(m.index!, end);
          const p = new RegExp(`\\s${name}=\\{`).exec(tag);
          if (!p) continue;
          const vStart = m.index! + p.index + p[0].length - 1;
          if (routes(src.text.slice(vStart + 1, balanced(src.text, vStart)), src.text, vStart, depth + 1, seen)) return true;
        }
      }
    }
  }
  return false;
}
/** Конец открывающего тега JSX (с учётом {…} в атрибутах). */
function tagEnd(s: string, i: number): number {
  for (let k = i + 1; k < s.length; k++) {
    if (s[k] === '{') { k = balanced(s, k); continue; }
    if (s[k] === '>') return k;
  }
  return s.length;
}

interface Handler { file: string; line: number; expr: string; near: string }
function handlers(): Handler[] {
  const out: Handler[] = [];
  const seen = new Set<string>();
  for (const src of SOURCES) {
    const { text } = src;
    const lineOf = (i: number) => text.slice(0, i).split('\n').length;
    const push = (i: number, expr: string) => {
      const key = `${src.file}:${i}`;
      if (seen.has(key)) return;
      seen.add(key);
      const ls = text.lastIndexOf('\n', i) + 1;
      out.push({ file: src.file, line: lineOf(i), expr, near: text.slice(ls, text.indexOf('\n', i + expr.length) + 1) });
    };
    const body = text.slice(src.from, src.to);
    // JSX: onClick={…} и т. п.
    for (const m of body.matchAll(/\b(onClick|onChange|onSubmit|onKeyDown)=\{/g)) {
      const i = src.from + m.index! + m[0].length - 1;
      push(i, text.slice(i + 1, balanced(text, i)));
    }
    // DOM: el.onclick = …; addEventListener('click' | 'keydown', f)
    for (const m of body.matchAll(/\.on(?:click|keydown|change|submit)\s*=\s*/g)) {
      const i = src.from + m.index! + m[0].length;
      push(i, statement(text, i));
    }
    for (const m of body.matchAll(/addEventListener\('(?:click|keydown)',\s*(\w+)/g)) push(src.from + m.index!, m[1]);
  }
  return out;
}

const ALL = handlers();
const routed = (h: Handler) => {
  const src = SOURCES.find((s) => s.file === h.file)!; // текст файла один и тот же у всех его частей
  const at = src.text.split('\n').slice(0, h.line - 1).join('\n').length + 1;
  return routes(h.expr, src.text, at);
};
const excused = (h: Handler) => EXCEPTIONS.find((x) => x.file === h.file && (h.expr.includes(x.has) || h.near.includes(x.has)));

describe('полнота голоса в «Командовании» (3.7)', () => {
  it('обработчики найдены во всех файлах', () => {
    for (const f of ['CommandView.tsx', 'ReviewView.tsx', 'ReplayView.tsx', 'voice/VoicePanel.tsx', 'voice/Calibration.tsx', 'voice/Voices.tsx', 'dialogs.ts'])
      expect(ALL.filter((h) => h.file === f).length, f).toBeGreaterThan(0);
  });
  it('каждый обработчик вызывает действие реестра (или в исключениях с причиной)', () => {
    const bad = ALL.filter((h) => !excused(h) && !routed(h)).map((h) => `${h.file}:${h.line}  ${h.near.trim().slice(0, 160)}`);
    expect(bad, `мимо реестра:\n${bad.join('\n')}`).toEqual([]);
  });
  it('исключения не устарели: каждое покрывает обработчик, который сам мимо реестра', () => {
    const unused = EXCEPTIONS.filter((x) => !ALL.some((h) => h.file === x.file && (h.expr.includes(x.has) || h.near.includes(x.has)) && !routed(h)));
    expect(unused.map((x) => `${x.file}: ${x.has}`)).toEqual([]);
  });
  it('исключения — с причиной', () => {
    for (const x of EXCEPTIONS) expect(x.why.length, x.has).toBeGreaterThan(20);
  });
  it('проверка ловит обработчик мимо реестра', () => {
    const text = 'function A({ onPick }: { onPick: () => void }) {\n  const go = () => setX(1);\n  return <button onClick={go}>x</button>;\n}\n';
    expect(routes('go', text, text.indexOf('onClick'))).toBe(false);
    const ok = 'function B() {\n  const go = () => { void act(\'x\'); };\n  return <button onClick={go}>x</button>;\n}\n';
    expect(routes('go', ok, ok.indexOf('onClick'))).toBe(true);
  });
});
