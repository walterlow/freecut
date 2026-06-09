import { vi } from 'vite-plus/test'

type GpuMockOptions<
  TDevice extends Record<string, unknown>,
  TPass extends Record<string, unknown>,
  TQueue extends Record<string, unknown>,
> = {
  device?: TDevice
  pass?: TPass
  queue?: TQueue
}

export function createGpuRenderPipelineMocks<
  TDevice extends Record<string, unknown> = Record<string, never>,
  TPass extends Record<string, unknown> = Record<string, never>,
  TQueue extends Record<string, unknown> = Record<string, never>,
>(options: GpuMockOptions<TDevice, TPass, TQueue> = {}) {
  const queue = {
    submit: vi.fn(),
    writeBuffer: vi.fn(),
    ...options.queue,
  } as {
    submit: ReturnType<typeof vi.fn>
    writeBuffer: ReturnType<typeof vi.fn>
  } & TQueue
  const pass = {
    draw: vi.fn(),
    end: vi.fn(),
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
    ...options.pass,
  } as {
    draw: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    setBindGroup: ReturnType<typeof vi.fn>
    setPipeline: ReturnType<typeof vi.fn>
  } & TPass
  const commandEncoder = {
    beginRenderPass: vi.fn(() => pass),
    finish: vi.fn(() => 'finished-command-buffer'),
  }
  const device = {
    createBindGroup: vi.fn(() => 'bind-group'),
    createBindGroupLayout: vi.fn(() => 'bind-group-layout'),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createCommandEncoder: vi.fn(() => commandEncoder),
    createPipelineLayout: vi.fn(() => 'pipeline-layout'),
    createRenderPipeline: vi.fn(() => 'render-pipeline'),
    createSampler: vi.fn(() => 'sampler'),
    createShaderModule: vi.fn(() => 'shader-module'),
    queue,
    ...options.device,
  } as {
    createBindGroup: ReturnType<typeof vi.fn>
    createBindGroupLayout: ReturnType<typeof vi.fn>
    createBuffer: ReturnType<typeof vi.fn>
    createCommandEncoder: ReturnType<typeof vi.fn>
    createPipelineLayout: ReturnType<typeof vi.fn>
    createRenderPipeline: ReturnType<typeof vi.fn>
    createSampler: ReturnType<typeof vi.fn>
    createShaderModule: ReturnType<typeof vi.fn>
    queue: typeof queue
  } & TDevice
  return { commandEncoder, device, pass, queue }
}
