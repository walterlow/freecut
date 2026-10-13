import { describe, expect, it } from 'vite-plus/test'
import { listMcpTools, callMcpTool } from './mcp'
import { listEditorTools } from './registry'

describe('MCP tool mapping', () => {
  it('exposes every registry tool as an MCP descriptor with a JSON-Schema input', () => {
    const descriptors = listMcpTools()
    expect(descriptors.length).toBe(listEditorTools().length)

    for (const descriptor of descriptors) {
      expect(descriptor.name).toBeTruthy()
      expect(descriptor.description).toBeTruthy()
      expect(descriptor.inputSchema.type).toBe('object')
      expect(descriptor.annotations.title).toBeTruthy()
      expect(typeof descriptor.annotations.readOnlyHint).toBe('boolean')
      expect(typeof descriptor.annotations.destructiveHint).toBe('boolean')
    }
  })

  it('flags destructive vs read-only tools correctly', () => {
    const byName = new Map(listMcpTools().map((tool) => [tool.name, tool]))
    expect(byName.get('find_clips')?.annotations.readOnlyHint).toBe(true)
    expect(byName.get('delete_clips')?.annotations.destructiveHint).toBe(true)
    expect(byName.get('find_clips')?.annotations.destructiveHint).toBe(false)
  })

  it('returns a structured error for an unknown tool', async () => {
    const result = await callMcpTool('does_not_exist', {})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Unknown tool')
  })

  it('returns a structured error for invalid arguments', async () => {
    // set_speed requires a numeric `speed`; omitting it must fail validation
    // before any execution side effects.
    const result = await callMcpTool('set_speed', {})
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Invalid arguments')
  })
})
