import {
  concludeResearch,
  createResearchCard,
  type ResearchCard,
  type ResearchCardInput,
  type ResearchConclusionInput,
} from '../../../../packages/kshvi/src/replay/research-card';

export class ResearchService {
  private readonly cards = new Map<string, ResearchCard>();
  private nextId = 1;

  create(input: ResearchCardInput): ResearchCard {
    const card = createResearchCard({ ...input, id: input.id ?? `research-${this.nextId++}` });
    this.cards.set(card.id, card);
    return structuredClone(card);
  }

  conclude(id: string, input: ResearchConclusionInput): ResearchCard {
    const card = this.cards.get(id);
    if (!card) throw new Error('Исследовательская карточка не найдена');
    const concluded = concludeResearch(card, input);
    this.cards.set(id, concluded);
    return structuredClone(concluded);
  }
}
