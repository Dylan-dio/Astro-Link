import asyncio
import os
import time
from pathlib import Path
import httpx
from fastapi import FastAPI, WebSocket, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

app = FastAPI()
FRONTEND_FILE = Path(__file__).resolve().parent / "front" / "index.html"
FRONTEND_ASSETS = FRONTEND_FILE.parent / "assets"

# Autoriser le Front-End à communiquer avec cette API locale
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS), name="frontend-assets")


@app.get("/", include_in_schema=False)
def serve_frontend():
    """Serve the local dashboard from the same origin as the API."""
    return FileResponse(FRONTEND_FILE)

# --- CONFIGURATION RÉSEAU ESP8266 ---
# L'IP par défaut d'un ESP8266 qui crée son propre réseau Wi-Fi (SoftAP)
ESP_BASE_URL = "http://192.168.4.1"

# --- 1. CONFIGURATION DE L'IA LOCALE ---
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:1b")

# --- 2. BASE DE DONNÉES LOCALE (L'équipage) ---
crew_state = {
    "badge_1": {"nom": "Cmdr. Shepard", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "badge_2": {"nom": "Dr. Chakwas", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "badge_3": {"nom": "Pilote Moreau", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "badge_4": {"nom": "Ing. Tali", "stress": 0, "sommeil": "actif", "statut": "sain"},
    "badge_5": {"nom": "Spécialiste Garrus", "stress": 0, "sommeil": "actif", "statut": "sain"}
}
telemetry_history = {badge_id: [] for badge_id in crew_state}
diagnostics_history = {badge_id: [] for badge_id in crew_state}
chat_history = {badge_id: [] for badge_id in crew_state}
websocket_clients = set()
magnetic_was_detected = False
last_telemetry_at = None
telemetry_count = 0

# Modèles de données pour valider ce qu'envoie l'ESP8266
class Telemetrie(BaseModel):
    """Valeurs brutes lues par l'ESP8266 et envoyées par Wi-Fi."""

    force: int = Field(ge=0, le=1023)
    tilt: int = Field(ge=0, le=1)
    button: int = Field(default=0, ge=0, le=1)
    magnetic: int = Field(default=0, ge=0, le=1)
    heartRate: int = Field(default=0, ge=0, le=250)

class ChatRequest(BaseModel):
    crewId: str
    message: str = Field(min_length=1, max_length=2000)

# --- 3. FONCTIONS MÉTIER (IA & Crise) ---
async def analyser_symptomes_ia(nom, force_stress, etat_sommeil):
    prompt = f"Patient {nom}. Stress mesuré: {force_stress}. État: {etat_sommeil}. Donne un diagnostic court et dis s'il faut une 'quarantaine' ou s'il est 'sain' :"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
        analyse = response.json()["response"].strip()
        print(f"Diagnostic Ollama ({OLLAMA_MODEL}) : {analyse}")
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
        print(f"[WARN] Ollama indisponible ({error}). Utilisation de l'analyse de secours.")
        analyse = "Analyse simulée: Détresse détectée."

    statut = "quarantaine" if force_stress > 800 or "quarantaine" in analyse.lower() else "sain"
    return analyse, statut


def etat_frontend():
    """Construit la liste d'équipage et la télémétrie au format du dashboard."""
    return {
        "type": "crew_list",
        "crew": [
            {
                "id": badge_id,
                "badgeId": badge_id.replace("badge_", "AL-").upper(),
                "name": astronaute["nom"],
                "isRealBadge": badge_id == "badge_1",
                "healthLevel": "red" if astronaute["statut"] == "quarantaine" else "green",
                "contaminated": astronaute["statut"] == "quarantaine",
            }
            for badge_id, astronaute in crew_state.items()
        ],
    }

def telemetry_event(badge_id):
    astronaut = crew_state[badge_id]
    return {
        "type": "telemetry",
        "crewId": badge_id,
        "ts": int(time.time() * 1000),
        "vitals": {
            "force": min(100, round(astronaut["stress"] / 10)),
            "tilt": "repos" if astronaut["sommeil"] == "couché" else "actif",
            "sos": astronaut.get("sos", 0),
            "magnetic": astronaut.get("magnetic", 0),
            "heartRate": astronaut.get("heartRate", 0),
        },
        "contaminated": astronaut["statut"] == "quarantaine",
        "healthLevel": "red" if astronaut["statut"] == "quarantaine" else "green",
    }

async def broadcast(message):
    disconnected = []
    for client in websocket_clients:
        try:
            await client.send_json(message)
        except Exception:
            disconnected.append(client)
    for client in disconnected:
        websocket_clients.discard(client)

def crew_member(badge_id):
    astronaut = crew_state[badge_id]
    return {
        "id": badge_id,
        "badgeId": badge_id.replace("badge_", "AL-").upper(),
        "name": astronaut["nom"],
        "role": "Équipage",
        "isRealBadge": badge_id == "badge_1",
        "healthLevel": "red" if astronaut["statut"] == "quarantaine" else "green",
        "contaminated": astronaut["statut"] == "quarantaine",
    }

def crisis_payload():
    infected = [badge_id for badge_id, a in crew_state.items() if a["statut"] == "quarantaine"]
    rate = len(infected) / len(crew_state)
    return {
        "active": rate >= 0.15,
        "contaminationRate": rate,
        "triage": [
            {"crewId": badge_id, "priority": 1, "reason": "Contamination déclarée"}
            for badge_id in infected
        ],
        "since": int(time.time() * 1000) if infected else None,
    }

async def verifier_crise_et_alerter():
    infectes = sum(1 for a in crew_state.values() if a["statut"] == "quarantaine")
    pourcentage = (infectes / len(crew_state)) * 100

    # Vérification du seuil critique de 15% imposé par le sujet
    if pourcentage >= 15:
        print(f"[ALERTE] {pourcentage}% de l'equipage contamine.")
        # Envoi de la requête HTTP asynchrone vers l'ESP8266 pour déclencher les actionneurs
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{ESP_BASE_URL}/alerte",
                    json={"led": "rouge", "buzzer": "on"},
                    timeout=2.0
                )
                print("[OK] Ordre de quarantaine envoye au Bio-Badge.")
            except httpx.RequestError:
                print("[WARN] ESP8266 injoignable; alerte conservee cote serveur.")

# --- 4. ROUTES API POUR L'ESP8266 ---
@app.post("/api/telemetrie")
async def recevoir_telemetrie(data: Telemetrie, background_tasks: BackgroundTasks):
    """Reçoit exclusivement les mesures des capteurs de l'ESP8266."""
    global last_telemetry_at, telemetry_count
    last_telemetry_at = int(time.time() * 1000)
    telemetry_count += 1
    etat_sommeil = "couché" if data.tilt == 1 else "actif"

    crew_state["badge_1"]["stress"] = data.force
    crew_state["badge_1"]["sommeil"] = etat_sommeil
    crew_state["badge_1"]["sos"] = data.button
    crew_state["badge_1"]["magnetic"] = data.magnetic
    crew_state["badge_1"]["heartRate"] = data.heartRate
    telemetry_history["badge_1"].append(telemetry_event("badge_1")["vitals"] | {"ts": int(time.time() * 1000)})
    telemetry_history["badge_1"] = telemetry_history["badge_1"][-600:]
    await broadcast(telemetry_event("badge_1"))

    global magnetic_was_detected
    if data.magnetic == 1 and not magnetic_was_detected:
        magnetic_was_detected = True
        await broadcast({"type": "hall_sensor", "crewId": "badge_1", "detected": True})
        await acquitter_alarme("hall_sensor")
        return {"status": "quarantaine_levee", "source": "capteur_magnetique"}
    magnetic_was_detected = data.magnetic == 1

    if data.button == 1:
        print("[ALERTE] Bouton SOS physique activé.")
        async with httpx.AsyncClient() as client:
            try:
                await client.post(
                    f"{ESP_BASE_URL}/alerte",
                    json={"led": "rouge", "buzzer": "on"},
                    timeout=2.0,
                )
            except httpx.RequestError as error:
                print(f"[WARN] ESP8266 injoignable pour l'alarme SOS : {error}")
        return {"status": "sos_actif"}

    # Si l'astronaute pince très fort le capteur de force (signe de panique/douleur)
    if data.force > 800:
        print(f"Pic de stress ({data.force}) detecte; lancement de l'analyse IA locale...")
        diag, statut = await analyser_symptomes_ia("Cmdr. Shepard", data.force, etat_sommeil)
        crew_state["badge_1"]["statut"] = statut
        diagnostic = {
            "id": f"telemetry-{last_telemetry_at}",
            "ts": last_telemetry_at,
            "source": "capteur_force",
            "summary": diag,
            "hypotheses": [],
            "urgency": "critical" if statut == "quarantaine" else "medium",
        }
        diagnostics_history["badge_1"].append(diagnostic)
        diagnostics_history["badge_1"] = diagnostics_history["badge_1"][-50:]
        print(f"Diagnostic IA : {diag} -> Statut : {statut}")
        
        # On vérifie la crise en arrière-plan pour ne pas bloquer la réponse HTTP de l'ESP
        background_tasks.add_task(verifier_crise_et_alerter)
        await broadcast({"type": "crisis", **crisis_payload()})
        await broadcast({"type": "diagnostic", "crewId": "badge_1", "diagnostic": diagnostic})

    return {"status": "reçu"}

@app.post("/api/badge_medecin")
async def acquitter_alarme(reason: str = "manual_override"):
    """Acquitte l'alarme après détection de la clé magnétique de l'ESP."""
    print("Cle medicale detectee. Quarantaine levee pour l'equipage.")
    for astronaute in crew_state.values():
        astronaute["statut"] = "sain"

    # On éteint l'alarme sur le badge
    async with httpx.AsyncClient() as client:
        try:
            await client.post(f"{ESP_BASE_URL}/alerte", json={"led": "vert", "buzzer": "off"})
        except httpx.RequestError as error:
            print(f"[WARN] ESP8266 injoignable pour l'acquittement : {error}")

    await broadcast(etat_frontend())
    await broadcast({"type": "crisis_resolved", "by": reason})
    return {"status": "quarantaine_levee"}

# --- 5. ROUTES API POUR LE FRONT-END ---
@app.get("/api/equipage")
def get_equipage():
    """Route pour que le Front-End récupère l'état initial."""
    return crew_state

@app.get("/api/health")
async def health():
    """Expose l'état réel du backend, d'Ollama et de la dernière télémétrie."""
    ollama_status = "offline"
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            response.raise_for_status()
            models = response.json().get("models", [])
            ollama_status = (
                "ok"
                if any(model.get("name") == OLLAMA_MODEL for model in models)
                else "model_missing"
            )
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        pass

    return {
        "status": "ok",
        "version": "1.0",
        "ollama": ollama_status,
        "ollamaModel": OLLAMA_MODEL,
        "telemetry": {
            "received": telemetry_count > 0,
            "count": telemetry_count,
            "lastAt": last_telemetry_at,
        },
    }

@app.post("/api/ia/test")
async def test_ia():
    """Teste Ollama sans modifier l'état de l'équipage."""
    analyse, statut = await analyser_symptomes_ia("Test Astro-Link", 950, "actif")
    return {
        "ok": not analyse.startswith("Analyse simulée:"),
        "model": OLLAMA_MODEL,
        "response": analyse,
        "status": statut,
    }

@app.get("/api/crew")
def get_crew():
    return [crew_member(badge_id) for badge_id in crew_state]

@app.get("/api/crew/{badge_id}")
def get_member(badge_id: str):
    if badge_id not in crew_state:
        raise HTTPException(status_code=404, detail="Membre introuvable")
    return crew_member(badge_id)

@app.get("/api/crew/{badge_id}/telemetry")
def get_telemetry(badge_id: str):
    return {"points": telemetry_history.get(badge_id, [])}

@app.get("/api/crew/{badge_id}/checkins")
def get_checkins(badge_id: str):
    return []

@app.get("/api/crew/{badge_id}/chat")
def get_chat(badge_id: str):
    if badge_id not in crew_state:
        raise HTTPException(status_code=404, detail="Membre introuvable")
    return chat_history.get(badge_id, [])

@app.post("/api/chat")
async def chat(data: ChatRequest):
    if data.crewId not in crew_state:
        raise HTTPException(status_code=404, detail="Membre introuvable")

    now = int(time.time() * 1000)
    chat_history[data.crewId].append(
        {"role": "user", "text": data.message, "ts": now}
    )
    chat_history[data.crewId] = chat_history[data.crewId][-50:]

    prompt = (
        "Tu es l'assistant médical local d'un équipage spatial. "
        "Réponds en français, de façon concise et prudente. "
        "Tu ne remplaces pas un médecin. Ne donne pas de diagnostic certain. "
        "Propose une prochaine question ou une action simple si nécessaire.\n"
        f"Patient: {crew_state[data.crewId]['nom']}\n"
        f"Message: {data.message}"
    )
    try:
        async with httpx.AsyncClient(timeout=80.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
            reply = response.json()["response"].strip()
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as error:
        print(f"[ERROR] Chat Ollama indisponible : {error}")
        raise HTTPException(
            status_code=503,
            detail="Le modèle local Ollama est indisponible.",
        ) from error

    result = {
        "reply": reply,
        "hypotheses": [],
        "urgency": "low",
        "followUp": None,
        "ts": int(time.time() * 1000),
    }
    chat_history[data.crewId].append(
        {"role": "ai", "text": reply, "ts": result["ts"]}
    )
    chat_history[data.crewId] = chat_history[data.crewId][-50:]
    return result

@app.get("/api/crew/{badge_id}/diagnostics")
def get_diagnostics(badge_id: str):
    return diagnostics_history.get(badge_id, [])

@app.get("/api/crew/{badge_id}/recommendations")
def get_recommendations(badge_id: str):
    return []

@app.post("/api/crew/{badge_id}/contamination")
async def set_contamination(badge_id: str, data: dict):
    if badge_id not in crew_state:
        raise HTTPException(status_code=404, detail="Membre introuvable")
    crew_state[badge_id]["statut"] = "quarantaine" if data.get("contaminated") else "sain"
    await broadcast({"type": "crew_update", "crew": crew_member(badge_id)})
    if crisis_payload()["active"]:
        await broadcast({"type": "crisis", **crisis_payload()})
    return crew_member(badge_id)

@app.get("/api/alerts")
def get_alerts():
    return []

@app.get("/api/crisis")
def get_crisis():
    return crisis_payload()

@app.post("/api/crisis/acknowledge")
async def acknowledge_crisis():
    result = await acquitter_alarme("manual_override")
    return {"ok": True, **result}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Flux temps réel conforme au contrat du nouveau front."""
    await websocket.accept()
    websocket_clients.add(websocket)
    try:
        await websocket.send_json(etat_frontend())
        await websocket.send_json(telemetry_event("badge_1"))
        while True:
            await asyncio.sleep(30)
    except Exception:
        print("Front-end deconnecte du WebSocket.")
    finally:
        websocket_clients.discard(websocket)

@app.websocket("/ws/telemetrie")
async def legacy_websocket_endpoint(websocket: WebSocket):
    await websocket_endpoint(websocket)