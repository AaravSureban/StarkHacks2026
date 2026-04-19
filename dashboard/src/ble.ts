import type {
  Direction,
  HazardLevel,
  Mode,
  MotorZone,
  Pattern,
  TelemetryPayload,
  TelemetrySensorState,
} from './types'

const BLE_DEVICE_NAME = 'NavVest'
const BLE_SERVICE_UUID = '7b7e1000-7c6b-4b8f-9e2a-6b5f4f0a1000'
const BLE_TELEMETRY_SERVICE_UUID = '7b7e2000-7c6b-4b8f-9e2a-6b5f4f0a2000'
const BLE_TELEMETRY_CHAR_UUID = '7b7e1002-7c6b-4b8f-9e2a-6b5f4f0a1000'
const TELEMETRY_POLL_INTERVAL_MS = 400

const decoder = new TextDecoder()

export class NoTelemetryCharacteristicError extends Error {
  constructor() {
    super('Telemetry characteristic not found on the vest')
    this.name = 'NoTelemetryCharacteristicError'
  }
}

export interface BleSession {
  deviceName: string
  disconnect: () => Promise<void>
}

function parseMode(value: unknown): Mode {
  switch (value) {
    case 'manual':
    case 'awareness':
    case 'object_nav':
    case 'find_search':
    case 'gps_nav':
      return value
    default:
      return 'manual'
  }
}

function parsePattern(value: unknown): Pattern {
  switch (value) {
    case 'steady':
    case 'slow_pulse':
    case 'fast_pulse':
    case 'none':
      return value
    default:
      return 'none'
  }
}

function parseDirection(value: unknown): Direction {
  switch (value) {
    case 'left':
    case 'front':
    case 'right':
    case 'back':
    case 'front-left':
    case 'front-right':
    case 'back-left':
    case 'back-right':
    case 'none':
      return value
    default:
      return 'none'
  }
}

function parseHazardLevel(value: unknown): HazardLevel {
  switch (value) {
    case 'SAFE':
    case 'CAUTION':
    case 'DANGER':
      return value
    default:
      return 'SAFE'
  }
}

function parseMotorMask(value: unknown): MotorZone[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (entry): entry is MotorZone =>
      entry === 'front' || entry === 'back' || entry === 'left' || entry === 'right',
  )
}

function parseSensor(value: unknown): TelemetrySensorState {
  const sensor = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

  return {
    valid: sensor.valid === true,
    distanceCm: typeof sensor.distanceCm === 'number' ? sensor.distanceCm : 0,
    level: parseHazardLevel(sensor.level),
  }
}

function decodeValue(dataView: DataView | null): string {
  if (!dataView) {
    return ''
  }

  return decoder.decode(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength))
}

function parseModeByte(value: number): Mode {
  switch (value) {
    case 0:
      return 'manual'
    case 1:
      return 'awareness'
    case 2:
      return 'object_nav'
    case 3:
      return 'find_search'
    case 4:
      return 'gps_nav'
    default:
      return 'manual'
  }
}

function parsePatternByte(value: number): Pattern {
  switch (value) {
    case 0:
      return 'steady'
    case 1:
      return 'slow_pulse'
    case 2:
      return 'fast_pulse'
    case 3:
    default:
      return 'none'
  }
}

function parseDirectionByte(value: number): Direction {
  switch (value) {
    case 0:
      return 'left'
    case 1:
      return 'front'
    case 2:
      return 'right'
    case 3:
      return 'back'
    case 4:
      return 'front-left'
    case 5:
      return 'front-right'
    case 6:
      return 'back-left'
    case 7:
      return 'back-right'
    case 8:
    default:
      return 'none'
  }
}

function parseSourceByte(value: number): string {
  switch (value) {
    case 0:
      return 'idle'
    case 1:
      return 'ultrasonic_caution'
    case 2:
      return 'ultrasonic_danger'
    case 3:
      return 'iphone'
    default:
      return 'idle'
  }
}

function motorMaskToZones(mask: number): MotorZone[] {
  const zones: MotorZone[] = []
  if ((mask & 0x02) !== 0) {
    zones.push('front')
  }
  if ((mask & 0x01) !== 0) {
    zones.push('back')
  }
  if ((mask & 0x04) !== 0) {
    zones.push('left')
  }
  if ((mask & 0x08) !== 0) {
    zones.push('right')
  }
  return zones
}

function parseBinaryTelemetry(dataView: DataView): TelemetryPayload {
  if (dataView.byteLength < 20) {
    throw new Error('Telemetry packet too short')
  }

  const version = dataView.getUint8(0)
  const mode = parseModeByte(dataView.getUint8(2))
  const flags = dataView.getUint8(3)
  const bleConnected = (flags & 0x01) !== 0
  const commandActive = (flags & 0x02) !== 0
  const backValid = (flags & 0x04) !== 0
  const leftValid = (flags & 0x08) !== 0
  const rightValid = (flags & 0x10) !== 0

  return {
    version,
    mode,
    bleConnected,
    hazards: {
      back: {
        valid: backValid,
        distanceCm: dataView.getUint8(4),
        level: parseHazardLevel(dataView.getUint8(7) === 2 ? 'DANGER' : dataView.getUint8(7) === 1 ? 'CAUTION' : 'SAFE'),
      },
      left: {
        valid: leftValid,
        distanceCm: dataView.getUint8(5),
        level: parseHazardLevel(dataView.getUint8(8) === 2 ? 'DANGER' : dataView.getUint8(8) === 1 ? 'CAUTION' : 'SAFE'),
      },
      right: {
        valid: rightValid,
        distanceCm: dataView.getUint8(6),
        level: parseHazardLevel(dataView.getUint8(9) === 2 ? 'DANGER' : dataView.getUint8(9) === 1 ? 'CAUTION' : 'SAFE'),
      },
    },
    output: {
      source: parseSourceByte(dataView.getUint8(13)),
      motorMask: motorMaskToZones(dataView.getUint8(10)),
      intensity: dataView.getUint8(11),
      pattern: parsePatternByte(dataView.getUint8(12)),
    },
    command: {
      active: commandActive,
      direction: parseDirectionByte(dataView.getUint8(14)),
      pattern: parsePatternByte(dataView.getUint8(15)),
      intensity: dataView.getUint8(16),
      ttlRemainingMs: dataView.getUint8(17) * 100,
    },
    uptimeMs: dataView.getUint16(18, true) * 1000,
  }
}

