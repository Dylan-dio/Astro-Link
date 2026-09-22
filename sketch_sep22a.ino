=/*
 * Astro-Link - Bio-Badge ESP8266
 *
 * Le badge cree le reseau Wi-Fi MedBox_Network. Le PC qui heberge FastAPI
 * doit s'y connecter : il recevra une adresse 192.168.4.x.
 * Le backend est donc configurable ci-dessous, sans dependance a MQTT.
 *
 * Contrat avec main.py :
 *   POST http://<BACKEND_HOST>:8000/api/telemetrie
 *   {"force":0..1023,"tilt":0|1,"button":0|1,"magnetic":0|1,
 *    "heartRate":0..250}
 *
 *   POST http://192.168.4.1/alerte
 *   {"led":"vert|orange|rouge|off","buzzer":"on|off"}
 */

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <ESP8266HTTPClient.h>

// ----------------------------- Reseau -------------------------------------
const char* WIFI_SSID = "MedBox_Network";
const char* WIFI_PASSWORD = "WafWafIvan";

// Adresse du PC lorsqu'il est connecte au point d'acces de l'ESP8266.
// Modifier uniquement cette valeur si le PC recoit une autre adresse.
const char* BACKEND_HOST = "192.168.4.100";
const uint16_t BACKEND_PORT = 8000;

IPAddress AP_IP(192, 168, 4, 1);
IPAddress AP_GATEWAY(192, 168, 4, 1);
IPAddress AP_SUBNET(255, 255, 255, 0);

ESP8266WebServer server(80);

// ----------------------------- Broches ------------------------------------
// NodeMCU v3 : A0 est l'unique entree analogique.
const uint8_t PULSE_PIN = A0;
const uint8_t BUTTON_PIN = D1;  // bouton SOS, vers GND
const uint8_t TILT_PIN = D7;    // capteur d'inclinaison, vers GND
const uint8_t HALL_PIN = D8;    // Hall/ILS, vers GND
const uint8_t LED_R_PIN = D0;
const uint8_t LED_G_PIN = D3;
const uint8_t LED_B_PIN = D4;
const uint8_t BUZZER_PIN = D2;

// Mettre a true pour une LED RVB a anode commune.
const bool RGB_COMMON_ANODE = false;
const bool INPUTS_ACTIVE_LOW = true;

const unsigned long TELEMETRY_INTERVAL_MS = 1000;
const unsigned long BUTTON_DEBOUNCE_MS = 40;

unsigned long lastTelemetry = 0;
unsigned long lastButtonChange = 0;
bool lastButtonReading = false;
bool stableButtonState = false;
bool pulseAboveThreshold = false;
unsigned long lastPulseAt = 0;
int heartRate = 0;
float pulseBaseline = 512.0f;

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

void updateHeartRate(int sample) {
  pulseBaseline = pulseBaseline * 0.98f + sample * 0.02f;
  const bool above = sample > pulseBaseline + 35.0f;
  const unsigned long now = millis();

  if (above && !pulseAboveThreshold && lastPulseAt != 0) {
    const unsigned long interval = now - lastPulseAt;
    if (interval >= 300 && interval <= 2000) {
      heartRate = constrain((int)(60000UL / interval), 0, 250);
    }
  }
  if (above && !pulseAboveThreshold) lastPulseAt = now;
  pulseAboveThreshold = above;

  if (lastPulseAt != 0 && now - lastPulseAt > 5000) heartRate = 0;
}

void postTelemetry() {
  WiFiClient client;
  HTTPClient http;
  const String url = String("http://") + BACKEND_HOST + ":" + BACKEND_PORT + "/api/telemetrie";

  const int pulse = analogRead(PULSE_PIN);
  updateHeartRate(pulse);

  String payload = "{";
  payload += "\"force\":" + String(constrain(pulse, 0, 1023)) + ",";
  payload += "\"tilt\":" + String(activeInput(TILT_PIN) ? 1 : 0) + ",";
  payload += "\"button\":" + String(stableButtonState ? 1 : 0) + ",";
  payload += "\"magnetic\":" + String(activeInput(HALL_PIN) ? 1 : 0) + ",";
  payload += "\"heartRate\":" + String(heartRate);
  payload += "}";

  if (!http.begin(client, url)) return;
  http.addHeader("Content-Type", "application/json");
  http.POST(payload);
  http.end();
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
  setHealthLed("vert");
  setBuzzer(false);

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  WiFi.softAP(WIFI_SSID, WIFI_PASSWORD);

  server.on("/alerte", HTTP_POST, handleAlert);
  server.on("/health", HTTP_GET, handleHealth);
  server.begin();

  Serial.println();
  Serial.println("Astro-Link Bio-Badge pret.");
  Serial.print("Adresse du badge : ");
  Serial.println(WiFi.softAPIP());
  Serial.print("Backend : http://");
  Serial.print(BACKEND_HOST);
  Serial.print(":");
  Serial.println(BACKEND_PORT);
}

void loop() {
  server.handleClient();
  updateButton();

  const unsigned long now = millis();
  if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
    lastTelemetry = now;
    postTelemetry();
  }
  yield();
}
