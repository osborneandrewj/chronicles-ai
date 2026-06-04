'use server'

import { revalidatePath } from 'next/cache'

import { archiveWorld, unarchiveWorld } from '@/lib/worlds'

export async function archiveWorldAction(worldId: number): Promise<void> {
  archiveWorld(worldId)
  revalidatePath('/')
}

export async function unarchiveWorldAction(worldId: number): Promise<void> {
  unarchiveWorld(worldId)
  revalidatePath('/')
}
