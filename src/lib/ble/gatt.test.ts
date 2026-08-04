import { describe, expect, it, vi } from 'vitest'
import { during, withTimeout, writeOrder, writeValue } from './gatt'

type Characteristic = BluetoothRemoteGATTCharacteristic

function characteristic(
  properties: { write: boolean; writeWithoutResponse: boolean },
  behaviour: { accepts: 'with-response' | 'without-response' | 'neither' },
): Characteristic {
  const fail = () => Promise.reject(new Error('GATT operation failed for unknown reason.'))
  return {
    properties,
    writeValueWithResponse:
      behaviour.accepts === 'with-response' ? vi.fn(async () => undefined) : vi.fn(fail),
    writeValueWithoutResponse:
      behaviour.accepts === 'without-response' ? vi.fn(async () => undefined) : vi.fn(fail),
  } as unknown as Characteristic
}

describe('writeOrder', () => {
  it('starts with the mode the characteristic declares', () => {
    expect(writeOrder({ write: false, writeWithoutResponse: true })[0]).toBe('without-response')
    expect(writeOrder({ write: true, writeWithoutResponse: false })[0]).toBe('with-response')
  })

  it('always keeps the other mode as a fallback', () => {
    // Declared properties and what the device will take are not the same thing.
    for (const properties of [
      { write: true, writeWithoutResponse: false },
      { write: false, writeWithoutResponse: true },
      { write: false, writeWithoutResponse: false },
    ]) {
      expect(writeOrder(properties)).toHaveLength(2)
    }
  })

  it('never repeats a mode', () => {
    const modes = writeOrder({ write: true, writeWithoutResponse: true })
    expect(new Set(modes).size).toBe(modes.length)
  })
})

describe('writeValue', () => {
  it('falls back when the declared mode is refused', async () => {
    // The Click case: declares write, only honours write-without-response.
    const ch = characteristic(
      { write: true, writeWithoutResponse: false },
      { accepts: 'without-response' },
    )
    await expect(writeValue(ch, new Uint8Array([1]))).resolves.toBeUndefined()
    expect(ch.writeValueWithResponse).toHaveBeenCalled()
    expect(ch.writeValueWithoutResponse).toHaveBeenCalled()
  })

  it('does not try the fallback when the first mode works', async () => {
    const ch = characteristic(
      { write: true, writeWithoutResponse: true },
      { accepts: 'with-response' },
    )
    await writeValue(ch, new Uint8Array([1]))
    expect(ch.writeValueWithoutResponse).not.toHaveBeenCalled()
  })

  it('reports the last failure when nothing is accepted', async () => {
    const ch = characteristic({ write: true, writeWithoutResponse: true }, { accepts: 'neither' })
    await expect(writeValue(ch, new Uint8Array([1]))).rejects.toThrow(/unknown reason/)
  })
})

describe('during', () => {
  it('says which step failed', async () => {
    await expect(
      during('Sending the RideOn handshake', () =>
        Promise.reject(new Error('GATT operation failed for unknown reason.')),
      ),
    ).rejects.toThrow('Sending the RideOn handshake: GATT operation failed for unknown reason.')
  })

  it('keeps the original error reachable', async () => {
    const original = new Error('boom')
    const thrown = await during('Step', () => Promise.reject(original)).catch((e: unknown) => e)
    expect((thrown as Error).cause).toBe(original)
  })

  it('gets out of the way when nothing fails', async () => {
    await expect(during('Step', () => Promise.resolve(7))).resolves.toBe(7)
  })
})

describe('withTimeout', () => {
  it('gives up on a promise that never settles', async () => {
    // A trainer that is switched off: gatt.connect() can hang rather than
    // reject, which would leave the row saying "connecting" forever.
    await expect(withTimeout(5, 'Reconnecting', new Promise(() => {}))).rejects.toThrow(
      /Reconnecting timed out after 5 ms/,
    )
  })

  it('passes a result straight through', async () => {
    await expect(withTimeout(1000, 'Reconnecting', Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('keeps the original rejection rather than reporting a timeout', async () => {
    await expect(
      withTimeout(1000, 'Reconnecting', Promise.reject(new Error('out of range'))),
    ).rejects.toThrow('out of range')
  })
})
