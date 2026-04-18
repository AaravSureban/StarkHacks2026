#include <Arduino.h>

static const uint8_t BACK_TRIG_PIN = 41;
static const uint8_t BACK_ECHO_PIN = 42;
static const uint8_t LEFT_TRIG_PIN = 39;
static const uint8_t LEFT_ECHO_PIN = 40;
static const uint8_t RIGHT_TRIG_PIN = 21;
static const uint8_t RIGHT_ECHO_PIN = 47;

static const uint32_t SERIAL_BAUD_RATE = 115200;
static const uint32_t SENSOR_SETTLE_MS = 75;
static const uint32_t LOOP_INTERVAL_MS = 500;
static const uint32_t ECHO_TIMEOUT_US = 25000;

struct SensorPins {
  const char *name;
  uint8_t trigPin;
  uint8_t echoPin;
};

SensorPins gSensors[] = {
    {"back", BACK_TRIG_PIN, BACK_ECHO_PIN},
    {"left", LEFT_TRIG_PIN, LEFT_ECHO_PIN},
    {"right", RIGHT_TRIG_PIN, RIGHT_ECHO_PIN},
};

uint32_t gLastPrintMs = 0;

float readDistanceCm(const SensorPins &sensor) {
  digitalWrite(sensor.trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(sensor.trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(sensor.trigPin, LOW);

  unsigned long durationUs = pulseIn(sensor.echoPin, HIGH, ECHO_TIMEOUT_US);
  if (durationUs == 0) {
    return -1.0f;
  }

  float distanceCm = static_cast<float>(durationUs) / 58.0f;
  if (distanceCm <= 0.0f || distanceCm > 400.0f) {
    return -1.0f;
  }

  return distanceCm;
}

void printDistance(const SensorPins &sensor, float distanceCm) {
  Serial.print(sensor.name);
  Serial.print(": ");

  if (distanceCm < 0.0f) {
    Serial.println("no valid reading");
    return;
  }

  Serial.print(distanceCm, 1);
  Serial.println(" cm");
}

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);

  for (size_t i = 0; i < (sizeof(gSensors) / sizeof(gSensors[0])); ++i) {
    pinMode(gSensors[i].trigPin, OUTPUT);
    pinMode(gSensors[i].echoPin, INPUT);
    digitalWrite(gSensors[i].trigPin, LOW);
  }

  Serial.println("NavVest ultrasonic test starting...");
  Serial.println("Reading back, left, and right sensors.");
}

void loop() {
  uint32_t now = millis();
  if ((now - gLastPrintMs) < LOOP_INTERVAL_MS) {
    return;
  }

  gLastPrintMs = now;
  Serial.println("---");

  for (size_t i = 0; i < (sizeof(gSensors) / sizeof(gSensors[0])); ++i) {
    float distanceCm = readDistanceCm(gSensors[i]);
    printDistance(gSensors[i], distanceCm);
    delay(SENSOR_SETTLE_MS);
  }
}
