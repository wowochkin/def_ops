import { useMemo, useRef, useState } from 'react';
import { savedText } from '../../voice/files';
import {
  canJointReview, jointReview, periodEnd, reportTime, sideReview, submitDecision, voteFinish, voteUnlock,
  type Decision, type LoggedEvent, type Scenario, type Session, type Side,
} from './session';
import { choiceLabel, countryName, deliveryLines, downloadJournal, sideName, stamp } from './journal-text';
import { clearDraft, draftKey, readDraft, writeDraft } from './private-draft';
import { ReplayAreaMap } from './ReplayAreaMap';

type Props = {
  session: Session;
  sessionId?: string;
  onChange: (updated: Session) => Promise<void>;
  onRepeat: () => Promise<void>;
  onBack: () => void;
};

const letter = { a: 'А', b: 'Б' };
const bothSides: Side[] = ['a', 'b'];
const otherSide = (side: Side): Side => side === 'a' ? 'b' : 'a';
const finishReason = {
  deadline: 'Достигнут срок окончания.',
  event: 'Произошло завершающее событие сценария.',
  agreement: 'Обе стороны согласились завершить сеанс.',
};

function RecordText({ decision, choices, effective }: {
  decision: Decision;
  choices: Scenario['choices'];
  effective?: string | null;
}) {
  return <div className="replay-record">
    <strong>{choiceLabel(decision, choices, effective)}</strong>
    {decision.format === 'separate'
      ? <ul>{decision.note.split('\n').filter(line => line.trim()).map((line, i) => <li key={i}>{line}</li>)}</ul>
      : decision.note && <p className="replay-verbatim">{decision.note}</p>}
  </div>;
}

function Events({ events, jointEnd }: { events: readonly (LoggedEvent & { receivedAt?: string })[]; jointEnd?: string }) {
  if (!events.length) return null;
  return <ul className="replay-events" aria-label="События периода">
    {events.map((event, i) => <li key={i}>
      <time dateTime={event.at}>{stamp(event.at)} UTC</time> · {event.announcement && <strong>{event.announcement} · </strong>}{event.text}
      {deliveryLines(event, jointEnd).map(line => <div key={line}><small>{line}</small></div>)}
    </li>)}
  </ul>;
}

function MaterialDetails({ material }: { material: NonNullable<Scenario['sides'][Side]['materials']>[number] }) {
  return <>{material.category && <small>{material.category}</small>}
    {material.summary && <p>{material.summary}</p>}
    {material.sourceUrl && <a href={material.sourceUrl} target="_blank" rel="noreferrer">Источник · {material.label}</a>}
  </>;
}

function DecisionForm({ view, storageKey, busy, commit }: {
  view: ReturnType<typeof sideReview>;
  storageKey: string | null;
  busy: boolean;
  commit: (decision: Decision) => void;
}) {
  const { choices, periods, initialMaterialIds, countryOptions } = view;
  const [draft, setDraft] = useState(() => readDraft(storageKey, view));
  const [stored, setStored] = useState(true);
  const { country, choice, format, note, materialIds: selected } = draft;
  const materials = countryOptions.find(option => option.country === country)?.materials ?? [];
  function edit(update: Partial<typeof draft>) {
    const next = { ...draft, ...update };
    setDraft(next);
    setStored(writeDraft(storageKey, next));
  }
  return <form className="replay-panel replay-fields replay-decision-form" onSubmit={event => {
    event.preventDefault();
    if (choice === undefined) return;
    commit({ choice, note, format, ...(!periods.length ? { materialIds: selected, country } : {}) });
  }}>
    {!periods.length && countryOptions.length > 1 && <label>Страна стороны
      <select value={country} disabled={busy} onChange={e => {
        const dossier = countryOptions.find(option => option.country === e.target.value);
        if (dossier) edit({ country: dossier.country, materialIds: (dossier.materials ?? []).filter(item => item.required).map(item => item.id) });
      }}>
        {countryOptions.map(option => <option key={option.country} value={option.country}>{countryName(option.country)}</option>)}
      </select>
    </label>}
    <fieldset disabled={busy}><legend>Решение на период</legend>
      {choices.map(item => <label key={item.id} className="replay-choice"><input type="radio" name="replay-choice"
        checked={choice === item.id} onChange={() => edit({ choice: item.id })} />{item.label}</label>)}
      <label className="replay-choice"><input type="radio" name="replay-choice"
        checked={choice === null} onChange={() => edit({ choice: null })} />
        {periods.length && periods[periods.length - 1].effectiveChoice ? 'Сохранить прежнее решение' : 'Без нового решения'}
      </label>
    </fieldset>
    <div className="replay-decision-note">
      <label>Форма записи<select disabled={busy} value={format} onChange={e => edit({ format: e.target.value === 'separate' ? 'separate' : 'directive' })}>
        <option value="directive">Единая директива</option><option value="separate">Отдельные записи</option>
      </select></label>
      <label>{format === 'separate' ? 'Записи по одной на строке' : 'Комментарий'}
        <textarea disabled={busy} rows={2} value={note} onChange={e => edit({ note: e.target.value })} /></label>
    </div>
    {!periods.length && materials.length > 0 && <fieldset><legend>Материалы стороны</legend>
      {initialMaterialIds && <p>Подборка сохранена из исходного сеанса.</p>}
      {materials.map(material => <div className="replay-material" key={material.id}>
        <div className="replay-material-heading"><label className="replay-choice"><input type="checkbox" checked={selected.includes(material.id)}
          disabled={busy || material.required || initialMaterialIds !== null} onChange={e => edit({ materialIds: e.target.checked ? [...selected, material.id] : selected.filter(id => id !== material.id) })} />
          <span>{material.label}</span></label>
        {material.required && <small>Назначено автором</small>}</div>
        {(material.category || material.summary || material.sourceUrl) && <details>
          <summary aria-label={'Сведения о карточке «' + material.label + '»'}>Сведения</summary><MaterialDetails material={material} />
        </details>}
      </div>)}
    </fieldset>}
    {!stored && <p role="status">Черновик доступен только до закрытия этого экрана. Браузер не смог сохранить его на устройстве.</p>}
    <button className="replay-primary" type="submit" disabled={busy || choice === undefined}>Сохранить и передать устройство</button>
  </form>;
}

