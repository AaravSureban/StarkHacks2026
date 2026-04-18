#include <Arduino.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <NimBLEDevice.h>
#include <esp32-hal-ledc.h>
#include <string>

static const char *BLE_DEVICE_NAME = "NavVest";
static const char *BLE_SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
static const char *BLE_COMMAND_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

static const uint8_t BACK_ENA_PIN = 4;
static const uint8_t BACK_IN1_PIN = 5;
static const uint8_t BACK_IN2_PIN = 6;
static const uint8_t FRONT_IN3_PIN = 7;
static const uint8_t FRONT_IN4_PIN = 15;
static const uint8_t FRONT_ENB_PIN = 16;
static const uint8_t LEFT_ENA_PIN = 18;
static const uint8_t LEFT_IN1_PIN = 8;
static const uint8_t LEFT_IN2_PIN = 3;
static const uint8_t RIGHT_IN3_PIN = 46;
static const uint8_t RIGHT_IN4_PIN = 9;
static const uint8_t RIGHT_ENB_PIN = 10;

static const uint8_t NEOPIXEL_PIN = 38;
static const uint8_t NEOPIXEL_COUNT = 1;

static const uint32_t SERIAL_BAUD_RATE = 115200;
static const uint32_t LOG_INTERVAL_MS = 500;
static const uint32_t LEDC_FREQUENCY_HZ = 5000;
static const uint8_t LEDC_RESOLUTION_BITS = 8;
static const uint8_t MOTOR_PWM_CHANNEL_BACK = 0;
static const uint8_t MOTOR_PWM_CHANNEL_FRONT = 1;
static const uint8_t MOTOR_PWM_CHANNEL_LEFT = 2;
static const uint8_t MOTOR_PWM_CHANNEL_RIGHT = 3;

static const uint32_t SLOW_PULSE_ON_MS = 500;
static const uint32_t SLOW_PULSE_OFF_MS = 500;
static const uint32_t FAST_PULSE_ON_MS = 150;
static const uint32_t FAST_PULSE_OFF_MS = 150;

static const size_t JSON_DOC_CAPACITY = 512;
static const size_t REJECTION_REASON_SIZE = 96;
static const uint16_t BLE_COMMAND_MAX_LEN = 256;

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
  DIR_NONE
};

enum Pattern {
  PATTERN_STEADY,
  PATTERN_SLOW_PULSE,
  PATTERN_FAST_PULSE,
  PATTERN_NONE
};

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

struct HapticOutput {
  Direction direction;
  uint8_t intensity;
  Pattern pattern;
  uint8_t priority;
  const char *source;
};

struct PendingCommandSlot {
  VestCommand command;
  bool hasCommand;
};

Adafruit_NeoPixel gNeoPixel(NEOPIXEL_COUNT, NEOPIXEL_PIN, NEO_GRB + NEO_KHZ800);

NimBLEServer *gBleServer = nullptr;
NimBLECharacteristic *gCommandCharacteristic = nullptr;

volatile bool gBleConnected = false;
volatile bool gNewCommandAvailable = false;

portMUX_TYPE gCommandMux = portMUX_INITIALIZER_UNLOCKED;

PendingCommandSlot gPendingCommand = {};
VestCommand gActiveCommand = {};
bool gHasActiveCommand = false;

bool gSessionHasAcceptedSeq = false;
uint32_t gLastAcceptedSeq = 0;

uint32_t gLastLogMs = 0;
uint32_t gPatternPhaseStartedMs = 0;
Direction gCurrentlyEnergizedDirection = DIR_NONE;

HapticOutput gCurrentOutput = {DIR_NONE, 0, PATTERN_NONE, 0, "idle"};
HapticOutput gLastAppliedOutput = {DIR_NONE, 0, PATTERN_NONE, 0, "idle"};

class NavVestServerCallbacks : public NimBLEServerCallbacks {
 public:
  void onConnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo) override {
    (void)pServer;
    (void)connInfo;
    gBleConnected = true;
  }

  void onDisconnect(NimBLEServer *pServer, NimBLEConnInfo &connInfo, int reason) override {
    (void)pServer;
    (void)connInfo;
    (void)reason;
    gBleConnected = false;

    portENTER_CRITICAL(&gCommandMux);
    gSessionHasAcceptedSeq = false;
    gLastAcceptedSeq = 0;
    portEXIT_CRITICAL(&gCommandMux);

    NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
    if (advertising != nullptr) {
      advertising->start();
    }
  }
};

