import { vi } from 'vite-plus/test'
import './logger-test-mocks'

export const handlesMocks = {
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}

vi.doMock('@/infrastructure/storage/handles-db', () => handlesMocks)