function ScenarioMap({ scenario, initiallyOpen }: { scenario: Scenario; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!scenario.areaBounds) return null;
  return <details className="replay-panel replay-personal-map" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Карта области</summary>
    {open && <ReplayAreaMap bounds={scenario.areaBounds} name={scenario.area} />}
  </details>;
}

function JointHistory({ session }: { session: Session }) {
  const review = useMemo(() => jointReview(session), [session]);
  const personal = useMemo(() => ({ a: sideReview(session, 'a'), b: sideReview(session, 'b') }), [session]);
  const moments = useMemo(() => {
    const times = new Set([session.scenario.start, session.now]);
    for (const period of review.periods) {
      times.add(period.start);
      times.add(period.end);
      for (const event of period.events) {
        times.add(event.at);
        for (const side of bothSides) {
          const receipt = reportTime(event, side);
          if (receipt && receipt <= session.now) times.add(receipt);
        }
      }
    }
    return [...times].sort();
  }, [review, session]);
  const [position, setPosition] = useState(moments.length - 1);
  const [perspective, setPerspective] = useState<Side | 'joint'>('joint');
  const at = moments[position];
  const visibleSides = perspective === 'joint' ? bothSides : [perspective];
  const last = at === session.now;
  return <>
    <h2>Общий разбор</h2>
    <p>{session.scenario.title} · {session.scenario.area}</p>
    {last && perspective === 'joint' && session.reason && <p>{finishReason[session.reason]}</p>}
    <section className="replay-panel replay-timeline">
      {session.scenario.areaBounds && <ReplayAreaMap bounds={session.scenario.areaBounds} name={session.scenario.area} />}
      <label>Момент разбора
        <input type="range" min={0} max={moments.length - 1} value={position} disabled={moments.length === 1}
          aria-valuetext={stamp(at) + ' UTC'} onChange={e => setPosition(Number(e.target.value))} />
      </label>
      <div className="replay-actions"><button disabled={position === 0} onClick={() => setPosition(position - 1)}>Ранее</button>
        <output aria-live="polite">{stamp(at)} UTC</output>
        <button disabled={last} onClick={() => setPosition(position + 1)}>Позднее</button></div>
      <div role="group" className="replay-actions" aria-label="Перспектива разбора">
        <button aria-pressed={perspective === 'joint'} onClick={() => setPerspective('joint')}>События сценария</button>
        {bothSides.map(side => <button key={side} aria-pressed={perspective === side} onClick={() => setPerspective(side)}>
          Известно стороне {letter[side]}
        </button>)}
      </div>
    </section>
    <div className="replay-columns">{visibleSides.map(side => {
      const profile = review.sides[side];
      const ids = personal[side].materialIds;
      const selected = (profile.materials ?? []).filter(item => ids.includes(item.id));
      return <section className="replay-panel" key={side}>
        <h3>{sideName[side]} · {countryName(profile.country)}</h3>
        <p className="replay-verbatim">{profile.objective}</p>
        {selected.length > 0 && <ul>{selected.map(item =>
          <li key={item.id}>{item.label}<MaterialDetails material={item} /></li>)}</ul>}
      </section>;
    })}</div>
    <section className="replay-panel replay-history"><h3>Хронология</h3>
      {!review.periods.length && <p>Завершённых периодов нет.</p>}
      {review.periods.map((period, index) => {
        if (period.start > at) return null;
        const events = perspective === 'joint' ? period.events.filter(event => event.at <= at)
          : personal[perspective].periods[index].events.filter(event => event.receivedAt <= at);
        return <article key={period.start}>
          <h4>{stamp(period.start)} — {stamp(period.end < at ? period.end : at)} UTC</h4>
          {visibleSides.map(side => <div key={side}><h5>{sideName[side]}</h5>
            <RecordText decision={period.decisions[side]} choices={session.scenario.choices} effective={period.effectiveChoices[side]} />
          </div>)}
          <Events events={events} jointEnd={perspective === 'joint' ? at : undefined} />
        </article>;
      })}
      {last && visibleSides.map(side => {
        const pending = review.pending[side];
        return pending && <article key={side}>
          <h4>Незакрытый период · {sideName[side]} · {stamp(session.now)} UTC</h4>
          <RecordText decision={pending} choices={session.scenario.choices} />
        </article>;
      })}
    </section>
  </>;
}

