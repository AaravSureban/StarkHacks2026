# VisionVest ESP32 Firmware - Codex Prompt

You are an embedded systems engineer. Write complete ESP32-S3 Arduino firmware for a wearable assistive navigation vest called VisionVest. This must compile and run correctly first try with no placeholders or TODOs.

---

## Hardware

**Board: ESP32-S3-DevKitC-1 v1.1**

---

## Pin Definitions

### Motor Pins (via 2x L298N H-bridges)

#### L298N #1 - Back + Front
| Pin | GPIO |
|-----|------|
| BACK_ENA (PWM) | GPIO4 |
| BACK_IN1 | GPIO5 |
| BACK_IN2 | GPIO6 |
| FRONT_IN3 | GPIO7 |
| FRONT_IN4 | GPIO15 |
| FRONT_ENB (PWM) | GPIO16 |

#### L298N #2 - Left + Right
| Pin | GPIO |
|-----|------|
| LEFT_ENA (PWM) | GPIO18 |
| LEFT_IN1 | GPIO8 |
| LEFT_IN2 | GPIO3 |
| RIGHT_IN3 | GPIO46 |
| RIGHT_IN4 | GPIO9 |
| RIGHT_ENB (PWM) | GPIO10 |

### Ultrasonic Sensor Pins (HC-SR04)
| Sensor | TRIG | ECHO |
|--------|------|------|
| Back | GPIO41 | GPIO42 |
| Left | GPIO39 | GPIO40 |
| Right | GPIO21 | GPIO47 |

> There is NO front ultrasonic sensor. The iPhone camera and LiDAR handle front perception.

### Onboard RGB LED
- **Pin:** GPIO38 (NeoPixel, use Adafruit NeoPixel library)

| Color | Meaning |
|-------|---------|
| Blue | BLE advertising |
| Green | BLE connected, all clear |
| Yellow | Caution detected |
| Red | Danger detected |

---

## Libraries

- **NimBLE-Arduino** - BLE
- **ArduinoJson** - JSON parsing
- **Adafruit NeoPixel** - RGB LED
- **ESP32 LEDC** - PWM motor control

---

## BLE Configuration

| Field | Value |
|-------|-------|
| Device name | `VisionVest` |
| Service UUID | `7B7E1000-7C6B-4B8F-9E2A-6B5F4F0A1000` |
| Command Characteristic UUID | `7B7E1001-7C6B-4B8F-9E2A-6B5F4F0A1000` |
| Characteristic properties | WRITE and WRITE WITHOUT RESPONSE |
| Payload format | UTF-8 JSON string |
| ESP32 role | BLE peripheral / server |
| iPhone role | BLE central / client |

---

## JSON Command Format

The iPhone sends commands in this format:

```json
{
  "mode": "object_nav",
  "direction": "front-left",
  "intensity": 180,
  "pattern": "steady",
  "priority": 2,
  "ttlMs": 300,
  "confidence": 0.84,
  "distance": 1.25,
  "seq": 42
}
```

### Field Definitions

| Field | Type | Valid Values |
|-------|------|-------------|
| mode | string | `manual`, `awareness`, `object_nav`, `find_search`, `gps_nav` |
| direction | string | `left`, `front`, `right`, `back`, `front-left`, `front-right`, `back-left`, `back-right`, `none` |
| intensity | int | 0-255 |
| pattern | string | `steady`, `slow_pulse`, `fast_pulse`, `none` |
| priority | int | 0-3 |
| ttlMs | int | 1-1000 |
| confidence | float | 0.0-1.0 |
| distance | float or null | >= 0.0 or null |
| seq | int | incrementing, reject duplicates |

---

## Enums

```cpp
enum Mode {
  MANUAL,
  AWARENESS,
  OBJECT_NAV,
  FIND_SEARCH,
  GPS_NAV
};

enum Direction {
  DIR_LEFT,
  DIR_FRONT,
  DIR_RIGHT,
  DIR_BACK,
  DIR_FRONT_LEFT,
  DIR_FRONT_RIGHT,
  DIR_BACK_LEFT,
  DIR_BACK_RIGHT,
  DIR_NONE
};

enum Pattern {
  PATTERN_STEADY,
  PATTERN_SLOW_PULSE,
  PATTERN_FAST_PULSE,
  PATTERN_NONE
};

enum HazardLevel {
  SAFE,
  CAUTION,
  DANGER
};
```

---

## Structs

```cpp
struct VestCommand {
  Mode mode;
  Direction direction;
  uint8_t intensity;
  Pattern pattern;
  uint8_t priority;
  uint16_t ttlMs;
  float confidence;
  bool hasDistance;
  float distanceMeters;
  uint32_t seq;
  uint32_t receivedAtMs;
  uint32_t expiresAtMs;
};

struct HazardState {
  HazardLevel back;   // has ultrasonic sensor
  HazardLevel left;   // has ultrasonic sensor
  HazardLevel right;  // has ultrasonic sensor
  // NOTE: no front ultrasonic - iPhone camera/LiDAR handles front
  float backCm;
  float leftCm;
  float rightCm;
};

struct HapticOutput {
  Direction direction;
  uint8_t intensity;
  Pattern pattern;
  uint8_t priority;
  const char* source; // "ultrasonic_danger", "ultrasonic_caution", "iphone", "idle"
};
```

---

## Validation Rules

Reject the command if any of the following are true:

- `mode` is not a known value
- `direction` is not a known value
- `intensity` is outside 0-255
- `pattern` is not a known value
- `priority` is outside 0-3
- `ttlMs` is <= 0 or > 1000
- `confidence` is outside 0.0-1.0
- `distance` is negative (null is allowed)
- `seq` is a duplicate of the last accepted seq (reset allowed after reconnect)

