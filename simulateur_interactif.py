import paho.mqtt.publish as publish
import json

BROKER = "127.0.0.1"
TOPIC_TELEMETRIE = "vaisseau/badge/1/telemetrie"
TOPIC_BADGE = "vaisseau/badge/1/badge_medecin"

def envoyer(topic, payload):
    publish.single(topic, json.dumps(payload), hostname=BROKER)
    print(f"📡 Données envoyées : {payload}")

while True:
    print("\n--- PANNEAU DE CONTRÔLE ESP8266 (SIMULATION) ---")
    print("1. Envoyer constantes normales (Stress bas, Actif)")
    print("2. Simuler une crise d'anxiété (Pince le capteur de force très fort)")
    print("3. Simuler le sommeil (Incline le capteur Tilt)")
    print("4. Passer la clé magnétique du médecin (Acquittement alarme)")
    print("0. Quitter")
    
    choix = input("Choisis une action : ")
    
    if choix == "1":
        envoyer(TOPIC_TELEMETRIE, {"force": 200, "tilt": 0})
    elif choix == "2":
        # Le stress élevé (ex: 950) va réveiller ton NPU et déclencher la crise !
        envoyer(TOPIC_TELEMETRIE, {"force": 950, "tilt": 0})
    elif choix == "3":
        envoyer(TOPIC_TELEMETRIE, {"force": 150, "tilt": 1})
    elif choix == "4":
        envoyer(TOPIC_BADGE, {"action": "unlock"})
    elif choix == "0":
        break