export const VOICE_PORT: number;
export function voicePlan(o: { python: boolean; portAnswers: boolean }): 'attach' | 'spawn' | 'off';
export function restartDelay(n: number): number | null;
export function startVoice(o: { repo: string; data: string; voiceDir: string; log?: (s: string) => void }): Promise<{ stop: () => void }>;