On rejection:
- Keep previous valid command until its own TTL expires
- Log the rejection reason to Serial
- Do not crash

---

## Ultrasonic Sensor Module

- Read all 3 sensors (back, left, right) non-blocking using `millis()`
- Convert echo pulse timing to distance in cm
- Use 5-sample moving average to filter noise
- Ignore readings of 0 or > 400 cm as invalid

### Hazard Thresholds
| Level | Distance |
|-------|----------|
| DANGER | <= 50 cm |
| CAUTION | <= 100 cm |
| SAFE | > 100 cm |

### Important
- There is **NO front ultrasonic sensor** - the iPhone camera and LiDAR handle front perception
- Back ultrasonic can override back motor
- Left ultrasonic can override left motor
- Right ultrasonic can override right motor
- Front motor can **only** be triggered by iPhone commands, including diagonal front directions
- Diagonal directions are iPhone-only outputs and are never produced by ultrasonic overrides

---

## Arbitration Engine

Priority order (highest to lowest):

1. Ultrasonic DANGER (back first, then left, then right)
2. Ultrasonic CAUTION (back first, then left, then right)
3. Active valid iPhone command
4. Idle - all motors off

### Ultrasonic Override Outputs
| Level | Intensity | Pattern |
|-------|-----------|---------|
| DANGER | 255 | PATTERN_FAST_PULSE |
| CAUTION | 180 | PATTERN_SLOW_PULSE |

---

## Haptic Motor Driver

### LEDC PWM Settings
| Setting | Value |
|---------|-------|
| Frequency | 5000 Hz |
| Resolution | 8 bit |
| Channels | 4 (one per motor) |

### Direction to Motor Mapping
| Direction | Motor |
|-----------|-------|
| DIR_LEFT | LEFT_ENA / LEFT_IN1 / LEFT_IN2 |
| DIR_FRONT | FRONT_ENB / FRONT_IN3 / FRONT_IN4 |
| DIR_RIGHT | RIGHT_ENB / RIGHT_IN3 / RIGHT_IN4 |
| DIR_BACK | BACK_ENA / BACK_IN1 / BACK_IN2 |
| DIR_FRONT_LEFT | FRONT + LEFT together |
| DIR_FRONT_RIGHT | FRONT + RIGHT together |
| DIR_BACK_LEFT | BACK + LEFT together |
| DIR_BACK_RIGHT | BACK + RIGHT together |
| DIR_NONE | All motors off |

### Pattern Timing (use millis(), never delay())
| Pattern | Behavior |
|---------|----------|
| PATTERN_STEADY | Continuous at given intensity |
| PATTERN_SLOW_PULSE | 500 ms on, 500 ms off |
| PATTERN_FAST_PULSE | 150 ms on, 150 ms off |
| PATTERN_NONE | All motors off |

### Motor Rules
- Turn ALL motors off before activating any new motor set
- Cardinal directions activate exactly one motor
- Diagonal iPhone directions activate exactly two motors: the paired cardinal motors
- Ultrasonic overrides always activate exactly one motor
- All motors off on startup
- All motors off when idle

---

## TTL and Watchdog Behavior

- Every loop iteration check if active iPhone command has expired using `millis()`
- If expired, clear it immediately
- On BLE disconnect, let active command expire naturally via TTL - do not force clear
- Do not keep motors running after TTL expires with no new command arriving

---

## Main Loop Structure

The loop must be fully non-blocking. No `delay()` calls anywhere in the main loop.

```
setup():
  initSerial(115200)
  initNeoPixel()
  initMotorPins()
  initLEDC()
  initUltrasonics()
  initBLE()
  clearActiveCommand()

loop():
  now = millis()
  updateUltrasonics(now)
  expireCommandIfNeeded(now)
  hazardState = getHazardState()
  activeCmd = getActiveCommand()
  output = arbitrate(hazardState, activeCmd)
  applyHapticOutput(output, now)
  updateNeoPixel(hazardState, bleConnected)
  printDebugLog(now)
```

---

## BLE Callback Rules

- Do **NOT** drive motors inside the BLE callback
- Only parse and validate JSON inside the callback, store result via a volatile flag
- Use a `volatile bool newCommandAvailable` flag to signal the main loop
- Main loop reads and processes the new command each iteration

---

## Serial Debug Logs

Print every 500 ms in this format:

```
BLE: connected | seq=42 | cmd: mode=object_nav dir=front-left intensity=180 ttl=300ms remaining=187ms
US: back=142cm SAFE | left=80cm CAUTION | right=200cm SAFE
OUTPUT: source=iphone dir=front-left intensity=180 pattern=steady
```

---

## Safety Requirements

- All motors off by default on startup
- All motors off if no valid command and no hazard
- All motors off if BLE disconnects and TTL expires
- Never crash on malformed JSON - wrap all parsing in error handling
- Never activate more than two motors simultaneously
- Two active motors are only allowed for the four diagonal iPhone directions
- Log every rejected command with the specific reason

---

## Code Structure

Organize into these clearly commented sections in one single `.ino` file:

1. Pin definitions and constants
2. Enums and structs
3. Global state variables
4. BLE server and callbacks
5. JSON parser and validator
6. Command state manager
7. Ultrasonic sensor reader
8. Arbitration engine
9. Haptic motor driver
10. NeoPixel status indicator
11. Debug logger
12. `setup()` and `loop()`

---

## Deliverable

Produce **one complete `.ino` file**. No placeholders. No TODOs. Must compile on ESP32-S3 Arduino framework with NimBLE-Arduino, ArduinoJson, and Adafruit NeoPixel libraries installed.
