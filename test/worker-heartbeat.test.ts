import { afterEach, describe, expect, it, vi } from 'vitest'
import { startWorkerHeartbeat } from '../src/main/worker-client'
import type { MobileBridge } from '../src/main/mobile-bridge'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
const bridge = { workerCredentials: () => ({ fingerprint: 'a'.repeat(64), secret: 's'.repeat(48), urls: ['https://192.168.1.4:47821'] }) } as MobileBridge

describe('personal desktop registration and mesh recovery', () => {
  it('registers immediately even when private-network startup never finishes', async () => {
    const reconnectMesh = vi.fn(() => new Promise<void>(() => {}))
    const sendHeartbeat = vi.fn(async () => {})
    const stop = startWorkerHeartbeat({ bridge, workerId: 'home', workerName: 'Home', projects: () => [], sendHeartbeat, reconnectMesh })
    try {
      expect(reconnectMesh).toHaveBeenCalledOnce()
      expect(sendHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ pool: false, urls: ['https://192.168.1.4:47821'] }), undefined)
    } finally { stop() }
  })

  it('retries a failed mesh join and failed heartbeat; publishes changed addresses', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const reconnectMesh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const sendHeartbeat = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    let urls = ['https://192.168.1.4:47821']
    const changing = { workerCredentials: () => ({ fingerprint: 'a'.repeat(64), secret: 's'.repeat(48), urls }) } as MobileBridge
    const stop = startWorkerHeartbeat({ bridge: changing, workerId: 'home', workerName: 'Home', projects: () => [], sendHeartbeat, reconnectMesh })
    try {
      await vi.advanceTimersByTimeAsync(30_000)
      urls = ['https://192.168.2.8:47821', 'https://100.64.0.3:47821']
      await stop.beat()
      expect(reconnectMesh).toHaveBeenCalledTimes(3)
      expect(sendHeartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ urls }), undefined)
      stop()
      await vi.advanceTimersByTimeAsync(90_000)
      await stop.beat()
      expect(sendHeartbeat).toHaveBeenCalledTimes(3)
    } finally { stop() }
  })
})
