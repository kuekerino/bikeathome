import { describe, expect, it } from 'vitest'
import { clickRequest, trainerRequest, WAHOO_SERVICE } from './discovery'
import { CYCLING_POWER_SERVICE, FTMS_SERVICE } from './ftms'
import { ZWIFT_SERVICE_V2 } from './zwiftClickProtocol'

function advertisedServices(options: RequestDeviceOptions): unknown[] {
  const filters = 'filters' in options ? (options.filters ?? []) : []
  return filters.flatMap((f) => f.services ?? [])
}

describe('trainerRequest', () => {
  it('matches trainers that advertise Cycling Power but not FTMS', () => {
    // The Wahoo case, and the reason an FTMS-only filter finds nothing: the
    // chooser can only see the advertising packet.
    expect(advertisedServices(trainerRequest())).toContain(CYCLING_POWER_SERVICE)
    expect(advertisedServices(trainerRequest())).toContain(WAHOO_SERVICE)
  })

  it('still matches trainers that do advertise FTMS', () => {
    expect(advertisedServices(trainerRequest())).toContain(FTMS_SERVICE)
  })

  it('keeps FTMS usable however the device was matched', () => {
    // Matching on Cycling Power does not grant access to FTMS; only being
    // named in optionalServices does.
    for (const options of [trainerRequest(), trainerRequest(true)]) {
      expect(options.optionalServices).toContain(FTMS_SERVICE)
    }
  })

  it('drops the filters entirely when showing everything', () => {
    const options = trainerRequest(true)
    expect(options).toMatchObject({ acceptAllDevices: true })
    // Chrome rejects a request carrying both, so this must not merely be empty.
    expect(options).not.toHaveProperty('filters')
  })
})

describe('clickRequest', () => {
  it('matches a v2 Click advertising only its newer service', () => {
    expect(advertisedServices(clickRequest())).toContain(ZWIFT_SERVICE_V2)
  })

  it('keeps both Click services usable when showing everything', () => {
    expect(clickRequest(true).optionalServices).toContain(ZWIFT_SERVICE_V2)
  })
})
