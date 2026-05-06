export type ChangelogGroup = 'added' | 'fixed' | 'improved'

export type ChangelogItem = {
  title: string
}

export type ChangelogEntry = {
  version: string
  date: string
  subtitle?: string
  groups: Partial<Record<ChangelogGroup, ChangelogItem[]>>
}

export type ChangelogFile = {
  current: ChangelogEntry | null
  releases: ChangelogEntry[]
}
