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
const BLE_TELEMETRY_CHAR_UUID = '7b7e1002-7c6b-4b8f-9e2a-6b5f4f0a1000'

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

export async function connectToVest(
  onTelemetry: (payload: TelemetryPayload) => void,
  onDisconnect: () => void,
): Promise<BleSession> {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser')
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: BLE_DEVICE_NAME, services: [BLE_SERVICE_UUID] }],
    optionalServices: [BLE_SERVICE_UUID],
  })

  const server = await device.gatt?.connect()
  if (!server) {
    throw new Error('Could not connect to the NavVest GATT server')
  }

  const service = await server.getPrimaryService(BLE_SERVICE_UUID)
  let telemetryCharacteristic: BluetoothRemoteGATTCharacteristic

  try {
    telemetryCharacteristic = await service.getCharacteristic(BLE_TELEMETRY_CHAR_UUID)
  } catch {
    device.gatt?.disconnect()
    throw new NoTelemetryCharacteristicError()
  }

  const handleDisconnect = () => {
    onDisconnect()
  }

  device.addEventListener('gattserverdisconnected', handleDisconnect)

  const notifyHandler = async (event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic | null
    const raw = decodeValue(characteristic?.value ?? null)
    if (!raw) {
      console.log('[NavVest] empty telemetry notification')
      return
    }

    try {
      console.log('[NavVest] telemetry notification:', raw)
      onTelemetry(parseTelemetryJson(raw))
    } catch {
      // Ignore malformed packets.
      console.warn('[NavVest] failed to parse telemetry notification')
    }
  }

  const initialValue = await telemetryCharacteristic.readValue()
  const initialRaw = decodeValue(initialValue)
  console.log('[NavVest] initial telemetry read:', initialRaw)
  if (initialRaw) {
    onTelemetry(parseTelemetryJson(initialRaw))
  }

  await telemetryCharacteristic.startNotifications()
  telemetryCharacteristic.addEventListener('characteristicvaluechanged', notifyHandler)

  return {
    deviceName: device.name ?? BLE_DEVICE_NAME,
    disconnect: async () => {
      telemetryCharacteristic.removeEventListener('characteristicvaluechanged', notifyHandler)
      device.removeEventListener('gattserverdisconnected', handleDisconnect)
      if (device.gatt?.connected) {
        device.gatt.disconnect()
      }
    },
  }
}
