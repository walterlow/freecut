type PreviewDefaults<Defaults extends object> = {
  [Key in keyof Defaults]-?: Exclude<Defaults[Key], undefined>
}

export function withPreviewDefaults<PreviewParams extends object, Defaults extends object>(
  params: PreviewParams,
  defaults: PreviewDefaults<Defaults>,
): PreviewParams & PreviewDefaults<Defaults> {
  const normalized = { ...params } as Record<string, unknown>

  for (const [key, defaultValue] of Object.entries(defaults)) {
    normalized[key] = normalized[key] ?? defaultValue
  }

  return normalized as PreviewParams & PreviewDefaults<Defaults>
}
