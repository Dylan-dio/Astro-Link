/*
 * Astro-Link - Bio-Badge ESP8266
 *
 * Bibliothèques : "DHT sensor library" (Adafruit) + "Adafruit Unified Sensor"
 *
 * Comportement :
 *   - Vert  : état normal (ou couleur envoyée par le back-end)
 *   - Rouge + bips rapides : SOS (bouton). Annulable UNIQUEMENT par le badge.
 *   - Rouge + bips longs   : BPM trop élevé. S'arrête seul quand le BPM redescend.
 *   - Bleu  : badge (aimant) détecté
 *   Priorité : alertes > badge > back-end / vert
 *
 * Câblage :
 *   A0 -> Capteur de pouls (S)
 *   D0 -> Capteur à aimant (OUT)
 *   D1 -> LED RGB (rouge)
 *   D2 -> Buzzer (S)
 *   D3 -> Bouton SOS -> GND
 *   D4 -> DHT (DATA)
 *   D5 -> LED RGB (bleu)
 *   D6 -> Capteur IR (OUT)
 *   D7 -> Capteur à bille -> GND
 *   D8 -> LED RGB (vert)
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>
#include <DHT.h>
#include <math.h>

// ----------------------------- Réseau -------------------------------------
const char* WIFI_SSID     = "MedBox_Network";
const char* WIFI_PASSWORD = "WafWafIvan";

const char*    BACKEND_HOST = "192.168.4.100";
const uint16_t BACKEND_PORT = 8000;

IPAddress AP_IP(192, 168, 4, 1);
IPAddress AP_GATEWAY(192, 168, 4, 1);
IPAddress AP_SUBNET(255, 255, 255, 0);

// ----------------------------- Broches ------------------------------------
const uint8_t PULSE_PIN  = A0;
const uint8_t HALL_PIN   = D0;
const uint8_t LED_R_PIN  = D1;
const uint8_t BUZZER_PIN = D2;
const uint8_t BUTTON_PIN = D3;
const uint8_t DHT_PIN    = D4;
const uint8_t LED_B_PIN  = D5;
const uint8_t IR_PIN     = D6;
const uint8_t TILT_PIN   = D7;
const uint8_t LED_G_PIN  = D8;

ESP8266WebServer server(80);
DHT dht(DHT_PIN, DHT11);

// ----------------------------- Config matérielle --------------------------
const bool RGB_COMMON_ANODE  = false;
const bool INPUTS_ACTIVE_LOW = true;
const bool BUZZER_IS_PASSIVE = true;   // false si le buzzer sonne seul quand S = HIGH

// ----------------------------- Réglages -----------------------------------
const int BPM_ALERT_HIGH  = 120;   // alerte si BPM >= cette valeur
const int BPM_ALERT_CLEAR = 110;   // fin d'alerte si BPM < cette valeur

const unsigned long MAGNET_HOLD_MS = 1000;  // durée du bleu après le badge

// Son SOS : bips rapides
const uint16_t      SOS_FREQ          = 2200;  // fréquence (plus haut = plus aigu)
const unsigned long SOS_BEEP_ON_MS    = 150;   // durée d'un bip
const unsigned long SOS_BEEP_CYCLE_MS = 400;   // un bip toutes les 400 ms

// Son alerte BPM : bips longs
const uint16_t      BPM_FREQ          = 2200;
const unsigned long BPM_BEEP_ON_MS    = 500;
const unsigned long BPM_BEEP_CYCLE_MS = 1000;

const unsigned long TELEMETRY_INTERVAL_MS = 1000;
const unsigned long PULSE_SAMPLING_MS     = 20;
const unsigned long PRINT_INTERVAL_MS     = 100;
const unsigned long DHT_INTERVAL_MS       = 2500;
const unsigned long DEBOUNCE_MS           = 40;
const uint16_t      HTTP_TIMEOUT_MS       = 250;

// ----------------------------- Variables ----------------------------------
unsigned long lastTelemetry   = 0;
unsigned long lastPulseSample = 0;
unsigned long lastPrint       = 0;
unsigned long lastDhtRead     = 0;

// Bouton / SOS
unsigned long lastButtonChange = 0;
bool lastButtonReading = false;
bool stableButtonState = false;
bool sosLatched = false;
bool sosActive  = false;
unsigned long sosStart = 0;

// Alerte BPM
bool bpmAlert = false;
unsigned long bpmAlertStart = 0;

// Badge (aimant)
bool magnetSeen = false;
bool lastMagnetState = false;
unsigned long lastMagnetSeen = 0;

// LED / Buzzer
String backendColour = "vert";
String currentColour = "";
bool backendBuzzer = false;
uint16_t currentFreq = 0;

// Pouls
float smoothedSample = 512.0f;
float pulseBaseline  = 512.0f;
bool  pulseAboveThreshold = false;
unsigned long lastBeatTime = 0;
int   rates[4] = {0, 0, 0, 0};
uint8_t rateIdx = 0;
int   heartRate = 0;
int   lastRawPulse = 0;

// Environnement
float cachedTemperature = NAN;
float cachedHumidity    = NAN;

// ==========================================================================

bool activeInput(uint8_t pin) {
  const int level = digitalRead(pin);
  return INPUTS_ACTIVE_LOW ? (level == LOW) : (level == HIGH);
}

// ----------------------------- LED ----------------------------------------
void setLed(bool red, bool green, bool blue) {
  const uint8_t on  = RGB_COMMON_ANODE ? LOW : HIGH;
  const uint8_t off = RGB_COMMON_ANODE ? HIGH : LOW;
  digitalWrite(LED_R_PIN, red   ? on : off);
  digitalWrite(LED_G_PIN, green ? on : off);
  digitalWrite(LED_B_PIN, blue  ? on : off);
}

void setHealthLed(const String& colour) {
  if (colour == "rouge" || colour == "red")          setLed(true,  false, false);
  else if (colour == "orange" || colour == "amber")  setLed(true,  true,  false);
  else if (colour == "vert" || colour == "green")    setLed(false, true,  false);
  else if (colour == "bleu" || colour == "blue")     setLed(false, false, true);
  else                                               setLed(false, false, false);
}

// ----------------------------- Buzzer -------------------------------------
void playFreq(uint16_t freq) {
  if (freq == currentFreq) return;
  currentFreq = freq;
  if (BUZZER_IS_PASSIVE) {
    if (freq == 0) { noTone(BUZZER_PIN); digitalWrite(BUZZER_PIN, LOW); }
    else tone(BUZZER_PIN, freq);
  } else {
    digitalWrite(BUZZER_PIN, freq > 0 ? HIGH : LOW);
  }
}

void setBuzzer(bool enabled) {
  playFreq(enabled ? 2200 : 0);
}

// ----------------------------- Badge --------------------------------------
void updateBadge() {
  const unsigned long now = millis();
  const bool magnetNow = activeInput(HALL_PIN);

  if (magnetNow) {
    magnetSeen = true;
    lastMagnetSeen = now;
  }

  // Passage du badge : annule l'alerte SOS
  if (magnetNow && !lastMagnetState && sosActive) {
    sosActive = false;
    Serial.println(F(">>> SOS ANNULE PAR LE BADGE"));
  }
  lastMagnetState = magnetNow;
}

// ----------------------------- Alerte BPM ---------------------------------
void updateBpmAlert() {
  if (!bpmAlert && heartRate >= BPM_ALERT_HIGH) {
    bpmAlert = true;
    bpmAlertStart = millis();
    Serial.print(F(">>> ALERTE BPM : ")); Serial.println(heartRate);
  } else if (bpmAlert && heartRate < BPM_ALERT_CLEAR) {
    bpmAlert = false;
    Serial.println(F(">>> FIN ALERTE BPM"));
  }
}

// ----------------------------- Couleur LED --------------------------------
void updateStatusLed() {
  const bool magnetRecent = magnetSeen && (millis() - lastMagnetSeen < MAGNET_HOLD_MS);

  String wanted;
  if (sosActive || bpmAlert)  wanted = "rouge";
  else if (magnetRecent)      wanted = "bleu";
  else                        wanted = backendColour;

  if (wanted != currentColour) {
    currentColour = wanted;
    setHealthLed(wanted);
  }
}

// ----------------------------- Son ----------------------------------------
void updateBuzzer() {
  const unsigned long now = millis();

  // SOS : bips rapides
  if (sosActive) {
    const bool on = ((now - sosStart) % SOS_BEEP_CYCLE_MS) < SOS_BEEP_ON_MS;
    playFreq(on ? SOS_FREQ : 0);
    return;
  }

  // Alerte BPM : bips longs
  if (bpmAlert) {
    const bool on = ((now - bpmAlertStart) % BPM_BEEP_CYCLE_MS) < BPM_BEEP_ON_MS;
    playFreq(on ? BPM_FREQ : 0);
    return;
  }

  // Sinon : commande du back-end
  setBuzzer(backendBuzzer);
}

// ----------------------------- JSON ---------------------------------------
String jsonValue(const String& body, const String& key) {
  const String quotedKey = "\"" + key + "\"";
  int start = body.indexOf(quotedKey);
  if (start < 0) return "";
  start = body.indexOf(':', start + quotedKey.length());
  if (start < 0) return "";
  start++;
  while (start < (int)body.length() && (body[start] == ' ' || body[start] == '"')) start++;
  int end = start;
  while (end < (int)body.length() && body[end] != '"' && body[end] != ',' && body[end] != '}') end++;
  String value = body.substring(start, end);
  value.trim();
  value.toLowerCase();
  return value;
}

void appendFloatOrNull(char* dst, size_t len, float v) {
  if (isnan(v)) strncpy(dst, "null", len);
  else dtostrf(v, 0, 1, dst);
}

// ----------------------------- Routes HTTP --------------------------------
void handleAlert() {
  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"detail\":\"Corps JSON manquant\"}");
    return;
  }
  const String body   = server.arg("plain");
  const String led    = jsonValue(body, "led");
  const String buzzer = jsonValue(body, "buzzer");

  if (led.length() > 0) backendColour = led;
  if (buzzer == "on"  || buzzer == "true"  || buzzer == "1") backendBuzzer = true;
  if (buzzer == "off" || buzzer == "false" || buzzer == "0") backendBuzzer = false;

  server.send(200, "application/json", "{\"ok\":true}");
}

void handleHealth() {
  server.send(200, "application/json", "{\"status\":\"ok\",\"device\":\"astro-link\"}");
}

void handleStatus() {
  char tempStr[10], humStr[10];
  appendFloatOrNull(tempStr, sizeof(tempStr), cachedTemperature);
  appendFloatOrNull(humStr,  sizeof(humStr),  cachedHumidity);

  char json[300];
  snprintf(json, sizeof(json),
           "{\"heartRate\":%d,\"pulseRaw\":%d,\"tilt\":%d,\"button\":%d,\"sos\":%d,"
           "\"bpmAlert\":%d,\"magnetic\":%d,\"proximity\":%d,"
           "\"temperature\":%s,\"humidity\":%s}",
           heartRate, lastRawPulse,
           activeInput(TILT_PIN) ? 1 : 0,
           stableButtonState ? 1 : 0,
           sosActive ? 1 : 0,
           bpmAlert ? 1 : 0,
           activeInput(HALL_PIN) ? 1 : 0,
           activeInput(IR_PIN) ? 1 : 0,
           tempStr, humStr);
  server.send(200, "application/json", json);
}

// ----------------------------- Pouls --------------------------------------
void processPulse() {
  const int rawSample = analogRead(PULSE_PIN);
  const unsigned long now = millis();
  lastRawPulse = rawSample;

  smoothedSample = smoothedSample * 0.7f + rawSample * 0.3f;
  pulseBaseline  = pulseBaseline  * 0.98f + smoothedSample * 0.02f;

  const float threshold = pulseBaseline + 12.0f;
  const bool above = smoothedSample > threshold;

  if (above && !pulseAboveThreshold && (now - lastBeatTime > 350)) {
    if (lastBeatTime != 0) {
      const unsigned long interval = now - lastBeatTime;
      if (interval <= 2000) {
        rates[rateIdx] = (int)(60000UL / interval);
        rateIdx = (rateIdx + 1) % 4;
        int sum = 0, count = 0;
        for (uint8_t i = 0; i < 4; i++) {
          if (rates[i] > 0) { sum += rates[i]; count++; }
        }
        if (count > 0) heartRate = sum / count;
      }
    }
    lastBeatTime = now;
  }
  pulseAboveThreshold = above;

  if (lastBeatTime != 0 && (now - lastBeatTime > 3500) && heartRate != 0) {
    heartRate = 0;
    for (uint8_t i = 0; i < 4; i++) rates[i] = 0;
  }
}

// ----------------------------- Affichage série ----------------------------
void printSensors() {
  Serial.print(F("Signal:"));     Serial.print(smoothedSample);
  Serial.print(F(",BPM:"));       Serial.print(heartRate);
  Serial.print(F(",Aimant:"));    Serial.print(activeInput(HALL_PIN) ? 1 : 0);
  Serial.print(F(",IR:"));        Serial.print(activeInput(IR_PIN) ? 1 : 0);
  Serial.print(F(",Bille:"));     Serial.print(activeInput(TILT_PIN) ? 1 : 0);
  Serial.print(F(",Bouton:"));    Serial.print(stableButtonState ? 1 : 0);
  Serial.print(F(",SOS:"));       Serial.print(sosActive ? 1 : 0);
  Serial.print(F(",AlerteBPM:")); Serial.print(bpmAlert ? 1 : 0);
  Serial.print(F(",Temp:"));      Serial.print(isnan(cachedTemperature) ? -1.0f : cachedTemperature);
  Serial.print(F(",Hum:"));       Serial.println(isnan(cachedHumidity) ? -1.0f : cachedHumidity);
}

// ----------------------------- DHT11 --------------------------------------
void updateDht() {
  lastDhtRead = millis();
  const float t = dht.readTemperature();
  const float h = dht.readHumidity();
  cachedTemperature = (isnan(t) || t < 0.0f || t > 60.0f)  ? NAN : t;
  cachedHumidity    = (isnan(h) || h < 0.0f || h > 100.0f) ? NAN : h;
}

// ----------------------------- Télémétrie ---------------------------------
void postTelemetry() {
  if (WiFi.softAPgetStationNum() == 0) return;

  char tempStr[10], humStr[10];
  appendFloatOrNull(tempStr, sizeof(tempStr), cachedTemperature);
  appendFloatOrNull(humStr,  sizeof(humStr),  cachedHumidity);

  char payload[300];
  snprintf(payload, sizeof(payload),
           "{\"force\":%d,\"tilt\":%d,\"button\":%d,\"magnetic\":%d,"
           "\"proximity\":%d,\"heartRate\":%d,\"sos\":%d,\"bpmAlert\":%d,"
           "\"temperature\":%s,\"humidity\":%s}",
           constrain(lastRawPulse, 0, 1023),
           activeInput(TILT_PIN) ? 1 : 0,
           (stableButtonState || sosLatched || sosActive) ? 1 : 0,
           activeInput(HALL_PIN) ? 1 : 0,
           activeInput(IR_PIN) ? 1 : 0,
           heartRate,
           sosActive ? 1 : 0,
           bpmAlert ? 1 : 0,
           tempStr,
           humStr);

  static const String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/telemetrie";

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (http.begin(client, url)) {
    http.addHeader("Content-Type", "application/json");
    const int code = http.POST((uint8_t*)payload, strlen(payload));
    if (code > 0) sosLatched = false;
    http.end();
  }
}

// ----------------------------- Bouton SOS ---------------------------------
void updateButton() {
  const bool reading = activeInput(BUTTON_PIN);
  const unsigned long now = millis();
  if (reading != lastButtonReading) {
    lastButtonChange = now;
    lastButtonReading = reading;
  }
  if (now - lastButtonChange >= DEBOUNCE_MS) {
    if (reading && !stableButtonState) {          // nouveau clic
      sosLatched = true;
      if (!sosActive) {
        sosActive = true;
        sosStart = now;
        Serial.println(F(">>> SOS ACTIVE (passer le badge pour annuler)"));
      } else {
        Serial.println(F(">>> SOS deja actif : seul le badge peut l'annuler"));
      }
    }
    stableButtonState = reading;
  }
}

// ==========================================================================
void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(TILT_PIN,   INPUT_PULLUP);
  pinMode(IR_PIN,     INPUT_PULLUP);
  pinMode(HALL_PIN,   INPUT);
  pinMode(LED_R_PIN,  OUTPUT);
  pinMode(LED_G_PIN,  OUTPUT);
  pinMode(LED_B_PIN,  OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // LED verte immédiatement
  setHealthLed("vert");
  currentColour = "vert";

  // États initiaux : évite un faux SOS ou un faux passage de badge au démarrage
  lastButtonReading = activeInput(BUTTON_PIN);
  stableButtonState = lastButtonReading;
  lastButtonChange  = millis();
  lastMagnetState   = activeInput(HALL_PIN);

  // Petit bip de démarrage
  setBuzzer(true); delay(80); setBuzzer(false);

  dht.begin();

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);

  server.on("/alerte", HTTP_POST, handleAlert);
  server.on("/health", HTTP_GET,  handleHealth);
  server.on("/status", HTTP_GET,  handleStatus);
  server.begin();

  Serial.println(F("\nAstro-Link Bio-Badge pret."));
}

void loop() {
  const unsigned long now = millis();

  if (now - lastPulseSample >= PULSE_SAMPLING_MS) {
    lastPulseSample = now;
    processPulse();
  }

  server.handleClient();
  updateButton();
  updateBadge();
  updateBpmAlert();
  updateStatusLed();
  updateBuzzer();

  if (now - lastDhtRead >= DHT_INTERVAL_MS) {
    updateDht();
  }

  if (now - lastPrint >= PRINT_INTERVAL_MS) {
    lastPrint = now;
    printSensors();
  }

  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    lastTelemetry = now;
    postTelemetry();
  }

  yield();
}