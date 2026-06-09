const SCOPE_CLEAR_COLOR: GPUColor = { r: 0.04, g: 0.04, b: 0.04, a: 1 }

export function createScopeRenderBindGroupLayout(
  device: GPUDevice,
  bufferTypes: GPUBufferBindingType[],
): GPUBindGroupLayout {
  return device.createBindGroupLayout({
    entries: bufferTypes.map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type },
    })),
  })
}

export function createScopeRenderPipeline({
  device,
  format,
  layout,
  shaderCode,
}: {
  device: GPUDevice
  format: GPUTextureFormat
  layout: GPUBindGroupLayout
  shaderCode: string
}): GPURenderPipeline {
  const renderModule = device.createShaderModule({ code: shaderCode })
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
  })
}

export function dispatchScopeComputePass({
  encoder,
  pipeline,
  bindGroup,
  srcW,
  srcH,
}: {
  encoder: GPUCommandEncoder
  pipeline: GPUComputePipeline
  bindGroup: GPUBindGroup
  srcW: number
  srcH: number
}): void {
  const computePass = encoder.beginComputePass()
  computePass.setPipeline(pipeline)
  computePass.setBindGroup(0, bindGroup)
  computePass.dispatchWorkgroups(Math.ceil(srcW / 16), Math.ceil(srcH / 16))
  computePass.end()
}

export function drawFullscreenScopePass({
  device,
  context,
  pipeline,
  bindGroup,
  encoder = device.createCommandEncoder(),
  submit = true,
}: {
  device: GPUDevice
  context: GPUCanvasContext
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  encoder?: GPUCommandEncoder
  submit?: boolean
}): void {
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: SCOPE_CLEAR_COLOR,
      },
    ],
  })
  renderPass.setPipeline(pipeline)
  renderPass.setBindGroup(0, bindGroup)
  renderPass.draw(3)
  renderPass.end()

  if (submit) {
    device.queue.submit([encoder.finish()])
  }
}
