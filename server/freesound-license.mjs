const CC0_MARKERS = ['/publicdomain/zero/', 'creativecommons.org/publicdomain/zero']
const CC_BY_MARKERS = ['/licenses/by/', 'creativecommons.org/licenses/by/']
const NON_COMMERCIAL_MARKERS = ['/by-nc', 'noncommercial']
const SHARE_ALIKE_MARKERS = ['/by-sa', 'sharealike']
const LICENSE_RULES = [
  { markers: NON_COMMERCIAL_MARKERS, code: 'non-commercial', compatible: false },
  { markers: SHARE_ALIKE_MARKERS, code: 'share-alike', compatible: false },
  { markers: CC0_MARKERS, code: 'cc0', compatible: true },
  { markers: CC_BY_MARKERS, code: 'cc-by', compatible: true },
]

export function classifyFreesoundLicense(value) {
  const exact = String(value || '').trim()
  const normalized = exact.toLowerCase()
  if (!normalized) return { code: 'unknown', compatible: false, exact }
  const rule = LICENSE_RULES.find((candidate) =>
    candidate.markers.some((marker) => normalized.includes(marker)),
  )
  return rule
    ? { code: rule.code, compatible: rule.compatible, exact }
    : { code: 'unknown', compatible: false, exact }
}

export function isAllowedFreesoundLicense(value, policy = 'youtube-safe') {
  const classification = classifyFreesoundLicense(value)
  if (policy === 'cc0-only') return classification.code === 'cc0'
  return classification.compatible
}
