// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRevision } from '../../../packages/kshvi/src/documents/browser';
import { issueDocument, recordDocumentFact, supersedeDocument, transitionDocument } from '../../../packages/kshvi/src/documents/browser';
import { advanceApproval } from '../../../packages/kshvi/src/documents/browser';
import type { CascadeDelivery } from '../../../packages/kshvi/src/documents/browser';
import { DocumentEditor } from '../src/modern/kshvi/documents/DocumentEditor';
import { ApprovalPanel } from '../src/modern/kshvi/documents/ApprovalPanel';
import { CascadePanel } from '../src/modern/kshvi/documents/CascadePanel';

afterEach(cleanup);

const HASH = 'a'.repeat(64);

function revision(overrides: Partial<DocumentRevision> = {}): DocumentRevision {
  return {
    id: 'order-1:r1', documentId: 'order-1', revision: 1, state: 'IN_REVIEW',
    requisites: {
      exerciseId: 'exercise-1', scenarioRevisionId: 'scenario-1', instanceId: 'hq', authorId: 'author', category: 'OPERATIONAL', type: 'ORDER',
      title: 'Приказ на действия', number: '15', operationalAt: '2030-01-01T06:00:00+03:00', place: 'КП',
      validFrom: '2030-01-01T00:00:00+03:00', validUntil: '2030-01-02T00:00:00+03:00', stageId: 'stage-1', sideId: 'blue',
      visibility: { sideIds: ['blue'], instanceIds: [], roles: [] }, addressees: [{ instanceId: 'unit', channelId: 'main' }], copies: [],
      sourceRole: 'COMMANDER', deliveryChannelId: 'main', basis: 'План', executorId: 'unit', deadlineAt: '2030-01-01T08:00:00+03:00',
      linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: [], templateVersion: 'order:v1',
    },
    content: { body: 'Выполнить задачу', units: { distance: 'm' } }, map: null, attachments: [], approvalRouteId: 'route-1',
    sha256: HASH, supersedes: null, supersedesRevision: null, supersedeReason: null, signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] }, ...overrides,
  };
}

function issuedRevision(): DocumentRevision {
  const approved = transitionDocument(revision(), 'APPROVE', { signature: { userId: 'commander-1', role: 'COMMANDER', signedAt: '2030-01-01T05:30:00+03:00' } });
  return issueDocument(approved, {
    recipient: { instanceId: 'unit', sideId: 'blue', roles: ['COMMANDER'] }, knownInstanceIds: ['hq', 'unit'],
    availableChannelIds: ['main'], senderHasAuthority: true, at: '2030-01-01T06:00:00+03:00',
  });
}