class NavVestCommandCallbacks : public NimBLECharacteristicCallbacks {
 public:
  void onWrite(NimBLECharacteristic *pCharacteristic, NimBLEConnInfo &connInfo) override;
};

NavVestServerCallbacks gServerCallbacks;
NavVestCommandCallbacks gCommandCallbacks;

bool hasReachedTime(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

void setRejectReason(char *reason, size_t reasonSize, const char *message) {
  if (reasonSize > 0) {
    snprintf(reason, reasonSize, "%s", message);
  }
}

void setRejectReasonField(char *reason, size_t reasonSize, const char *prefix, const char *field) {
  if (reasonSize > 0) {
    snprintf(reason, reasonSize, "%s%s", prefix, field);
  }
}

bool parseModeString(const char *value, Mode &mode) {
  if (strcmp(value, "manual") == 0) {
    mode = MANUAL;
    return true;
  }
  if (strcmp(value, "awareness") == 0) {
    mode = AWARENESS;
    return true;
  }
  if (strcmp(value, "object_nav") == 0) {
    mode = OBJECT_NAV;
    return true;
  }
  if (strcmp(value, "find_search") == 0) {
    mode = FIND_SEARCH;
    return true;
  }
  if (strcmp(value, "gps_nav") == 0) {
    mode = GPS_NAV;
    return true;
  }
  return false;
}

bool parseDirectionString(const char *value, Direction &direction) {
  if (strcmp(value, "left") == 0) {
    direction = DIR_LEFT;
    return true;
  }
  if (strcmp(value, "front") == 0) {
    direction = DIR_FRONT;
    return true;
  }
  if (strcmp(value, "right") == 0) {
    direction = DIR_RIGHT;
    return true;
  }
  if (strcmp(value, "back") == 0) {
    direction = DIR_BACK;
    return true;
  }
  if (strcmp(value, "none") == 0) {
    direction = DIR_NONE;
    return true;
  }
  return false;
}

bool parsePatternString(const char *value, Pattern &pattern) {
  if (strcmp(value, "steady") == 0) {
    pattern = PATTERN_STEADY;
    return true;
  }
  if (strcmp(value, "slow_pulse") == 0) {
    pattern = PATTERN_SLOW_PULSE;
    return true;
  }
  if (strcmp(value, "fast_pulse") == 0) {
    pattern = PATTERN_FAST_PULSE;
    return true;
  }
  if (strcmp(value, "none") == 0) {
    pattern = PATTERN_NONE;
    return true;
  }
  return false;
}

bool getRequiredStringField(JsonDocument &doc, const char *field, const char *&value, char *reason, size_t reasonSize) {
  if (!doc.containsKey(field)) {
    setRejectReasonField(reason, reasonSize, "missing field: ", field);
    return false;
  }

  JsonVariant variant = doc[field];
  if (!variant.is<const char *>()) {
    setRejectReasonField(reason, reasonSize, "wrong type: ", field);
    return false;
  }

  value = variant.as<const char *>();
  return true;
}

bool getRequiredIntField(JsonDocument &doc, const char *field, long minValue, long maxValue, long &value, char *reason,
                         size_t reasonSize) {
  if (!doc.containsKey(field)) {
    setRejectReasonField(reason, reasonSize, "missing field: ", field);
    return false;
  }

  JsonVariant variant = doc[field];
  if (!variant.is<long>()) {
    setRejectReasonField(reason, reasonSize, "wrong type: ", field);
    return false;
  }

  long parsedValue = variant.as<long>();
  if (parsedValue < minValue || parsedValue > maxValue) {
    setRejectReasonField(reason, reasonSize, "out of range: ", field);
    return false;
  }

  value = parsedValue;
  return true;
}

bool getRequiredFloatField(JsonDocument &doc, const char *field, float minValue, float maxValue, float &value, char *reason,
                           size_t reasonSize) {
  if (!doc.containsKey(field)) {
    setRejectReasonField(reason, reasonSize, "missing field: ", field);
    return false;
  }

  JsonVariant variant = doc[field];
  if (!variant.is<float>() && !variant.is<double>() && !variant.is<long>()) {
    setRejectReasonField(reason, reasonSize, "wrong type: ", field);
    return false;
  }

  float parsedValue = variant.as<float>();
  if (parsedValue < minValue || parsedValue > maxValue) {
    setRejectReasonField(reason, reasonSize, "out of range: ", field);
    return false;
  }

  value = parsedValue;
  return true;
}

bool getDistanceField(JsonDocument &doc, bool &hasDistance, float &distanceMeters, char *reason, size_t reasonSize) {
  if (!doc.containsKey("distance")) {
    setRejectReason(reason, reasonSize, "missing field: distance");
    return false;
  }

  JsonVariant variant = doc["distance"];
  if (variant.isNull()) {
    hasDistance = false;
    distanceMeters = 0.0f;
    return true;
  }

  if (!variant.is<float>() && !variant.is<double>() && !variant.is<long>()) {
    setRejectReason(reason, reasonSize, "wrong type: distance");
    return false;
  }

  float parsedDistance = variant.as<float>();
  if (parsedDistance < 0.0f) {
    setRejectReason(reason, reasonSize, "out of range: distance");
    return false;
  }

  hasDistance = true;
  distanceMeters = parsedDistance;
  return true;
}

bool parseAndValidateCommandPayload(const uint8_t *payload, size_t length, VestCommand &commandOut, bool hasLastSeq,
                                    uint32_t lastSeq, char *reason, size_t reasonSize) {
  StaticJsonDocument<JSON_DOC_CAPACITY> doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    setRejectReason(reason, reasonSize, "malformed JSON");
    return false;
  }

  const char *modeStr = nullptr;
  const char *directionStr = nullptr;
  const char *patternStr = nullptr;
  long intensity = 0;
  long priority = 0;
  long ttlMs = 0;
  long seqValue = 0;
  float confidence = 0.0f;

  if (!getRequiredStringField(doc, "mode", modeStr, reason, reasonSize)) {
    return false;
  }
  if (!parseModeString(modeStr, commandOut.mode)) {
    setRejectReason(reason, reasonSize, "unknown mode");
    return false;
  }

  if (!getRequiredStringField(doc, "direction", directionStr, reason, reasonSize)) {
    return false;
  }
  if (!parseDirectionString(directionStr, commandOut.direction)) {
    setRejectReason(reason, reasonSize, "unknown direction");
    return false;
  }

  if (!getRequiredIntField(doc, "intensity", 0, 255, intensity, reason, reasonSize)) {
    return false;
  }
  commandOut.intensity = static_cast<uint8_t>(intensity);

  if (!getRequiredStringField(doc, "pattern", patternStr, reason, reasonSize)) {
    return false;
  }
  if (!parsePatternString(patternStr, commandOut.pattern)) {
    setRejectReason(reason, reasonSize, "unknown pattern");
    return false;
  }

  if (!getRequiredIntField(doc, "priority", 0, 3, priority, reason, reasonSize)) {
    return false;
  }
  commandOut.priority = static_cast<uint8_t>(priority);

  if (!getRequiredIntField(doc, "ttlMs", 1, 1000, ttlMs, reason, reasonSize)) {
    return false;
  }
  commandOut.ttlMs = static_cast<uint16_t>(ttlMs);

  if (!getRequiredFloatField(doc, "confidence", 0.0f, 1.0f, confidence, reason, reasonSize)) {
    return false;
  }
  commandOut.confidence = confidence;

  if (!getDistanceField(doc, commandOut.hasDistance, commandOut.distanceMeters, reason, reasonSize)) {
    return false;
  }

  if (!getRequiredIntField(doc, "seq", 0, 2147483647L, seqValue, reason, reasonSize)) {
    return false;
  }
  commandOut.seq = static_cast<uint32_t>(seqValue);

  if (hasLastSeq && commandOut.seq == lastSeq) {
    setRejectReason(reason, reasonSize, "duplicate seq");
    return false;
  }

  commandOut.receivedAtMs = 0;
  commandOut.expiresAtMs = 0;
  return true;
}