function normalizeTelemetry(value: unknown): TelemetryPayload {
  const payload = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const hazards =
    typeof payload.hazards === 'object' && payload.hazards !== null
      ? (payload.hazards as Record<string, unknown>)
      : {}
  const output =
    typeof payload.output === 'object' && payload.output !== null
      ? (payload.output as Record<string, unknown>)
      : {}
  const command =
    typeof payload.command === 'object' && payload.command !== null
      ? (payload.command as Record<string, unknown>)
      : {}

  return {
    version: typeof payload.version === 'number' ? payload.version : 1,
    mode: parseMode(payload.mode),
    bleConnected: payload.bleConnected === true,
    hazards: {
      back: parseSensor(hazards.back),
      left: parseSensor(hazards.left),
      right: parseSensor(hazards.right),
    },
    output: {
      source: typeof output.source === 'string' ? output.source : 'idle',
      motorMask: parseMotorMask(output.motorMask),
      intensity: typeof output.intensity === 'number' ? output.intensity : 0,
      pattern: parsePattern(output.pattern),
    },
    command: {
      active: command.active === true,
      direction: parseDirection(command.direction),
      pattern: parsePattern(command.pattern),
      intensity: typeof command.intensity === 'number' ? command.intensity : 0,
      ttlRemainingMs: typeof command.ttlRemainingMs === 'number' ? command.ttlRemainingMs : 0,
    },
    uptimeMs: typeof payload.uptimeMs === 'number' ? payload.uptimeMs : 0,
  }
}

function parseTelemetryJson(raw: string): TelemetryPayload {
  return normalizeTelemetry(JSON.parse(raw))
}

function parseTelemetryPacket(dataView: DataView): TelemetryPayload {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)
  if (bytes.length > 0 && bytes[0] === 123) {
    return parseTelemetryJson(decodeValue(dataView))
  }

  return parseBinaryTelemetry(dataView)
}

export async function connectToVest(
  onTelemetry: (payload: TelemetryPayload) => void,
  onDisconnect: () => void,
): Promise<BleSession> {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser')
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: BLE_DEVICE_NAME, services: [BLE_SERVICE_UUID] }],
    optionalServices: [BLE_SERVICE_UUID, BLE_TELEMETRY_SERVICE_UUID],
  })

  const server = await device.gatt?.connect()
  if (!server) {
    throw new Error('Could not connect to the NavVest GATT server')
  }

  const telemetryService = await server.getPrimaryService(BLE_TELEMETRY_SERVICE_UUID)
  let telemetryCharacteristic: BluetoothRemoteGATTCharacteristic

  try {
    telemetryCharacteristic = await telemetryService.getCharacteristic(BLE_TELEMETRY_CHAR_UUID)
  } catch {
    device.gatt?.disconnect()
    throw new NoTelemetryCharacteristicError()
  }

  const handleDisconnect = () => {
    onDisconnect()
  }

  device.addEventListener('gattserverdisconnected', handleDisconnect)

  let pollTimer: number | null = null
  let pollInFlight = false

  const readAndEmitTelemetry = async (source: 'initial' | 'poll') => {
    const dataView = await telemetryCharacteristic.readValue()
    const bytes = Array.from(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength))
    console.log(`[NavVest] ${source} telemetry read bytes:`, bytes)
    onTelemetry(parseTelemetryPacket(dataView))
  }

  const notifyHandler = async (event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic | null
    const dataView = characteristic?.value ?? null
    if (!dataView || dataView.byteLength === 0) {
      console.log('[NavVest] empty telemetry notification')
      return
    }

    try {
      const bytes = Array.from(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength))
      console.log('[NavVest] telemetry notification bytes:', bytes)
      onTelemetry(parseTelemetryPacket(dataView))
    } catch {
      // Ignore malformed packets.
      console.warn('[NavVest] failed to parse telemetry notification')
    }
  }

  await readAndEmitTelemetry('initial')

  await telemetryCharacteristic.startNotifications()
  telemetryCharacteristic.addEventListener('characteristicvaluechanged', notifyHandler)

  pollTimer = window.setInterval(async () => {
    if (pollInFlight || !device.gatt?.connected) {
      return
    }

    pollInFlight = true
    try {
      await readAndEmitTelemetry('poll')
    } catch (error) {
      console.warn('[NavVest] polling read failed', error)
    } finally {
      pollInFlight = false
    }
  }, TELEMETRY_POLL_INTERVAL_MS)

  return {
    deviceName: device.name ?? BLE_DEVICE_NAME,
    disconnect: async () => {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
      telemetryCharacteristic.removeEventListener('characteristicvaluechanged', notifyHandler)
      device.removeEventListener('gattserverdisconnected', handleDisconnect)
      if (device.gatt?.connected) {
        device.gatt.disconnect()
      }
    },
  }
}
