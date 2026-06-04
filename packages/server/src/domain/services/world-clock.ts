export type WorldTimeBand = 'morning' | 'midday' | 'evening' | 'night'

// world_time is free text (e.g. "Day 3, 3pm", "dusk over the bay"). Parse a
// 24h hour when a clock is present; otherwise fall back to keywords; otherwise
// midday. Pure + deterministic. Bands: morning 5–11, midday 11–17, evening
// 17–21, night 21–5.
export function worldTimeBand(worldTime: string | null): WorldTimeBand {
  if (!worldTime) return 'midday'
  const text = worldTime.toLowerCase()

  // Only trust a clock token that carries ":mm" or am/pm — a bare number like
  // the "3" in "Day 3" must not be read as an hour. Requiring that qualifier in
  // the pattern also skips past leading bare numbers to find "7am" etc.
  const clock = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)|(\d{1,2}):(\d{2})/)
  if (clock) {
    let hour = parseInt(clock[1] ?? clock[4], 10)
    const meridiem = clock[3]
    if (!Number.isNaN(hour) && hour >= 0 && hour <= 24) {
      if (meridiem === 'pm' && hour < 12) hour += 12
      if (meridiem === 'am' && hour === 12) hour = 0
      if (hour === 24) hour = 0
      return bandForHour(hour)
    }
  }

  if (/\b(dawn|sunrise|morning|early)\b/.test(text)) return 'morning'
  if (/\b(noon|midday|lunch|afternoon)\b/.test(text)) return 'midday'
  if (/\b(dusk|sunset|evening|twilight)\b/.test(text)) return 'evening'
  if (/\b(night|midnight|late)\b/.test(text)) return 'night'
  return 'midday'
}

function bandForHour(hour: number): WorldTimeBand {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'midday'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}