void logRejectedCommand(const char *reason) {
  Serial.print("REJECT: ");
  Serial.println(reason);
}

void stagePendingCommand(const VestCommand &command) {
  portENTER_CRITICAL(&gCommandMux);
  gPendingCommand.command = command;
  gPendingCommand.hasCommand = true;
  gSessionHasAcceptedSeq = true;
  gLastAcceptedSeq = command.seq;
  gNewCommandAvailable = true;
  portEXIT_CRITICAL(&gCommandMux);
}

void NavVestCommandCallbacks::onWrite(NimBLECharacteristic *pCharacteristic, NimBLEConnInfo &connInfo) {
  (void)connInfo;

  std::string value = pCharacteristic->getValue();
  if (value.empty()) {
    logRejectedCommand("malformed JSON");
    return;
  }

  VestCommand parsedCommand = {};
  char rejectReason[REJECTION_REASON_SIZE] = {0};
  bool hasLastSeq = false;
  uint32_t lastSeq = 0;

  portENTER_CRITICAL(&gCommandMux);
  hasLastSeq = gSessionHasAcceptedSeq;
  lastSeq = gLastAcceptedSeq;
  portEXIT_CRITICAL(&gCommandMux);

  if (!parseAndValidateCommandPayload(reinterpret_cast<const uint8_t *>(value.data()), value.size(), parsedCommand, hasLastSeq, lastSeq,
                                      rejectReason, sizeof(rejectReason))) {
    logRejectedCommand(rejectReason);
    return;
  }

  stagePendingCommand(parsedCommand);
}

