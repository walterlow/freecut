import { create, type StoreApi, type UseBoundStore } from 'zustand'

type EditPreviewActions<PreviewParams> = {
  setPreview: (params: PreviewParams) => void
  clearPreview: () => void
}

type EditPreviewStore<State, PreviewParams, ExtraActions> = State &
  EditPreviewActions<PreviewParams> &
  ExtraActions

type EditPreviewStoreOptions<State, PreviewParams, ExtraActions> = {
  initialState: () => State
  normalizePreview?: (params: PreviewParams) => Partial<State>
  createActions?: (
    set: StoreApi<EditPreviewStore<State, PreviewParams, ExtraActions>>['setState'],
  ) => ExtraActions
}

export function createEditPreviewStore<State extends object, PreviewParams extends object>(
  options: EditPreviewStoreOptions<State, PreviewParams, Record<string, never>>,
): UseBoundStore<StoreApi<EditPreviewStore<State, PreviewParams, Record<string, never>>>>
export function createEditPreviewStore<
  State extends object,
  PreviewParams extends object,
  ExtraActions extends object,
>(
  options: EditPreviewStoreOptions<State, PreviewParams, ExtraActions>,
): UseBoundStore<StoreApi<EditPreviewStore<State, PreviewParams, ExtraActions>>>
export function createEditPreviewStore<
  State extends object,
  PreviewParams extends object,
  ExtraActions extends object,
>(
  options: EditPreviewStoreOptions<State, PreviewParams, ExtraActions>,
): UseBoundStore<StoreApi<EditPreviewStore<State, PreviewParams, ExtraActions>>> {
  return create<EditPreviewStore<State, PreviewParams, ExtraActions>>()((set) => ({
    ...options.initialState(),
    setPreview: (params) =>
      set(
        (options.normalizePreview?.(params) ?? params) as Partial<
          EditPreviewStore<State, PreviewParams, ExtraActions>
        >,
      ),
    clearPreview: () =>
      set(options.initialState() as Partial<EditPreviewStore<State, PreviewParams, ExtraActions>>),
    ...(options.createActions?.(set) ?? ({} as ExtraActions)),
  }))
}
