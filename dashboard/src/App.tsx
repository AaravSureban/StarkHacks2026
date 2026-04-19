import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import { NoTelemetryCharacteristicError, connectToVest, type BleSession } from './ble'
import { createDemoTelemetry } from './demo'
import type {
  ConnectionState,
  EventItem,
  HazardLevel,
  MotorZone,
  TelemetryPayload,
  TelemetrySensorState,
} from './types'
import { SENSOR_SIDES } from './types'

function formatMode(mode: string) {
  return mode
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatSource(source: string) {
  switch (source) {
    case 'ultrasonic_danger':
      return 'Ultrasonic danger response'
    case 'ultrasonic_caution':
      return 'Ultrasonic caution response'
    case 'iphone':
      return 'Phone guidance command'
    case 'idle':
      return 'No haptic output'
    default:
      return source.replace(/_/g, ' ')
  }
}

function formatPattern(pattern: string) {
  return pattern.replace(/_/g, ' ')
}

function formatDistance(sensor: TelemetrySensorState) {
  if (!sensor.valid) {
    return 'No echo'
  }

  return `${Math.round(sensor.distanceCm)} cm`
}

function describeMotorMask(motorMask: MotorZone[]) {
  if (motorMask.length === 0) {
    return 'None'
  }

  return motorMask
    .map((zone) => zone.charAt(0).toUpperCase() + zone.slice(1))
    .join(' + ')
}

function hazardRank(level: HazardLevel) {
  switch (level) {
    case 'DANGER':
      return 2
    case 'CAUTION':
      return 1
    case 'SAFE':
    default:
      return 0
  }
}

function findPriorityHazard(telemetry: TelemetryPayload) {
  return SENSOR_SIDES.reduce(
    (best, side) => {
      const sensor = telemetry.hazards[side]
      if (hazardRank(sensor.level) > hazardRank(best.level)) {
        return { side, level: sensor.level }
      }
      return best
    },
    { side: 'back', level: 'SAFE' as HazardLevel },
  )
}

function freshnessLabel(lastUpdateMs: number | null, nowMs: number) {
  if (lastUpdateMs === null) {
    return 'Waiting'
  }

  const delta = Math.max(0, nowMs - lastUpdateMs)
  if (delta < 700) {
    return 'Live'
  }
  if (delta < 2500) {
    return `${(delta / 1000).toFixed(1)}s ago`
  }
  return 'Stale'
}

function makeTimestampLabel(date: Date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null)
  const [lastUpdateMs, setLastUpdateMs] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [events, setEvents] = useState<EventItem[]>([])
  const [deviceName, setDeviceName] = useState('NavVest')
  const [statusMessage, setStatusMessage] = useState('Ready for a live vest connection')

  const sessionRef = useRef<BleSession | null>(null)
  const demoStartedAtRef = useRef<number | null>(null)
  const previousTelemetryRef = useRef<TelemetryPayload | null>(null)
  const eventIdRef = useRef(0)
  const hasSeenTelemetryRef = useRef(false)

  const pushEvent = (title: string, detail: string) => {
    const timestamp = new Date()
    setEvents((current) =>
      [
        {
          id: ++eventIdRef.current,
          title,
          detail,
          timestampLabel: makeTimestampLabel(timestamp),
        },
        ...current,
      ].slice(0, 5),
    )
  }

  const absorbTelemetry = (nextTelemetry: TelemetryPayload, transport: ConnectionState) => {
    const previousTelemetry = previousTelemetryRef.current
    hasSeenTelemetryRef.current = true

    setTelemetry(nextTelemetry)
    setLastUpdateMs(Date.now())

    if (!previousTelemetry) {
      pushEvent('Feed online', `${formatMode(nextTelemetry.mode)} data stream active`)
    } else {
      if (previousTelemetry.mode !== nextTelemetry.mode) {
        pushEvent('Mode changed', `${formatMode(previousTelemetry.mode)} -> ${formatMode(nextTelemetry.mode)}`)
      }

      for (const side of SENSOR_SIDES) {
        const previousLevel = previousTelemetry.hazards[side].level
        const nextLevel = nextTelemetry.hazards[side].level
        if (previousLevel !== nextLevel) {
          pushEvent(`${side.toUpperCase()} sensor`, `${previousLevel} -> ${nextLevel}`)
        }
      }

      const previousMotors = previousTelemetry.output.motorMask.join(',')
      const nextMotors = nextTelemetry.output.motorMask.join(',')
      if (
        previousTelemetry.output.source !== nextTelemetry.output.source ||
        previousMotors !== nextMotors ||
        previousTelemetry.output.pattern !== nextTelemetry.output.pattern
      ) {
        pushEvent(
          'Output changed',
          `${formatSource(nextTelemetry.output.source)} on ${describeMotorMask(nextTelemetry.output.motorMask)}`,
        )
      }
    }

    previousTelemetryRef.current = nextTelemetry
    setConnectionState(transport)
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, 200)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (connectionState !== 'demo') {
      return
    }

    if (demoStartedAtRef.current === null) {
      demoStartedAtRef.current = performance.now()
    }

    const tick = () => {
      const elapsedMs = performance.now() - (demoStartedAtRef.current ?? performance.now())
      absorbTelemetry(createDemoTelemetry(elapsedMs), 'demo')
    }

    tick()
    const interval = window.setInterval(tick, 250)

    return () => {
      window.clearInterval(interval)
    }
  }, [connectionState])

  const handleDisconnect = async () => {
    const session = sessionRef.current
    sessionRef.current = null

    if (session) {
      await session.disconnect()
    }

    setConnectionState('disconnected')
    setStatusMessage('Disconnected. Last known vest state is still visible.')
    pushEvent('Disconnected', 'Vest connection closed')
  }

  const handleConnect = async () => {
    if (connectionState === 'connecting') {
      return
    }

    if (sessionRef.current) {
      await handleDisconnect()
    }

    demoStartedAtRef.current = null
    hasSeenTelemetryRef.current = false
    previousTelemetryRef.current = null
    setTelemetry(null)
    setLastUpdateMs(null)
    setConnectionState('connecting')
    setStatusMessage('Opening Bluetooth device picker...')

    try {
      const session = await connectToVest(
        (payload) => {
          setDeviceName(sessionRef.current?.deviceName ?? 'NavVest')
          setStatusMessage('Live telemetry streaming from the vest')
          absorbTelemetry(payload, 'live')
        },
        () => {
          sessionRef.current = null
          setConnectionState('disconnected')
          setStatusMessage('Connection lost. Last known vest data is frozen for reference.')
          pushEvent('Link lost', 'Bluetooth disconnected unexpectedly')
        },
      )

      sessionRef.current = session
      setDeviceName(session.deviceName)
      setConnectionState('live')
      setStatusMessage('Connected. Waiting for the first telemetry packet...')
      pushEvent('Connected', `Live Bluetooth link established with ${session.deviceName}`)

      window.setTimeout(() => {
        if (sessionRef.current === session && !hasSeenTelemetryRef.current) {
          setStatusMessage(
            'Bluetooth connected, but no telemetry has arrived yet. Make sure the latest NavVest.ino is flashed and Serial Monitor shows BLE: connected.',
          )
          pushEvent('No telemetry yet', 'The vest paired, but the dashboard has not received a telemetry packet')
        }
      }, 3000)
    } catch (error) {
      sessionRef.current = null

      if (error instanceof NoTelemetryCharacteristicError) {
        setStatusMessage('Vest has no telemetry characteristic yet. Showing Demo Mode instead.')
        pushEvent('Demo fallback', 'Telemetry characteristic missing on the current firmware')
        demoStartedAtRef.current = performance.now()
        setConnectionState('demo')
        return
      }

      const message = error instanceof Error ? error.message : 'Bluetooth connection failed'
      setConnectionState('disconnected')
      setStatusMessage(message)
      pushEvent('Connection failed', message)
    }
  }

  const handleDemoMode = async () => {
    if (sessionRef.current) {
      await handleDisconnect()
    }

    demoStartedAtRef.current = performance.now()
    setStatusMessage('Demo Mode is generating representative vest activity')
    pushEvent('Demo Mode', 'Running the judge experience without live hardware')
    setConnectionState('demo')
  }

  const activeTelemetry = telemetry
  const freshness = freshnessLabel(lastUpdateMs, nowMs)
  const hazardHeadline = activeTelemetry ? findPriorityHazard(activeTelemetry) : null
  const ultrasonicEnabled = activeTelemetry?.mode === 'awareness'

  const heroState = useMemo(() => {
    const motorMask = new Set(activeTelemetry?.output.motorMask ?? [])
    return {
      front: motorMask.has('front'),
      back: motorMask.has('back'),
      left: motorMask.has('left'),
      right: motorMask.has('right'),
    }
  }, [activeTelemetry])

  return (
    <main className={`dashboard-shell connection-${connectionState}`}>
      <section className="topbar panel">
        <div className="brand-block">
          <p className="eyebrow">NavVest Judge Dashboard</p>
          <h1>Live hardware story, one screen.</h1>
          <p className="subtitle">
            A local Chrome or Edge dashboard that turns BLE telemetry into a clear judge-facing view of
            the vest&apos;s sensors and haptic responses.
          </p>
        </div>

        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">Connection</span>
            <strong className={`status-value state-${connectionState}`}>{connectionState}</strong>
            <span className="status-detail">{deviceName}</span>
          </div>
          <div className="status-card">
            <span className="status-label">Mode</span>
            <strong className="status-value">{activeTelemetry ? formatMode(activeTelemetry.mode) : 'Unknown'}</strong>
            <span className="status-detail">
              {ultrasonicEnabled ? 'Ultrasonic awareness enabled' : 'Ultrasonic alerts muted'}
            </span>
          </div>
          <div className="status-card">
            <span className="status-label">Freshness</span>
            <strong className="status-value">{freshness}</strong>
            <span className="status-detail">{statusMessage}</span>
          </div>
          <div className="status-actions">
            <button className="action-button primary" onClick={handleConnect} disabled={connectionState === 'connecting'}>
              {connectionState === 'live' ? 'Reconnect Vest' : 'Connect Vest'}
            </button>
            <button className="action-button" onClick={handleDemoMode}>
              Demo Mode
            </button>
            <button className="action-button muted" onClick={handleDisconnect} disabled={!sessionRef.current}>
              Disconnect
            </button>
          </div>
        </div>
      </section>

      <section className="main-grid">
        <section className="sensor-column">
          {SENSOR_SIDES.map((side) => {
            const sensor = activeTelemetry?.hazards[side] ?? { valid: false, distanceCm: 0, level: 'SAFE' as HazardLevel }
            const gaugeValue = sensor.valid ? Math.max(4, Math.min(100, ((400 - sensor.distanceCm) / 400) * 100)) : 4

            return (
              <article
                key={side}
                className={`panel sensor-card level-${sensor.level.toLowerCase()}`}
                style={{ '--gauge-fill': `${gaugeValue}%` } as CSSProperties}
              >
                <div className="sensor-header">
                  <div>
                    <p className="eyebrow">{side} sensor</p>
                    <h2>{formatDistance(sensor)}</h2>
                  </div>
                  <span className={`level-pill level-${sensor.level.toLowerCase()}`}>{sensor.level}</span>
                </div>
                <div className="sensor-meter" aria-hidden="true">
                  <div className="sensor-ring" />
                  <div className="sensor-core">
                    <span>{sensor.valid ? Math.round(sensor.distanceCm) : '--'}</span>
                    <small>{sensor.valid ? 'cm' : 'echo'}</small>
                  </div>
                </div>
                <p className="sensor-note">
                  {sensor.valid
                    ? `The ${side} ultrasonic sensor is currently reading ${Math.round(sensor.distanceCm)} centimeters.`
                    : `The ${side} ultrasonic sensor does not currently have a clean echo.`}
                </p>
              </article>
            )
          })}
        </section>

        <section className="hero-column panel">
          <div className="hero-copy">
            <p className="eyebrow">Vest activity</p>
            <div className="hero-summary">
              <h2>{activeTelemetry ? formatSource(activeTelemetry.output.source) : 'Waiting for signal'}</h2>
              <p>
                {hazardHeadline
                  ? `Strongest detected proximity signal: ${hazardHeadline.side} ${hazardHeadline.level.toLowerCase()}.`
                  : 'Connect the vest or run Demo Mode to populate the live hardware story.'}
              </p>
            </div>
          </div>

          <div className="vest-stage">
            <div className={`hazard-arc arc-left level-${(activeTelemetry?.hazards.left.level ?? 'SAFE').toLowerCase()}`} />
            <div className={`hazard-arc arc-back level-${(activeTelemetry?.hazards.back.level ?? 'SAFE').toLowerCase()}`} />
            <div className={`hazard-arc arc-right level-${(activeTelemetry?.hazards.right.level ?? 'SAFE').toLowerCase()}`} />

            <div className="vest-shell-body">
              <div className={`motor-zone motor-front ${heroState.front ? `pattern-${activeTelemetry?.output.pattern ?? 'none'} active` : ''}`}>
                FRONT
              </div>
              <div className={`motor-zone motor-left ${heroState.left ? `pattern-${activeTelemetry?.output.pattern ?? 'none'} active` : ''}`}>
                LEFT
              </div>
              <div className="vest-core">
                <span className="vest-title">{activeTelemetry ? formatMode(activeTelemetry.mode) : 'Offline'}</span>
                <strong>{activeTelemetry ? describeMotorMask(activeTelemetry.output.motorMask) : 'No motors'}</strong>
                <small>{activeTelemetry ? `${activeTelemetry.output.intensity}/255 intensity` : 'No telemetry yet'}</small>
              </div>
              <div className={`motor-zone motor-right ${heroState.right ? `pattern-${activeTelemetry?.output.pattern ?? 'none'} active` : ''}`}>
                RIGHT
              </div>
              <div className={`motor-zone motor-back ${heroState.back ? `pattern-${activeTelemetry?.output.pattern ?? 'none'} active` : ''}`}>
                BACK
              </div>
            </div>
          </div>
        </section>

        <section className="output-column">
          <article className="panel output-card">
            <p className="eyebrow">Current output</p>
            <h2>{activeTelemetry ? describeMotorMask(activeTelemetry.output.motorMask) : 'No live output'}</h2>
            <p className="output-description">
              {activeTelemetry
                ? `${formatSource(activeTelemetry.output.source)} with ${formatPattern(activeTelemetry.output.pattern)} pattern.`
                : 'The dashboard is ready, but it has not received a telemetry packet yet.'}
            </p>

            <div className="metric-grid">
              <div className="metric-card">
                <span className="metric-label">Pattern</span>
                <strong>{activeTelemetry ? formatPattern(activeTelemetry.output.pattern) : 'none'}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Intensity</span>
                <strong>{activeTelemetry ? activeTelemetry.output.intensity : 0}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">Phone command</span>
                <strong>{activeTelemetry?.command.active ? 'Active' : 'Idle'}</strong>
              </div>
              <div className="metric-card">
                <span className="metric-label">TTL remaining</span>
                <strong>{activeTelemetry ? `${activeTelemetry.command.ttlRemainingMs} ms` : '0 ms'}</strong>
              </div>
            </div>
          </article>

          <article className="panel mode-card">
            <p className="eyebrow">Interpretation</p>
            <ul className="mode-insights">
              <li>
                <span className="insight-label">Awareness gate</span>
                <span className="insight-value">{ultrasonicEnabled ? 'Hazards can drive motors' : 'Hazards are visual only'}</span>
              </li>
              <li>
                <span className="insight-label">BLE link</span>
                <span className="insight-value">{activeTelemetry?.bleConnected ? 'Vest is connected' : 'Vest is advertising or offline'}</span>
              </li>
              <li>
                <span className="insight-label">Uptime</span>
                <span className="insight-value">
                  {activeTelemetry ? `${Math.floor(activeTelemetry.uptimeMs / 1000)} s` : '--'}
                </span>
              </li>
            </ul>
          </article>
        </section>
      </section>

      <section className="event-strip panel">
        <div className="event-strip-header">
          <p className="eyebrow">Recent events</p>
          <span className="event-strip-note">The most recent five state changes stay visible for judges.</span>
        </div>
        <div className="event-list">
          {events.length > 0 ? (
            events.map((event) => (
              <article key={event.id} className="event-card">
                <span className="event-time">{event.timestampLabel}</span>
                <strong>{event.title}</strong>
                <p>{event.detail}</p>
              </article>
            ))
          ) : (
            <article className="event-card placeholder">
              <strong>No events yet</strong>
              <p>Connect the vest or start Demo Mode to begin the live hardware narrative.</p>
            </article>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
