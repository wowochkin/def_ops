import type { AdminAccountPublic } from '../../../../../../services/kshvi/src/admin/admin-overview-service';

const stateLabels = { ACTIVE: 'Активна', BLOCKED: 'Заблокирована', ARCHIVED: 'Архивирована' } as const;

export function AccountsWorkspace({ accounts, disseminationLabel, onBlock, onArchive }: {
  accounts: readonly AdminAccountPublic[];
  disseminationLabel: string;
  onBlock: (userId: string) => void;
  onArchive: (userId: string) => void;
}) {
  return <section className="modern-kshvi kshvi-admin" aria-labelledby="accounts-heading">
    <h2 id="accounts-heading">Локальные учётные записи</h2>
    <p>Каталог закрытой установки. Метка распространения: {disseminationLabel}.</p>
    <p>Сертификация для обработки секретных сведений не заявляется.</p>
    <div className="kshvi-admin-table" role="region" aria-label="Учётные записи" tabIndex={0}>
      <table>
        <thead><tr><th>Учётная запись</th><th>Организация</th><th>Технические права</th><th>Состояние</th><th>Действия</th></tr></thead>
        <tbody>{accounts.map(account => <tr key={account.userId}>
          <td>{account.username}</td><td>{account.organizationId}</td>
          <td>{account.technicalPermissions.join(', ')}</td>
          <td>{stateLabels[account.state]}</td>
          <td><button disabled={account.state !== 'ACTIVE'} onClick={() => onBlock(account.userId)}>Заблокировать {account.username}</button>{' '}
            <button disabled={account.state === 'ARCHIVED'} onClick={() => onArchive(account.userId)}>Архивировать {account.username}</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
