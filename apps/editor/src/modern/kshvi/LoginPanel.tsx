import { useId, useState, type FormEvent } from 'react';
import type { KshviClient, LoginResult, Participant } from './kshvi-api';

export const roleNames: Record<string, string> = {
  AUTHOR: 'Автор', APPROVER: 'Утверждающий',
  PLAYGROUP: 'Группа розыгрыша', ANALYST: 'Аналитик', PROJECTOR: 'Проектор',
  DIRECTOR: 'Руководитель учения', LEADER: 'Командир', TRAINEE: 'Обучаемый',
  INTERMEDIARY: 'Посредник', TECH_ADMIN: 'Технический администратор', OBSERVER: 'Наблюдатель',
};

export function LoginPanel({ client, onAuthenticated }: {
  client: Pick<KshviClient, 'login' | 'selectRole'>;
  onAuthenticated(participant: Participant): void;
}) {
  const uid = useId().replaceAll(':', '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<LoginResult | null>(null);
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function chooseRole(id: string): Promise<void> {
    const participant = await client.selectRole(id);
    onAuthenticated(participant);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (pending) {
        await chooseRole(roleId);
        return;
      }
      const result = await client.login(username, password);
      if (!result.roles.length) throw new Error('Учётной записи не назначена роль. Обратитесь к администратору.');
      setPending(result);
      setRoleId(result.roles[0]!.id);
      if (result.roles.length === 1) await chooseRole(result.roles[0]!.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return <section className="kshvi-login" aria-labelledby={`${uid}-title`}>
    <h2 id={`${uid}-title`}>Вход в КШВИ</h2>
    <p>Роль и полномочия подтверждаются сервером после входа.</p>
    <form onSubmit={submit}>
      {!pending && <>
        <label htmlFor={`${uid}-username`}>Имя пользователя</label>
        <input id={`${uid}-username`} value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required autoFocus />
        <label htmlFor={`${uid}-password`}>Пароль</label>
        <input id={`${uid}-password`} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required />
      </>}
      {pending && pending.roles.length > 1 && <>
        <label htmlFor={`${uid}-role`}>Назначенная роль</label>
        <select id={`${uid}-role`} value={roleId} onChange={event => setRoleId(event.target.value)}>
          {pending.roles.map(role => <option key={role.id} value={role.id}>{roleNames[role.role] ?? role.role}{role.sideId ? ` · ${role.sideId}` : ''}</option>)}
        </select>
      </>}
      <button className="kshvi-primary" type="submit" disabled={busy}>{busy ? 'Подтверждаем на сервере…' : pending ? 'Выбрать роль' : 'Войти'}</button>
      {error && <p role="alert" className="kshvi-error">{error}</p>}
    </form>
  </section>;
}
