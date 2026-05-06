export interface NamedProvider {
  id: string
}

export class ProviderRegistry<TProvider extends NamedProvider> {
  private readonly providers = new Map<string, TProvider>()

  constructor(
    providers: readonly TProvider[],
    private readonly defaultProviderId: string,
  ) {
    for (const provider of providers) {
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate provider ID: "${provider.id}"`)
      }
      this.providers.set(provider.id, provider)
    }

    if (!this.providers.has(defaultProviderId)) {
      throw new Error(`Default provider ID "${defaultProviderId}" not found in providers`)
    }
  }

  get(id: string): TProvider {
    const provider = this.providers.get(id)
    if (!provider) {
      throw new Error(`Unknown provider: ${id}`)
    }

    return provider
  }

  getDefault(): TProvider {
    return this.get(this.defaultProviderId)
  }

  list(): readonly TProvider[] {
    return [...this.providers.values()]
  }
}
