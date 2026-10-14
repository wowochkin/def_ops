import { describe, expect, it } from 'vitest';
import { LlmClient, textOf, type ChatMessage } from '../src/llm/client';

describe('картинки в запросе', () => {
  const c = new LlmClient({ url: 'http://x/v1', model: 'm', thinking: 'off', timeoutMs: 1000, maxTokens: 10 } as never);
  const url = 'data:image/png;base64,AAAA';
  const msg: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'что тут?' }, { type: 'image_url', image_url: { url } }] };
  it('тело запроса несёт части как есть', () => {
    const b = JSON.parse(JSON.stringify(c.body('m', { messages: [msg] }))) as { messages: ChatMessage[] };
    expect(b.messages[0].content).toEqual([{ type: 'text', text: 'что тут?' }, { type: 'image_url', image_url: { url } }]);
  });
  it('textOf склеивает текст и пропускает картинки', () => {
    expect(textOf(msg.content)).toBe('что тут?');
    expect(textOf('строка')).toBe('строка');
  });
});
