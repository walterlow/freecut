export interface SceneVerificationProvider {
  id: string
  label: string
  getWorker(): Worker
  resetWorker(): void
  disposeWorker(): void
}
