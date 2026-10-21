export function needsVoiceSetup(o: { platform: string; arch: string; disabled: boolean; hasPython: boolean; importsOk: boolean }): boolean;
export function ensureVoiceEnv(voiceDir: string, log?: (s: string) => void): 'ok' | 'installed' | 'failed';