void clearActiveCommand() {
  gActiveCommand = {};
  gHasActiveCommand = false;
}

void consumePendingCommand(uint32_t now) {
  VestCommand newCommand = {};
  bool hasPendingCommand = false;

  portENTER_CRITICAL(&gCommandMux);
  if (gNewCommandAvailable && gPendingCommand.hasCommand) {
    newCommand = gPendingCommand.command;
    gPendingCommand.hasCommand = false;
    gNewCommandAvailable = false;
    hasPendingCommand = true;
  }
  portEXIT_CRITICAL(&gCommandMux);

  if (!hasPendingCommand) {
    return;
  }

  newCommand.receivedAtMs = now;
  newCommand.expiresAtMs = now + newCommand.ttlMs;
  gActiveCommand = newCommand;
  gHasActiveCommand = true;
}

void expireCommandIfNeeded(uint32_t now) {
  if (gHasActiveCommand && hasReachedTime(now, gActiveCommand.expiresAtMs)) {
    clearActiveCommand();
  }
}

uint32_t getActiveCommandRemainingMs(uint32_t now) {
  if (!gHasActiveCommand || hasReachedTime(now, gActiveCommand.expiresAtMs)) {
    return 0;
  }
  return gActiveCommand.expiresAtMs - now;
}

HapticOutput makeIdleOutput() {
  return {DIR_NONE, 0, PATTERN_NONE, 0, "idle"};
}

bool hasEffectivePhoneOutput() {
  return gHasActiveCommand && gActiveCommand.direction != DIR_NONE && gActiveCommand.pattern != PATTERN_NONE &&
         gActiveCommand.intensity > 0;
}

HapticOutput arbitratePhoneOnly() {
  if (hasEffectivePhoneOutput()) {
    return {gActiveCommand.direction, gActiveCommand.intensity, gActiveCommand.pattern, gActiveCommand.priority, "iphone"};
  }
  return makeIdleOutput();
}

void writeMotorDirectionPinsLow() {
  digitalWrite(BACK_IN1_PIN, LOW);
  digitalWrite(BACK_IN2_PIN, LOW);
  digitalWrite(FRONT_IN3_PIN, LOW);
  digitalWrite(FRONT_IN4_PIN, LOW);
  digitalWrite(LEFT_IN1_PIN, LOW);
  digitalWrite(LEFT_IN2_PIN, LOW);
  digitalWrite(RIGHT_IN3_PIN, LOW);
  digitalWrite(RIGHT_IN4_PIN, LOW);
}

void allMotorsOff() {
  ledcWriteChannel(MOTOR_PWM_CHANNEL_BACK, 0);
  ledcWriteChannel(MOTOR_PWM_CHANNEL_FRONT, 0);
  ledcWriteChannel(MOTOR_PWM_CHANNEL_LEFT, 0);
  ledcWriteChannel(MOTOR_PWM_CHANNEL_RIGHT, 0);
  writeMotorDirectionPinsLow();
  gCurrentlyEnergizedDirection = DIR_NONE;
}

void setDirectionPinsForMotor(Direction direction) {
  writeMotorDirectionPinsLow();

  switch (direction) {
    case DIR_BACK:
      digitalWrite(BACK_IN1_PIN, HIGH);
      digitalWrite(BACK_IN2_PIN, LOW);
      break;
    case DIR_FRONT:
      digitalWrite(FRONT_IN3_PIN, HIGH);
      digitalWrite(FRONT_IN4_PIN, LOW);
      break;
    case DIR_LEFT:
      digitalWrite(LEFT_IN1_PIN, HIGH);
      digitalWrite(LEFT_IN2_PIN, LOW);
      break;
    case DIR_RIGHT:
      digitalWrite(RIGHT_IN3_PIN, HIGH);
      digitalWrite(RIGHT_IN4_PIN, LOW);
      break;
    case DIR_NONE:
    default:
      break;
  }
}

