import type { HazardLevel, Pattern, TelemetryPayload } from './types'

function makeSensor(valid: boolean, distanceCm: number, level: HazardLevel) {
  return { valid, distanceCm, level }
}

export function createDemoTelemetry(elapsedMs: number): TelemetryPayload {
  const phase = Math.floor(elapsedMs / 7000) % 4
  const pulseOffset = Math.floor((elapsedMs % 1000) / 250) * 5
  const safeOutput = {
    source: 'idle',
    motorMask: [] as Array<'front' | 'back' | 'left' | 'right'>,
    intensity: 0,
    pattern: 'none' as Pattern,
  }

  switch (phase) {
    case 0:
      return {
        version: 1,
        mode: 'awareness',
        bleConnected: true,
        hazards: {
          back: makeSensor(true, 88 - pulseOffset, 'CAUTION'),
          left: makeSensor(true, 162, 'SAFE'),
          right: makeSensor(true, 146, 'SAFE'),
        },
        output: {
          source: 'ultrasonic_caution',
          motorMask: ['back'],
          intensity: 180,
          pattern: 'slow_pulse',
        },
        command: {
          active: false,
          direction: 'none',
          pattern: 'none',
          intensity: 0,
          ttlRemainingMs: 0,
        },
        uptimeMs: elapsedMs,
      }

    case 1:
      return {
        version: 1,
        mode: 'awareness',
        bleConnected: true,
        hazards: {
          back: makeSensor(true, 130, 'SAFE'),
          left: makeSensor(true, 39 + pulseOffset, 'DANGER'),
          right: makeSensor(true, 118, 'SAFE'),
        },
        output: {
          source: 'ultrasonic_danger',
          motorMask: ['left'],
          intensity: 255,
          pattern: 'fast_pulse',
        },
        command: {
          active: false,
          direction: 'none',
          pattern: 'none',
          intensity: 0,
          ttlRemainingMs: 0,
        },
        uptimeMs: elapsedMs,
      }

    case 2:
      return {
        version: 1,
        mode: 'find_search',
        bleConnected: true,
        hazards: {
          back: makeSensor(true, 42, 'DANGER'),
          left: makeSensor(true, 74, 'CAUTION'),
          right: makeSensor(true, 134, 'SAFE'),
        },
        output: safeOutput,
        command: {
          active: false,
          direction: 'none',
          pattern: 'none',
          intensity: 0,
          ttlRemainingMs: 0,
        },
        uptimeMs: elapsedMs,
      }

    default:
      return {
        version: 1,
        mode: 'object_nav',
        bleConnected: true,
        hazards: {
          back: makeSensor(true, 170, 'SAFE'),
          left: makeSensor(true, 150, 'SAFE'),
          right: makeSensor(true, 155, 'SAFE'),
        },
        output: {
          source: 'iphone',
          motorMask: ['front', 'right'],
          intensity: 210,
          pattern: 'steady',
        },
        command: {
          active: true,
          direction: 'front-right',
          pattern: 'steady',
          intensity: 210,
          ttlRemainingMs: 600,
        },
        uptimeMs: elapsedMs,
      }
  }
}
