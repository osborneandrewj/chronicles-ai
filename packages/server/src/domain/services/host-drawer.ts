import type { HostFile, HostRoster } from '@/domain/entities/host'

export function walkOnDrawer(roster: HostRoster): HostFile[] {
  return roster.hosts.filter((host) => host.kind === 'walk-on')
}

export function principalHosts(roster: HostRoster): HostFile[] {
  return roster.hosts.filter((host) => host.kind === 'principal')
}

export function offStageHosts(roster: HostRoster): HostFile[] {
  return roster.hosts.filter((host) => host.kind === 'off-stage')
}
