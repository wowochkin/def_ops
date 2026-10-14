/**
 * Раздел «Моделирование»: модели (правила арбитра, профили сторон, языковые модели по ролям), сравнение моделей
 * между собой и с историей, настройка своих вариантов правил, калибровка по истории, подготовка новых операций
 * к переигровке. Всё считается в браузере — пулом фоновых потоков.
 */
import { useEffect, useState } from 'react';
import type { Llm } from '../shared';
import { useSimData } from './data';
import { ModelsTab } from './ModelsTab';
import { CompareTab } from './CompareTab';
import { TuneTab } from './TuneTab';
import { CalibrateTab } from './CalibrateTab';
import { OperationsTab } from './OperationsTab';
import { AgentsTab } from './AgentsTab';
import { AssistantTab } from './AssistantTab';

type Tab = 'models' | 'compare' | 'tune' | 'calibrate' | 'agents' | 'ops' | 'assistant';
const TABS: [Tab, string, string][] = [
  ['models', 'Модели', 'описание правил, профилей, языковых моделей'],
  ['compare', 'Сравнение', 'модели между собой и с историей'],
  ['tune', 'Настройка', 'свой вариант правил'],
  ['calibrate', 'Калибровка', 'подбор по истории операции'],
  ['agents', 'Агентная модель', 'сравнение вариантов параметров с историей и калибровка (ядро приложения)'],
  ['ops', 'Операции', 'загрузка и подготовка к переигровке'],
  ['assistant', 'Ассистент', 'вопросы об устройстве модели'],
];

export function ModelingView({ llm }: { llm: Llm }) {
  const d = useSimData();
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('def_ops.modeling.tab') as Tab) || 'models');
  const [cmp, setCmp] = useState<{ scenario: string; rules: string[] } | null>(null);
  const [tune, setTune] = useState<string | null>(null);
  const [calib, setCalib] = useState(0);
  const [calibScenario, setCalibScenario] = useState<string | null>(null);
  const go = (t: Tab) => { setTab(t); try { localStorage.setItem('def_ops.modeling.tab', t); } catch { /* */ } };
  // переход извне (окно «Принять командование» → «Основа модели»): нужная вкладка
  useEffect(() => {
    const f = (e: Event) => { const t = (e as CustomEvent<{ tab?: Tab }>).detail?.tab; if (t && TABS.some(([k]) => k === t)) go(t); };
    window.addEventListener('def_ops.modeling.open', f);
    return () => window.removeEventListener('def_ops.modeling.open', f);
  }, []);
  const compare = (scenario: string, rules: string[]) => { setCmp({ scenario, rules }); go('compare'); };
  return (
    <div className="mdl">
      <header className="mdl-top">
        <div><h2>Моделирование</h2><span className="muted">правила арбитра, сравнение с историей, калибровка, подготовка операций</span></div>
        <nav className="mdl-tabs">{TABS.map(([k, t, h]) => <button key={k} className={tab === k ? 'on' : ''} title={h} onClick={() => go(k)}>{t}</button>)}</nav>
      </header>
      <div className="mdl-body">
        {!d.ready ? <p className="muted mdl-page"><span className="spinner" /> загрузка моделей…</p> : <>
          <div hidden={tab !== 'models'}><ModelsTab d={d} llm={llm} onTune={(id) => { setTune(id); go('tune'); }} onCompare={compare} /></div>
          <div hidden={tab !== 'compare'}><CompareTab d={d} preset={cmp} /></div>
          <div hidden={tab !== 'tune'}><TuneTab d={d} preset={tune} /></div>
          <div hidden={tab !== 'calibrate'}><CalibrateTab key={`${calib}`} d={d} onCompare={compare} initialScenario={calibScenario} /></div>
          <div hidden={tab !== 'agents'}><AgentsTab /></div>
          <div hidden={tab !== 'assistant'}><AssistantTab llm={llm} /></div>
          <div hidden={tab !== 'ops'}><OperationsTab d={d} llm={llm} onCompare={compare} onCalibrate={(s) => { setCalibScenario(s); setCalib((x) => x + 1); go('calibrate'); }} /></div>
        </>}
      </div>
    </div>
  );
}
