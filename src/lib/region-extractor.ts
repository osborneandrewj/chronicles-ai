import { anthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'

// One-shot Haiku call run at world creation. Reads the world premise and
// returns a Nominatim-friendly region string (e.g. "Hayden, Idaho, USA") used
// to bias real-world geocoding for that world's places. Returns null when the
// premise describes a fictional/secondary setting — geocoding bias only helps
// for real places, and a junk region string would degrade lookups elsewhere.

const REGION_EXTRACTOR_MODEL = 'claude-haiku-4-5-20251001'

const SettingRegionSchema = z.object({
  is_real_world: z
    .boolean()
    .describe(
      'True if the premise is set in a recognizable real-world location (real city, region, or country). ' +
        'False for fantasy worlds, sci-fi planets, or generic/unspecified settings.',
    ),
  region: z
    .string()
    .nullable()
    .describe(
      'A Nominatim-style region anchor: "City, State/Province, Country" or "City, Country". ' +
        'For example "Hayden, Idaho, USA" or "Mevagissey, Cornwall, United Kingdom". ' +
        'Return null when is_real_world is false, or when the premise does not name a specific real place.',
    ),
})

export type SettingRegion = z.infer<typeof SettingRegionSchema>

export async function extractSettingRegion(
  premise: string,
  initialLocation: string | null,
): Promise<string | null> {
  try {
    const { object } = await generateObject({
      model: anthropic(REGION_EXTRACTOR_MODEL),
      schema: SettingRegionSchema,
      system:
        'You extract the real-world geographic setting from an interactive-novel premise. ' +
          'Your output biases a Nominatim geocoder, so prefer canonical place names ' +
          '("Coeur d\'Alene, Idaho, USA", not "CDA"). When the setting is fantasy, ' +
          'science fiction, or unspecified, return is_real_world=false and region=null.',
      prompt: [
        'PREMISE:',
        premise,
        '',
        initialLocation ? `INITIAL LOCATION HINT:\n${initialLocation}` : 'INITIAL LOCATION HINT: (none)',
      ].join('\n'),
    })
    if (!object.is_real_world) return null
    const region = object.region?.trim()
    return region && region.length > 0 ? region : null
  } catch (err) {
    console.error('[region extractor failed]', err)
    return null
  }
}