export function SessionView({ session, sessionId, onChange, onRepeat, onBack }: Props) {
  const [access, setAccess] = useState<{ session: Session; screen: Side | 'joint' } | null>(null);
  const [handoff, setHandoff] = useState<{ session: Session; side: Side } | null>(null);
  const [error, setError] = useState('');
  const [downloadStatus, setDownloadStatus] = useState<{ owner: typeof access; text: string; ok: boolean } | null>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const screen = access?.session === session ? access.screen : null;
  const finished = session.status === 'finished';
  const votes = finished ? session.unlockVotes : session.finishVotes;
  const defaultSide = votes.length === 1 ? otherSide(votes[0]) : session.pending.a ? 'b' : 'a';
  const target = handoff?.session === session ? handoff.side : defaultSide;

  function close(updated: Session, side: Side) {
    setError('');
    setDownloadStatus(null);
    setAccess(null);
    setHandoff({ session: updated, side });
  }
  async function save(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setDownloadStatus(null);
    try {
      await action();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Не удалось сохранить изменение.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function download(scope: Side | 'joint') {
    void save(async () => {
      const result = await downloadJournal(session, scope);
      setDownloadStatus({ owner: access, ok: result.ok, text: savedText(result, 'Журнал сохранён', 'Журнал').screen });
    });
  }
  const downloadMessage = downloadStatus && downloadStatus.owner === access &&
    <p role={downloadStatus.ok ? 'status' : 'alert'}>{downloadStatus.text}</p>;
  function change(command: () => Session, recipient: Side, submitted?: Side) {
    void save(async () => {
      const updated = command();
      await onChange(updated);
      if (submitted) clearDraft(draftKey(sessionId, submitted, session.now));
      if (updated.status === 'finished') {
        for (const side of bothSides) clearDraft(draftKey(sessionId, side, session.now));
      }
      close(updated, recipient);
    });
  }

  if (screen === null) {
    const recipients = finished ? [target, otherSide(target)] : [target];
    return <section className="replay-session replay-panel replay-handoff">
      <h2>{finished ? 'Сеанс завершён' : 'Передача устройства'}</h2>
      <p>{finished ? 'Откройте свой журнал на личном экране.' : 'Передайте устройство стороне ' + letter[target] + '.'}</p>
      <div className="replay-actions">
        {recipients.map(side => <button className="replay-primary" key={side} disabled={busy} onClick={() => setAccess({ session, screen: side })}>
          Открыть экран стороны {letter[side]}
        </button>)}
        {finished && canJointReview(session) && <button disabled={busy} onClick={() => setAccess({ session, screen: 'joint' })}>Открыть общий разбор</button>}
        <button disabled={busy} onClick={onBack}>К списку сеансов</button>
      </div>
    </section>;
  }

  if (screen === 'joint') {
    return <section className="replay-session">
      {error && <p role="alert">{error}</p>}
      <JointHistory session={session} />
      <div className="replay-actions">
        <button disabled={busy} onClick={() => download('joint')}>Скачать общий журнал</button>
        {downloadMessage}
        <button disabled={busy} onClick={() => close(session, 'a')}>Закрыть разбор</button>
        <button disabled={busy} onClick={() => void save(onRepeat)}>Повторить сценарий</button>
        <button disabled={busy} onClick={onBack}>К списку сеансов</button>
      </div>
    </section>;
  }

  const side = screen;
  const view = sideReview(session, side);
  const ownMaterials = (view.profile.materials ?? []).filter(item => view.materialIds.includes(item.id));
  const peer = otherSide(side);
  const choosingCountry = !finished && !view.pending && view.periods.length === 0 && view.countryOptions.length > 1;
  const editing = !finished && !view.pending;
  const history = <section className="replay-panel replay-history">
    <h3>Личный журнал</h3>
    {!view.periods.length && !view.pending && <p>Записей пока нет.</p>}
    {view.periods.map(period => <article key={period.start}>
      <h4>{stamp(period.start)} — {stamp(period.end)} UTC</h4>
      <RecordText decision={period.decision} choices={view.choices} effective={period.effectiveChoice} />
      <Events events={period.events} />
    </article>)}
    {view.pending && <article><h4>Запись текущего периода · {stamp(session.now)} UTC</h4>
      <RecordText decision={view.pending} choices={view.choices} />
    </article>}
  </section>;
  return <section className="replay-session">
    <header className="replay-session-heading">
      <div><p>{finished ? 'Личный разбор' : 'Личный экран'}{!choosingCountry && ' · ' + sideName[side]}</p>
        <h2>{choosingCountry ? sideName[side] : countryName(view.profile.country)}</h2></div>
      <button disabled={busy} onClick={() => close(session, peer)}>Передать устройство стороне {letter[peer]}</button>
    </header>
    <p>{session.scenario.title} · {session.scenario.area}</p>
    <p>{finished ? 'Время завершения' : 'Текущий период'} · <time>{stamp(session.now)}
      {!finished && ' — ' + stamp(periodEnd(session))} UTC</time></p>
    {error && <p role="alert">{error}</p>}
    <div className={'replay-columns' + (editing ? ' replay-composing' : '')}>
      {editing && <DecisionForm view={view} storageKey={draftKey(sessionId, side, session.now)} busy={busy}
        commit={decision => change(() => submitDecision(session, side, session.now, decision), peer, side)} />}
      <div className="replay-personal-context">
        <section className="replay-panel"><h3>Задача стороны</h3><p className="replay-verbatim">{view.profile.objective}</p>
          {(finished || view.pending || view.periods.length > 0) && ownMaterials.length > 0 && <>
            <h3>Материалы стороны</h3>
            <ul>{ownMaterials.map(item => <li key={item.id}>{item.label}<MaterialDetails material={item} /></li>)}</ul>
          </>}
        </section>
        <ScenarioMap scenario={session.scenario} initiallyOpen={editing} />
        {editing && history}
      </div>
      {!editing && history}
    </div>
    <div className="replay-panel replay-actions">
      {!finished && (session.finishVotes.includes(side)
        ? <p>Ваше согласие на завершение записано.</p>
        : <button disabled={busy} onClick={() => change(() => voteFinish(session, side), peer)}>
          {session.finishVotes.includes(peer) ? 'Согласиться завершить сеанс' : 'Предложить завершить сеанс'}
        </button>)}
      {finished && !canJointReview(session) && (session.unlockVotes.includes(side)
        ? <p>Ваше согласие на общий разбор записано.</p>
        : <><p>После согласия обеих сторон им станут доступны обе задачи, личные записи и все события.</p>
          <button disabled={busy} onClick={() => change(() => voteUnlock(session, side), peer)}>Разрешить общий разбор</button>
        </>)}
      {finished && <button disabled={busy} onClick={() => download(side)}>Скачать личный журнал</button>}
      {downloadMessage}
      {finished && canJointReview(session) && <button disabled={busy} onClick={() => close(session, side)}>К выбору разбора</button>}
      {finished && <button disabled={busy} onClick={() => void save(onRepeat)}>Повторить сценарий</button>}
      <button disabled={busy} onClick={onBack}>К списку сеансов</button>
    </div>
  </section>;
}