uint8_t pwmChannelForDirection(Direction direction) {
  switch (direction) {
    case DIR_BACK:
      return MOTOR_PWM_CHANNEL_BACK;
    case DIR_FRONT:
      return MOTOR_PWM_CHANNEL_FRONT;
    case DIR_LEFT:
      return MOTOR_PWM_CHANNEL_LEFT;
    case DIR_RIGHT:
      return MOTOR_PWM_CHANNEL_RIGHT;
    case DIR_NONE:
    default:
      return MOTOR_PWM_CHANNEL_BACK;
  }
}

bool outputsEqual(const HapticOutput &a, const HapticOutput &b) {
  return a.direction == b.direction && a.intensity == b.intensity && a.pattern == b.pattern && a.priority == b.priority;
}

bool shouldPatternBeOn(const HapticOutput &output, uint32_t now) {
  switch (output.pattern) {
    case PATTERN_STEADY:
      return true;
    case PATTERN_SLOW_PULSE: {
      uint32_t elapsed = now - gPatternPhaseStartedMs;
      uint32_t cycle = SLOW_PULSE_ON_MS + SLOW_PULSE_OFF_MS;
      return (elapsed % cycle) < SLOW_PULSE_ON_MS;
    }
    case PATTERN_FAST_PULSE: {
      uint32_t elapsed = now - gPatternPhaseStartedMs;
      uint32_t cycle = FAST_PULSE_ON_MS + FAST_PULSE_OFF_MS;
      return (elapsed % cycle) < FAST_PULSE_ON_MS;
    }
    case PATTERN_NONE:
    default:
      return false;
  }
}

void driveSingleMotor(Direction direction, uint8_t intensity) {
  if (direction == DIR_NONE || intensity == 0) {
    allMotorsOff();
    return;
  }

  if (gCurrentlyEnergizedDirection != direction) {
    allMotorsOff();
    setDirectionPinsForMotor(direction);
  }

  ledcWriteChannel(pwmChannelForDirection(direction), intensity);
  gCurrentlyEnergizedDirection = direction;
}

void applyHapticOutput(const HapticOutput &output, uint32_t now) {
  if (!outputsEqual(output, gLastAppliedOutput)) {
    gPatternPhaseStartedMs = now;
    gLastAppliedOutput = output;
  }

  if (output.direction == DIR_NONE || output.pattern == PATTERN_NONE || output.intensity == 0) {
    allMotorsOff();
    return;
  }

  if (shouldPatternBeOn(output, now)) {
    driveSingleMotor(output.direction, output.intensity);
  } else {
    allMotorsOff();
  }
}

const char *modeToString(Mode mode) {
  switch (mode) {
    case MANUAL:
      return "manual";
    case AWARENESS:
      return "awareness";
    case OBJECT_NAV:
      return "object_nav";
    case FIND_SEARCH:
      return "find_search";
    case GPS_NAV:
      return "gps_nav";
    default:
      return "unknown";
  }
}

const char *directionToString(Direction direction) {
  switch (direction) {
    case DIR_LEFT:
      return "left";
    case DIR_FRONT:
      return "front";
    case DIR_RIGHT:
      return "right";
    case DIR_BACK:
      return "back";
    case DIR_NONE:
      return "none";
    default:
      return "unknown";
  }
}

const char *patternToString(Pattern pattern) {
  switch (pattern) {
    case PATTERN_STEADY:
      return "steady";
    case PATTERN_SLOW_PULSE:
      return "slow_pulse";
    case PATTERN_FAST_PULSE:
      return "fast_pulse";
    case PATTERN_NONE:
      return "none";
    default:
      return "unknown";
  }
}

void updateNeoPixel(bool bleConnected) {
  if (bleConnected) {
    gNeoPixel.setPixelColor(0, gNeoPixel.Color(0, 255, 0));
  } else {
    gNeoPixel.setPixelColor(0, gNeoPixel.Color(0, 0, 255));
  }
  gNeoPixel.show();
}

