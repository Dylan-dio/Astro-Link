import json
import asyncio
import os
from typing import Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import paho.mqtt.client as mqtt
from optimum.intel import OVModelForCausalLM
from transformers import AutoTokenizer


app = FastAPI()

# Autoriser le Front-End local à communiquer avec cette API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

model_id = "./llama_openvino_model"
tokenizer = None
model: Any = None
if os.path.isdir(model_id) and os.getenv("DISABLE_LOCAL_AI") != "1":
    print("Chargement de l'IA sur l'Intel AI Boost (NPU)...")
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = OVModelForCausalLM.from_pretrained(model_id, device="NPU")
else:
    print("Modèle OpenVINO absent : analyse IA locale désactivée.")

# 1. BASE DE DONNÉES LOCALE (État de l'équipage)
# On simule 5 membres. 1 infecté = 20% (ce qui déclenche la crise des 15%)
crew_state = {
    "astronaute_1": {"nom": "Cmdr. Shepard", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "astronaute_2": {"nom": "Dr. Chakwas", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "astronaute_3": {"nom": "Pilote Moreau", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "astronaute_4": {"nom": "Ing. Tali", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "astronaute_5": {"nom": "Spécialiste Garrus", "stress": 0, "sommeil": "actif", "statut": "sain"}
}

websocket_clients: set[WebSocket] = set()


def etat_frontend() -> dict:
    """Convertit l'état Python en messages consommables par le dashboard."""
    equipage = []
    for index, astronaute in enumerate(crew_state.values()):
        equipage.append({
            "crewId": index,
            "name": astronaute["nom"],
            "vitals": {
                "force": round(float(astronaute["stress"]) / 10, 1),
                "tiltStatus": "repos" if astronaute["sommeil"] == "couché" else "actif",
            },
            "contaminated": astronaute["statut"] == "quarantaine",
        })
    return {"type": "crew_state", "crew": equipage}

# 2. LOGIQUE DE CRISE (Le Scénario des 15%)
def verifier_crise():
    infectes = sum(1 for a in crew_state.values() if a["statut"] == "quarantaine")
    pourcentage = (infectes / len(crew_state)) * 100
    
    if pourcentage >= 15:
        print(f"⚠️ ALERTE CRITIQUE : {pourcentage}% de l'équipage contaminé !")
        # Ordre à l'ESP8266 de sonner l'alarme et d'allumer la LED RVB en rouge
        publier_commande({"led": "rouge", "buzzer": "on"})
        return True
    return False

# 3. L'IA LOCALE (OpenVINO sur NPU)
def analyser_symptomes_ia(nom, force_stress, etat_sommeil):
    if model is None or tokenizer is None:
        return "Analyse IA indisponible dans cet environnement.", "sain"
    prompt = f"Patient {nom}. Stress: {force_stress}. Sommeil: {etat_sommeil}. Diagnostic court et statut (quarantaine ou sain) :"
    inputs = tokenizer(prompt, return_tensors="pt")

    # Génération de la réponse via le NPU
    outputs = model.generate(**inputs, max_new_tokens=50)
    analyse = tokenizer.decode(outputs[0], skip_special_tokens=True)
    
    # Détection simpliste du mot-clé pour le prototype
    nouveau_statut = "quarantaine" if "quarantaine" in analyse.lower() else "sain"
    return analyse, nouveau_statut

# 4. LE CLIENT MQTT (Communication avec l'ESP8266)
def on_connect(client, userdata, flags, rc):
    print("Connecté au Broker MQTT local !")
    client.subscribe("vaisseau/badge/1/telemetrie")
    client.subscribe("vaisseau/badge/1/badge_medecin")

def on_message(client, userdata, msg):
    topic = msg.topic
    try:
        payload = json.loads(msg.payload.decode())
    except (UnicodeDecodeError, json.JSONDecodeError):
        print(f"Message MQTT ignoré (JSON invalide) : {topic}")
        return
    
    if topic == "vaisseau/badge/1/telemetrie":
        # Récupération des données matérielles
        force_val = max(0, min(int(payload.get("force", 0)), 1023))
        tilt_val = payload.get("tilt", 0)
        
        etat_sommeil = "couché" if tilt_val == 1 else "actif"
        crew_state["astronaute_1"]["stress"] = force_val
        crew_state["astronaute_1"]["sommeil"] = etat_sommeil
        
        # Si le stress est très élevé, on déclenche une analyse IA
        if force_val > 800:
            print("Pic de stress détecté, analyse IA en cours...")
            diag, statut = analyser_symptomes_ia("Cmdr. Shepard", force_val, etat_sommeil)
            crew_state["astronaute_1"]["statut"] = statut
            verifier_crise()

    elif topic == "vaisseau/badge/1/badge_medecin":
        # Le capteur magnétique a détecté la clé du médecin
        print("Clé médicale détectée. Levée de la quarantaine.")
        for astronaute in crew_state.values():
            astronaute["statut"] = "sain"
        publier_commande({"led": "vert", "buzzer": "off"})

mqtt_client = mqtt.Client()
mqtt_connecte = False
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message


def publier_commande(commande):
    if mqtt_connecte:
        mqtt_client.publish("vaisseau/badge/1/commande", json.dumps(commande))


# L'IP peut être fournie par MQTT_HOST/MQTT_PORT quand Mosquitto tourne sur une autre machine.
mqtt_hote = os.getenv("MQTT_HOST", "127.0.0.1")
mqtt_port = int(os.getenv("MQTT_PORT", "1883"))
try:
    mqtt_client.connect(mqtt_hote, mqtt_port, 60)
    mqtt_client.loop_start()
    mqtt_connecte = True
except OSError as erreur:
    print(f"MQTT indisponible ({mqtt_hote}:{mqtt_port}) : {erreur}")
    print("L'API démarre sans télémétrie MQTT. Lancez Mosquitto pour l'activer.")

# 5. ROUTES API & WEBSOCKETS (Pour le Dev Front-End)
@app.get("/api/equipage")
def get_equipage():
    return crew_state

@app.post("/api/psychospace/questionnaire")
def soumettre_questionnaire(data: dict):
    astronaute = crew_state["astronaute_1"]
    for champ in ("stress", "sommeil", "fatigue", "humeur", "isolement"):
        if champ in data:
            astronaute[champ] = data[champ]
    if astronaute.get("stress", 0) >= 80:
        astronaute["statut"] = "quarantaine"
        verifier_crise()
    return {"status": "ok", "message": "Données psychologiques enregistrées.", "state": etat_frontend()}

@app.websocket("/ws/telemetrie")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    websocket_clients.add(websocket)
    try:
        await websocket.send_json(etat_frontend())
        while True:
            await websocket.send_json(etat_frontend())
            await asyncio.sleep(1)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        websocket_clients.discard(websocket)
        print("Front-End déconnecté")


if os.path.isdir("front"):
    app.mount("/", StaticFiles(directory="front", html=True), name="front")