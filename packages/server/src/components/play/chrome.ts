// Player-facing play chrome. Product type is the park name, not Animus /
// "text adventure". Persistence layer names stay hub / subworld / standalone.

export function playLayerLabel(
  layer: 'hub' | 'subworld' | 'standalone',
): string | null {
  if (layer === 'subworld') return 'Narrative'
  return null
}

export function returnToParkLabel(parkName: string | null | undefined): string {
  const name = parkName?.trim()
  return name ? `Return to ${name}` : 'Return to the park'
}
