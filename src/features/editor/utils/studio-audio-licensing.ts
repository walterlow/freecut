import type { StudioAudioLicensePolicy, StudioAudioSourceMetadata } from '@/types/studio-audio'
import type { TimelineItem } from '@/types/timeline'

export interface StudioAudioLicenseIssue {
  id: string
  severity: 'warning' | 'error'
  itemId: string
  message: string
}

export function isStudioAudioLicenseAllowed(
  source: StudioAudioSourceMetadata,
  policy: StudioAudioLicensePolicy,
): boolean {
  if (policy === 'cc0-only') return source.licenseCode === 'cc0'
  return source.licenseCode === 'cc0' || source.licenseCode === 'cc-by'
}

export function validateStudioAudioLicenses(
  items: TimelineItem[],
  policy: StudioAudioLicensePolicy = 'youtube-safe',
): StudioAudioLicenseIssue[] {
  const issues: StudioAudioLicenseIssue[] = []
  for (const item of items) {
    const source = item.studioAudioSource
    if (!source) continue
    if (!source.license || !source.licenseUrl || !source.creator || !source.sourceUrl) {
      issues.push({
        id: `missing-license-metadata:${item.id}`,
        severity: 'error',
        itemId: item.id,
        message: `${item.label} is missing required creator or licence metadata.`,
      })
      continue
    }
    if (!isStudioAudioLicenseAllowed(source, policy)) {
      issues.push({
        id: `incompatible-license:${item.id}`,
        severity: 'error',
        itemId: item.id,
        message: `${item.label} uses ${source.license}, which is not allowed by the ${policy} policy.`,
      })
    }
    if (source.licenseCode === 'cc-by' && source.approval !== 'approved') {
      issues.push({
        id: `attribution-review:${item.id}`,
        severity: 'warning',
        itemId: item.id,
        message: `${item.label} requires creator attribution and has not been approved yet.`,
      })
    }
  }
  return issues
}
