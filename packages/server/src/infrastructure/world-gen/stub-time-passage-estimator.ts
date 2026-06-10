import 'server-only'

import type {
  TimePassageEstimate,
  TimePassageEstimator,
  TimePassageEstimatorInput,
} from '@/domain/ports/time-passage-estimator'

// StubTimePassageEstimator (starship P6) — a deterministic, LLM-free
// TimePassageEstimator for tests and the offline scripts. It returns a fixed,
// modest elapsed span per beat so the ship-clock advances predictably without an
// API key or spend — same input in, same estimate out.

// A modest per-beat span — a short conversational exchange. Small enough that the
// clock advances sanely over many turns, non-zero so a beat always moves time.
const STUB_ELAPSED_MINUTES = 5

export class StubTimePassageEstimator implements TimePassageEstimator {
  async estimate(_input: TimePassageEstimatorInput): Promise<TimePassageEstimate> {
    return { elapsedMinutes: STUB_ELAPSED_MINUTES }
  }
}
