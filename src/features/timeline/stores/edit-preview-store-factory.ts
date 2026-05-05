import { create, type StoreApi, type UseBoundStore } from 'zustand'

type EditPreviewActions<PreviewParams> = {
  setPreview: (params: PreviewParams) => void
  clearPreview: () => void
}

type EditPreviewStore<State, PreviewParams, ExtraActions> = State &
  EditPreviewActions<PreviewParams> &
  ExtraActions

type NoExtraActions = Record<never, never>

type EditPreviewExtraActionsFactory<State, PreviewParams, ExtraActions> = (
  set: StoreApi<EditPreviewStore<State, PreviewParams, ExtraActions>>['setState'],
) => ExtraActions

type EditPreviewStoreBaseOptions<State, PreviewParams> = {
  initialState: () => State
  normalizePreview?: (params: PreviewParams) => Partial<State>
}

type EditPreviewStoreOptions<State, PreviewParams, ExtraActions> = EditPreviewStoreBaseOptions<
  State,
  PreviewParams
> &
  ([keyof ExtraActions] extends [never]
    ? { createActions?: never }
    : { createActions: EditPreviewExtraActionsFactory<State, PreviewParams, ExtraActions> })

type EditPreviewStoreImplementationOptions<State, PreviewParams, ExtraActions> =
  EditPreviewStoreBaseOptions<State, PreviewParams> & {
    createActions?: EditPreviewExtraActionsFactory<State, PreviewParams, ExtraActions>
  }

export function createEditPreviewStore<State extends object, PreviewParams extends object>(
  options: EditPreviewStoreOptions<State, PreviewParams, NoExtraActions>,
): UseBoundStore<StoreApi<EditPreviewStore<State, PreviewParams, NoExtraActions>>>
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
  options: EditPreviewStoreImplementationOptions<State, PreviewParams, ExtraActions>,
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
