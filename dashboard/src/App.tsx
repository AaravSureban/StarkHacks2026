import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import { connectTelemetryPoller, type TelemetryPollerSession } from './wifi'
import type { ConnectionState, EventItem, HazardLevel, MotorZone, TelemetryPayload, TelemetrySensorState } from './types'
import { SENSOR_SIDES } from './types'

const DEFAULT_BASE_URL = 'http://192.168.4.1'
const BASE_URL_STORAGE_KEY = 'navvest-base-url'

function formatMode(mode: string) {
  return mode
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatLabel(value: string) {
  return value
    .split(/[_-]/)
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

  return motorMask.map((zone) => zone.charAt(0).toUpperCase() + zone.slice(1)).join(' + ')
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
  const [statusMessage, setStatusMessage] = useState('Enter the ESP32 URL and start live Wi-Fi telemetry.')
  const [baseUrl, setBaseUrl] = useState(() => window.localStorage.getItem(BASE_URL_STORAGE_KEY) ?? DEFAULT_BASE_URL)

  const sessionRef = useRef<TelemetryPollerSession | null>(null)
  const previousTelemetryRef = useRef<TelemetryPayload | null>(null)
  const eventIdRef = useRef(0)

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

  const absorbTelemetry = (nextTelemetry: TelemetryPayload) => {
    const previousTelemetry = previousTelemetryRef.current

    setTelemetry(nextTelemetry)
    setLastUpdateMs(Date.now())
    setConnectionState('live')
    setStatusMessage(`Live telemetry streaming from ${baseUrl.replace(/\/$/, '')}/telemetry`)

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
    window.localStorage.setItem(BASE_URL_STORAGE_KEY, baseUrl)
  }, [baseUrl])

  const handleDisconnect = async () => {
    const session = sessionRef.current
    sessionRef.current = null

    if (session) {
      await session.disconnect()
    }

    setConnectionState('disconnected')
    setStatusMessage('Disconnected. Last known vest state is still visible.')
    pushEvent('Disconnected', 'Stopped polling the ESP32 telemetry endpoint')
  }

  const handleConnect = async () => {
    if (sessionRef.current) {
      await handleDisconnect()
    }

    setConnectionState('connecting')
    setStatusMessage(`Connecting to ${baseUrl.replace(/\/$/, '')}/telemetry ...`)
    previousTelemetryRef.current = null
    setLastUpdateMs(null)

    try {
      const session = await connectTelemetryPoller(
        baseUrl,
        (payload) => {
          absorbTelemetry(payload)
        },
        (message) => {
          if (telemetry) {
            setConnectionState('disconnected')
          }
          setStatusMessage(message)
        },
      )

      sessionRef.current = session
      pushEvent('Polling started', `Watching ${baseUrl.replace(/\/$/, '')}/telemetry`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect to the ESP32 telemetry endpoint'
      setConnectionState('disconnected')
      setStatusMessage(message)
      pushEvent('Connection failed', message)
    }
  }

  useEffect(() => {
    return () => {
      void sessionRef.current?.disconnect()
    }
  }, [])

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
          <h1>Live ESP32 Wi-Fi telemetry.</h1>
          <p className="subtitle">
            Join the ESP32&apos;s `NavVest` Wi-Fi network, keep the iPhone on BLE control, and mirror the vest over the
            telemetry endpoint.
          </p>
        </div>

        <div className="status-grid">
          <div className="status-card">
            <span className="status-label">Connection</span>
            <strong className={`status-value state-${connectionState}`}>{connectionState}</strong>
            <span className="status-detail">Polling the ESP32 directly over its own Wi-Fi access point.</span>
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
          <div className="status-card">
            <span className="status-label">Endpoint</span>
            <strong className="status-value endpoint-value">{baseUrl}</strong>
            <span className="status-detail">Default AP endpoint is `http://192.168.4.1/telemetry`.</span>
          </div>
          <div className="status-actions">
            <label className="endpoint-field">
              <span>ESP32 URL</span>
              <input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://192.168.4.1"
                spellCheck={false}
              />
            </label>
            <div className="action-row">
              <button className="action-button primary" onClick={handleConnect} disabled={connectionState === 'connecting'}>
                {sessionRef.current ? 'Reconnect' : 'Connect'}
              </button>
              <button className="action-button muted" onClick={handleDisconnect} disabled={!sessionRef.current}>
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="main-grid">
        <section className="sensor-column">
          {SENSOR_SIDES.map((side) => {
            const sensor = activeTelemetry?.hazards[side] ?? { valid: false, distanceCm: 0, level: 'SAFE' as HazardLevel }
            const gaugeValue = sensor.valid ? Math.max(8, Math.min(100, ((400 - sensor.distanceCm) / 400) * 100)) : 8

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
                    ? `The ${side} sensor is currently reading ${Math.round(sensor.distanceCm)} centimeters.`
                    : `The ${side} sensor does not currently have a clean echo.`}
                </p>
              </article>
            )
          })}
        </section>

        <section className="hero-column panel">
          <div className="hero-copy">
            <p className="eyebrow">Vest activity</p>
            <div className="hero-summary">
              <h2>{activeTelemetry ? formatSource(activeTelemetry.output.source) : 'Waiting for telemetry'}</h2>
              <p>
                {hazardHeadline
                  ? `Strongest detected proximity signal: ${hazardHeadline.side} ${hazardHeadline.level.toLowerCase()}.`
                  : 'Connect to the ESP32 telemetry endpoint to begin the live hardware story.'}
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
                <strong>{activeTelemetry?.command.active ? formatLabel(activeTelemetry.command.direction) : 'Idle'}</strong>
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
                <span className="insight-value">{activeTelemetry?.bleConnected ? 'Phone link is active' : 'Phone link is idle'}</span>
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
          <span className="event-strip-note">The most recent five live telemetry changes stay visible for judges.</span>
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
              <p>Connect to the ESP32 telemetry URL to begin the live hardware narrative.</p>
            </article>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