describe('редактор документа', () => {
  it('показывает конкретное обязательное поле и не даёт утвердить неполный документ', () => {
    const onApprove = vi.fn();
    render(<DocumentEditor revision={revision({ requisites: { ...revision().requisites, basis: '' } })} onApprove={onApprove} />);
    expect(screen.getByRole('heading', { name: 'Приказ на действия' })).toBeTruthy();
    expect(screen.getByText(/Поле requisites\.basis обязательно/)).toBeTruthy();
    const approve = screen.getByRole('button', { name: 'Утвердить' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(approve);
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText('Редакция 1')).toBeTruthy();
    expect(screen.getByText('2030-01-01T06:00:00+03:00')).toBeTruthy();
  });

  it('показывает неизменяемую подпись и отдельные факты получения и исполнения', () => {
    const issued = issuedRevision();
    const delivered = recordDocumentFact(issued, 'DELIVERED', { at: '2030-01-01T06:05:00+03:00', actorId: 'unit' });
    const acknowledged = recordDocumentFact(delivered, 'ACKNOWLEDGED', { at: '2030-01-01T06:06:00+03:00', actorId: 'unit' });
    const started = recordDocumentFact(acknowledged, 'EXECUTION_STARTED', { at: '2030-01-01T06:07:00+03:00', actorId: 'unit' });
    const { rerender } = render(<DocumentEditor revision={started} />);
    expect((screen.getByLabelText('Содержимое документа') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.getByText('Подпись: commander-1 / COMMANDER')).toBeTruthy();
    expect(screen.getByText('Получение: 2030-01-01T06:05:00+03:00')).toBeTruthy();
    expect(screen.getByText('Ознакомление: 2030-01-01T06:06:00+03:00')).toBeTruthy();
    expect(screen.getByText('Начало исполнения: 2030-01-01T06:07:00+03:00')).toBeTruthy();
    const next = supersedeDocument(issued, { reason: 'Уточнение', sha256: 'b'.repeat(64) });
    rerender(<DocumentEditor revision={next} />);
    expect(screen.getByText('Заменяет редакцию 1')).toBeTruthy();
    expect(screen.getByText('Прежняя подпись: commander-1 / COMMANDER')).toBeTruthy();
    expect(screen.getAllByText(HASH).length).toBeGreaterThan(0);
    expect(screen.getByText('Основание новой редакции: Уточнение')).toBeTruthy();
  });
});

describe('двойная вертикаль и каскад', () => {
  it('показывает конфликт и обе позиции, а не согласие одной ветви', () => {
    let dual = advanceApproval({ command: 'PENDING', service: 'PENDING' }, { actor: 'commander', branch: 'command', decision: 'APPROVED', comment: 'Командир согласен' });
    dual = advanceApproval(dual, { actor: 'service', branch: 'service', decision: 'CHANGES_REQUESTED', comment: 'Служба против' });
    render(<ApprovalPanel dual={dual} actorId="commander" />);
    expect(screen.getByRole('alert').textContent).toContain('Конфликт ветвей согласования');
    expect(screen.getByText('Командная ветвь: APPROVED')).toBeTruthy();
    expect(screen.getByText('Функциональная ветвь: CHANGES_REQUESTED')).toBeTruthy();
    expect(screen.getByText('Командир согласен')).toBeTruthy();
    expect(screen.getByText('Служба против')).toBeTruthy();
    expect(screen.getByText('Разрешает: designatedAuthority')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Разрешить разногласие' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('показывает самостоятельные доставку, подтверждение и исполнение каждого плеча', () => {
    const first: CascadeDelivery = {
      id: 'leg-1', messageId: 'message-1', source: { documentId: 'order-1', revision: 1, sha256: HASH }, from: 'hq', to: 'middle', channelId: 'main', relayId: 'relay-1',
      queuedAt: '2030-01-01T06:00:00+03:00', scheduledDeliveryAt: '2030-01-01T06:05:00+03:00', processingDeadlineAt: '2030-01-01T06:20:00+03:00',
      state: 'ACKNOWLEDGED', copyStatus: 'FULL', omittedAttachmentIds: [], facts: [], deliveredAt: '2030-01-01T06:05:00+03:00', acknowledgedAt: '2030-01-01T06:06:00+03:00', executionStartedAt: null, failureReason: null,
    };
    const second = { ...first, id: 'leg-2', messageId: 'message-2', to: 'neighbor', state: 'QUEUED' as const, deliveredAt: null, acknowledgedAt: null };
    render(<CascadePanel deliveries={[first, second]} />);
    const firstArticle = screen.getByText('hq → middle').closest('article');
    const secondArticle = screen.getByText('hq → neighbor').closest('article');
    expect(firstArticle).toBeTruthy();
    expect(secondArticle).toBeTruthy();
    expect(within(firstArticle as HTMLElement).getByText('Получение подтверждено')).toBeTruthy();
    expect(within(firstArticle as HTMLElement).getByText('Исполнение не начато')).toBeTruthy();
    expect(within(secondArticle as HTMLElement).getByText('Ожидает передачи')).toBeTruthy();
    expect(within(secondArticle as HTMLElement).getByText('Получение не подтверждено')).toBeTruthy();
    expect(within(firstArticle as HTMLElement).getByText('Сообщение: message-1')).toBeTruthy();
    expect(within(secondArticle as HTMLElement).getByText('Сообщение: message-2')).toBeTruthy();
  });
});