void printDebugLog(uint32_t now) {
  if (!hasReachedTime(now, gLastLogMs + LOG_INTERVAL_MS)) {
    return;
  }
  gLastLogMs = now;

  Serial.print("BLE: ");
  Serial.print(gBleConnected ? "connected" : "advertising");
  Serial.print(" | seq=");
  if (gHasActiveCommand) {
    Serial.print(gActiveCommand.seq);
    Serial.print(" | cmd: mode=");
    Serial.print(modeToString(gActiveCommand.mode));
    Serial.print(" dir=");
    Serial.print(directionToString(gActiveCommand.direction));
    Serial.print(" intensity=");
    Serial.print(gActiveCommand.intensity);
    Serial.print(" ttl=");
    Serial.print(gActiveCommand.ttlMs);
    Serial.print("ms remaining=");
    Serial.print(getActiveCommandRemainingMs(now));
    Serial.println("ms");
  } else {
    Serial.println("none | cmd: none");
  }

  Serial.print("OUTPUT: source=");
  Serial.print(gCurrentOutput.source);
  Serial.print(" dir=");
  Serial.print(directionToString(gCurrentOutput.direction));
  Serial.print(" intensity=");
  Serial.print(gCurrentOutput.intensity);
  Serial.print(" pattern=");
  Serial.println(patternToString(gCurrentOutput.pattern));
}

void initNeoPixel() {
  gNeoPixel.begin();
  gNeoPixel.clear();
  gNeoPixel.show();
}

void initMotorPins() {
  pinMode(BACK_IN1_PIN, OUTPUT);
  pinMode(BACK_IN2_PIN, OUTPUT);
  pinMode(FRONT_IN3_PIN, OUTPUT);
  pinMode(FRONT_IN4_PIN, OUTPUT);
  pinMode(LEFT_IN1_PIN, OUTPUT);
  pinMode(LEFT_IN2_PIN, OUTPUT);
  pinMode(RIGHT_IN3_PIN, OUTPUT);
  pinMode(RIGHT_IN4_PIN, OUTPUT);
  writeMotorDirectionPinsLow();
}

void initLEDC() {
  ledcAttachChannel(BACK_ENA_PIN, LEDC_FREQUENCY_HZ, LEDC_RESOLUTION_BITS, MOTOR_PWM_CHANNEL_BACK);
  ledcAttachChannel(FRONT_ENB_PIN, LEDC_FREQUENCY_HZ, LEDC_RESOLUTION_BITS, MOTOR_PWM_CHANNEL_FRONT);
  ledcAttachChannel(LEFT_ENA_PIN, LEDC_FREQUENCY_HZ, LEDC_RESOLUTION_BITS, MOTOR_PWM_CHANNEL_LEFT);
  ledcAttachChannel(RIGHT_ENB_PIN, LEDC_FREQUENCY_HZ, LEDC_RESOLUTION_BITS, MOTOR_PWM_CHANNEL_RIGHT);
  allMotorsOff();
}

void initBLE() {
  NimBLEDevice::init(BLE_DEVICE_NAME);

  gBleServer = NimBLEDevice::createServer();
  if (gBleServer == nullptr) {
    Serial.println("WARN: failed to create BLE server");
    return;
  }
  gBleServer->setCallbacks(&gServerCallbacks);

  NimBLEService *service = gBleServer->createService(BLE_SERVICE_UUID);
  if (service == nullptr) {
    Serial.println("WARN: failed to create BLE service");
    return;
  }

  gCommandCharacteristic = service->createCharacteristic(BLE_COMMAND_CHAR_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR,
                                                         BLE_COMMAND_MAX_LEN);
  if (gCommandCharacteristic == nullptr) {
    Serial.println("WARN: failed to create BLE characteristic");
    return;
  }

  gCommandCharacteristic->setCallbacks(&gCommandCallbacks);
  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  if (advertising == nullptr) {
    Serial.println("WARN: failed to get BLE advertising");
    return;
  }

  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->setName(BLE_DEVICE_NAME);
  advertising->enableScanResponse(true);
  advertising->start();
}

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  initNeoPixel();
  initMotorPins();
  initLEDC();
  initBLE();
  clearActiveCommand();
  gCurrentOutput = makeIdleOutput();
  gLastAppliedOutput = makeIdleOutput();
  gPatternPhaseStartedMs = millis();
  updateNeoPixel(gBleConnected);
}

void loop() {
  uint32_t now = millis();
  consumePendingCommand(now);
  expireCommandIfNeeded(now);
  gCurrentOutput = arbitratePhoneOnly();
  applyHapticOutput(gCurrentOutput, now);
  updateNeoPixel(gBleConnected);
  printDebugLog(now);
}
