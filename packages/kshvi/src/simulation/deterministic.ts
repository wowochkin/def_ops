import { aggregateEpisode, type EpisodeInput } from './aggregate';

export function deterministicEpisode(input: EpisodeInput) {
  return aggregateEpisode(input);
}
