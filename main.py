import asyncio
import os
from pathlib import Path
import httpx
from fastapi import FastAPI, WebSocket, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI()
FRONTEND_FILE = Path(__file__).resolve().parent / "front" / "index.html"

# Autoriser le Front-End à communiquer avec cette API locale
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)


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

# Modèles de données pour valider ce qu'envoie l'ESP8266
class Telemetrie(BaseModel):
    """Valeurs brutes lues par l'ESP8266 et envoyées par Wi-Fi."""

    force: int = Field(ge=0, le=1023)
    tilt: int = Field(ge=0, le=1)
    button: int = Field(default=0, ge=0, le=1)
    magnetic: int = Field(default=0, ge=0, le=1)

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
    """Adapte l'état interne au contrat consommé par le dashboard."""
    return {
        "type": "crew_state",
        "crew": [
            {
                "crewId": index,
                "name": astronaute["nom"],
                "vitals": {
                    "force": min(100, round(astronaute["stress"] / 10)),
                    "tiltStatus": "repos" if astronaute["sommeil"] == "couché" else "actif",
                    "sos": astronaute.get("sos", 0),
                    "magnetic": astronaute.get("magnetic", 0),
                },
                "contaminated": astronaute["statut"] == "quarantaine",
            }
            for index, astronaute in enumerate(crew_state.values())
        ],
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
    etat_sommeil = "couché" if data.tilt == 1 else "actif"

    crew_state["badge_1"]["stress"] = data.force
    crew_state["badge_1"]["sommeil"] = etat_sommeil
    crew_state["badge_1"]["sos"] = data.button
    crew_state["badge_1"]["magnetic"] = data.magnetic

    if data.magnetic == 1:
        await acquitter_alarme()
        return {"status": "quarantaine_levee", "source": "capteur_magnetique"}

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
        print(f"Diagnostic IA : {diag} -> Statut : {statut}")
        
        # On vérifie la crise en arrière-plan pour ne pas bloquer la réponse HTTP de l'ESP
        background_tasks.add_task(verifier_crise_et_alerter)

    return {"status": "reçu"}

@app.post("/api/badge_medecin")
async def acquitter_alarme():
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

    return {"status": "quarantaine_levee"}

# --- 5. ROUTES API POUR LE FRONT-END ---
@app.get("/api/equipage")
def get_equipage():
    """Route pour que le Front-End récupère l'état initial."""
    return crew_state

@app.websocket("/ws/telemetrie")
async def websocket_endpoint(websocket: WebSocket):
    """Envoi en temps réel des données au Front-End pour la Data-Viz."""
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(etat_frontend())
            await asyncio.sleep(1) # Rafraîchissement toutes les secondes
    except Exception:
        print("Front-end deconnecte du WebSocket.")