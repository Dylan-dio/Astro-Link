/*
 * Astro-Link - Bio-Badge ESP8266 (Version Finale Prête)
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <math.h>

// ----------------------------- Reseau -------------------------------------
const char* WIFI_SSID = "MedBox_Network";
const char* WIFI_PASSWORD = "WafWafIvan";

const char* BACKEND_HOST = "192.168.4.100";
const uint16_t BACKEND_PORT = 8000;

IPAddress AP_IP(192, 168, 4, 1);
IPAddress AP_GATEWAY(192, 168, 4, 1);
IPAddress AP_SUBNET(255, 255, 255, 0);

// ----------------------------- Broches Corrigées --------------------------
const uint8_t PULSE_PIN = A0;
const uint8_t BUTTON_PIN = D1;       // Bouton SOS -> GND
const uint8_t BUZZER_PIN = D0;       // Déplacé sur D0
const uint8_t LED_G_PIN = D3;        // LED Verte
const uint8_t LED_B_PIN = D4;        // LED Bleue
const uint8_t TEMPERATURE_PIN = D5;  // DS18B20 (+ résistance 4.7k vers 3.3V)
const uint8_t HALL_PIN = D6;         // Déplacé sur D6 (sécurise le Boot)
const uint8_t TILT_PIN = D7;         // Capteur inclinaison -> GND
const uint8_t LED_R_PIN = D2;        // LED Rouge

ESP8266WebServer server(80);
OneWire oneWire(TEMPERATURE_PIN);
DallasTemperature temperatureSensor(&oneWire);

// Configuration matérielle
const bool RGB_COMMON_ANODE = false;
const bool INPUTS_ACTIVE_LOW = true;

// Cadencement des tâches
const unsigned long TELEMETRY_INTERVAL_MS = 1000;
const unsigned long PULSE_SAMPLING_MS = 20;        // Échantillonnage A0 à 50 Hz
const unsigned long TEMP_REQUEST_INTERVAL_MS = 2000; // Mesure temp toutes les 2s
const unsigned long BUTTON_DEBOUNCE_MS = 40;

unsigned long lastTelemetry = 0;
unsigned long lastPulseSample = 0;
unsigned long lastTempRequest = 0;

unsigned long lastButtonChange = 0;
bool lastButtonReading = false;
bool stableButtonState = false;

bool pulseAboveThreshold = false;
unsigned long lastPulseAt = 0;
int heartRate = 0;
float pulseBaseline = 512.0f;
float cachedTemperature = NAN;

bool activeInput(uint8_t pin) {
  const int level = digitalRead(pin);
  return INPUTS_ACTIVE_LOW ? level == LOW : level == HIGH;
}

void setLed(bool red, bool green, bool blue) {
  const uint8_t on = RGB_COMMON_ANODE ? LOW : HIGH;
  const uint8_t off = RGB_COMMON_ANODE ? HIGH : LOW;
  digitalWrite(LED_R_PIN, red ? on : off);
  digitalWrite(LED_G_PIN, green ? on : off);
  digitalWrite(LED_B_PIN, blue ? on : off);
}

void setHealthLed(const String& colour) {
  if (colour == "rouge" || colour == "red") {
    setLed(true, false, false);
  } else if (colour == "orange" || colour == "amber") {
    setLed(true, true, false);
  } else if (colour == "vert" || colour == "green") {
    setLed(false, true, false);
  } else {
    setLed(false, false, false);
  }
}

void setBuzzer(bool enabled) {
  if (enabled) {
    tone(BUZZER_PIN, 2200);
  } else {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
  }
}

String jsonValue(const String& body, const String& key) {
  const String quotedKey = "\"" + key + "\"";
  int start = body.indexOf(quotedKey);
  if (start < 0) return "";
  start = body.indexOf(':', start);
  if (start < 0) return "";
  start++;
  while (start < (int)body.length() && (body[start] == ' ' || body[start] == '"')) {
    start++;
  }
  int end = start;
  while (end < (int)body.length() && body[end] != '"' && body[end] != ',' && body[end] != '}') {
    end++;
  }
  String value = body.substring(start, end);
  value.trim();
  return value;
}

void handleAlert() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"detail\":\"Corps JSON manquant\"}");
    return;
  }

  const String body = server.arg("plain");
  const String led = jsonValue(body, "led");
  const String buzzer = jsonValue(body, "buzzer");

  if (led.length() > 0) setHealthLed(led);
  if (buzzer == "on") setBuzzer(true);
  if (buzzer == "off") setBuzzer(false);

  server.send(200, "application/json", "{\"ok\":true}");
}

void handleHealth() {
  server.send(200, "application/json", "{\"status\":\"ok\",\"device\":\"astro-link\"}");
}

// Variables de lissage et de moyenne (à conserver entre les appels)
float smoothedSample = 512.0f;
unsigned long lastBeatTime = 0;
int rates[4] = {0, 0, 0, 0};
uint8_t rateIdx = 0;

void processPulse() {
  const int rawSample = analogRead(PULSE_PIN);
  const unsigned long now = millis();

  // 1. Lissage du signal (Filtre passe-bas)
  smoothedSample = smoothedSample * 0.7f + rawSample * 0.3f;

  // 2. Mise à jour de la ligne de base
  pulseBaseline = pulseBaseline * 0.98f + smoothedSample * 0.02f;

  const float threshold = pulseBaseline + 12.0f;
  const bool above = smoothedSample > threshold;

  // 3. Détection de pic avec temps mort de 350 ms (max ~170 BPM)
  if (above && !pulseAboveThreshold && (now - lastBeatTime > 350)) {
    if (lastBeatTime != 0) {
      const unsigned long interval = now - lastBeatTime;
      if (interval >= 350 && interval <= 2000) {
        int instantBPM = (int)(60000UL / interval);
        
        // Stockage pour moyenne glissante sur 4 mesures
        rates[rateIdx] = instantBPM;
        rateIdx = (rateIdx + 1) % 4;

        int sum = 0;
        int count = 0;
        for (uint8_t i = 0; i < 4; i++) {
          if (rates[i] > 0) { sum += rates[i]; count++; }
        }
        if (count > 0) heartRate = sum / count;
      }
    }
    lastBeatTime = now;
  }

  pulseAboveThreshold = above;

  // Remise à zéro si aucun pouls pendant 3.5 secondes
  if (lastBeatTime != 0 && (now - lastBeatTime > 3500)) {
    heartRate = 0;
    for (uint8_t i = 0; i < 4; i++) rates[i] = 0;
  }

  // Envoi au Traceur Série
  Serial.print("Signal:");
  Serial.print(smoothedSample);
  Serial.print(",");
  Serial.print("Seuil:");
  Serial.print(threshold);
  Serial.print(",");
  Serial.print("BPM:");
  Serial.println(heartRate);
}

// Lecture asynchrone non-bloquante du DS18B20
void updateTemperatureAsync() {
  const unsigned long now = millis();
  
  const float val = temperatureSensor.getTempCByIndex(0);
  if (val != DEVICE_DISCONNECTED_C && val >= -55.0f && val <= 125.0f) {
    cachedTemperature = val;
  } else {
    cachedTemperature = NAN;
  }

  temperatureSensor.requestTemperatures();
  lastTempRequest = now;
}

void postTelemetry() {
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(300); // Court timeout pour éviter tout ralentissement du code
  
  const String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/telemetrie";
  const int pulse = analogRead(PULSE_PIN);

  String payload = "{";
  payload += "\"force\":" + String(constrain(pulse, 0, 1023)) + ",";
  payload += "\"tilt\":" + String(activeInput(TILT_PIN) ? 1 : 0) + ",";
  payload += "\"button\":" + String(stableButtonState ? 1 : 0) + ",";
  payload += "\"magnetic\":" + String(activeInput(HALL_PIN) ? 1 : 0) + ",";
  payload += "\"heartRate\":" + String(heartRate) + ",";
  payload += "\"temperature\":";
  if (isnan(cachedTemperature)) {
    payload += "null";
  } else {
    payload += String(cachedTemperature, 1);
  }
  payload += "}";

  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    http.POST(payload);
    http.end();
  }
}

void updateButton() {
  const bool reading = activeInput(BUTTON_PIN);
  const unsigned long now = millis();
  if (reading != lastButtonReading) {
    lastButtonChange = now;
    lastButtonReading = reading;
  }
  if (now - lastButtonChange >= BUTTON_DEBOUNCE_MS) {
    stableButtonState = reading;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(TILT_PIN, INPUT_PULLUP);
  pinMode(HALL_PIN, INPUT_PULLUP);
  pinMode(LED_R_PIN, OUTPUT);
  pinMode(LED_G_PIN, OUTPUT);
  pinMode(LED_B_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  temperatureSensor.begin();
  temperatureSensor.setWaitForConversion(false);
  temperatureSensor.requestTemperatures();

  setHealthLed("vert");
  setBuzzer(false);

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);

  server.on("/alerte", HTTP_POST, handleAlert);
  server.on("/health", HTTP_GET, handleHealth);
  server.begin();

  Serial.println("\nAstro-Link Bio-Badge pret.");
}

void loop() {
  const unsigned long now = millis();

  // 1. Échantillonnage cardiaque (50 Hz / 20 ms)
  if (now - lastPulseSample >= PULSE_SAMPLING_MS) {
    lastPulseSample = now;
    processPulse();
  }

  // 2. Traitement serveur
  server.handleClient();
  updateButton();

  // 3. Température
  if (now - lastTempRequest >= TEMP_REQUEST_INTERVAL_MS) {
    updateTemperatureAsync();
  }

  // 4. Envoi de la télémétrie HTTP au backend (Toutes les secondes)
  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    lastTelemetry = now;
    postTelemetry();
  }

  yield();
}