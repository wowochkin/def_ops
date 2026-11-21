import type { GuardedLanguageRequest, OptionalLanguagePort, OptionalLanguageResponse } from './optional-language-port';

export type { GuardedLanguageRequest } from './optional-language-port';

export type GuardedTextResult = Readonly<{
  text: string;
  status: 'DISABLED' | 'LOCAL_FALLBACK' | 'LLM';
  source: 'LOCAL' | 'LLM';
  claimsVerified: boolean;
  executable: false;
  model?: string;
}>;

function validResponse(response: OptionalLanguageResponse, request: GuardedLanguageRequest): boolean {
  if (!response.text.trim() || response.text.length > 12_000) return false;
  if (/^\s*(?:agent-command\s*:|\{\s*"(?:kind|command|commandId)")/i.test(response.text)) return false;
  return response.claims.every(claim => Object.hasOwn(request.facts, claim.factId) && request.facts[claim.factId] === claim.value);
}

function fallback(text: string, disabled: boolean): GuardedTextResult {
  return {
    text,
    status: disabled ? 'DISABLED' : 'LOCAL_FALLBACK',
    source: 'LOCAL',
    claimsVerified: false,
    executable: false,
  };
}

export async function formulateGuardedText(
  port: OptionalLanguagePort | undefined,
  request: GuardedLanguageRequest,
  localFallback: () => string,
): Promise<GuardedTextResult> {
  if (!port) return fallback(localFallback(), true);
  try {
    const response = await port.formulate(request);
    if (!validResponse(response, request)) return fallback(localFallback(), false);
    return {
      text: response.text,
      status: 'LLM',
      source: 'LLM',
      claimsVerified: true,
      executable: false,
      ...(response.model ? { model: response.model } : {}),
    };
  } catch {
    return fallback(localFallback(), false);
  }
}
