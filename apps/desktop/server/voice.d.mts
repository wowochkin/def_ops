export const VOICE_PORT: number;
export function voicePlan(o: { python: boolean; portAnswers: boolean; installed: boolean; supported: boolean }): 'attach' | 'spawn' | 'off' | 'unsupported';
export function restartDelay(n: number): number | null;
export function startVoice(o: { repo: string; data: string; voiceDir: string; log?: (s: string) => void; isStopping?: () => boolean }): Promise<{ stop: () => void }>;
