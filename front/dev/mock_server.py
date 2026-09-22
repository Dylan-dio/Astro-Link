"""
Horizon Health OS — Simulateur de Back-End (DÉVELOPPEMENT UNIQUEMENT)
=====================================================================

Ce serveur imite le futur Back-End Python pour tester le front sans attendre
le vrai serveur. Il respecte à 100 % le contrat décrit dans
docs/API_CONTRACT.md : le vrai Back-End peut reprendre sa structure.

⚠ Les profils et mesures générés ici sont FICTIFS. Le front lui-même ne
contient aucune donnée : tout vient du serveur auquel il est connecté.

Lancement :
    cd front/dev
    pip install -r requirements.txt
    python mock_server.py
Puis ouvrir http://localhost:8000 (le serveur sert aussi le front).

Simulations utiles pour la démo :
    POST /api/dev/hall/{crew_id}   → passage de la clé aimantée sur un badge
"""

import asyncio
import math
import random
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

FRONT_DIR = Path(__file__).resolve().parent.parent
CONTAMINATION_THRESHOLD = 0.15
TELEMETRY_PERIOD_S = 2.0


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------------------
# Données fictives de démonstration
# ---------------------------------------------------------------------------
CREW: dict[str, dict] = {
    "astro-001": {"id": "astro-001", "badgeId": "AL-001", "name": "Cdt. Elena Voss", "role": "Commandante", "specialty": "Pilotage et systèmes de vol",
                  "age": 44, "sex": "F", "bloodType": "A+", "nationality": "Allemande", "heightCm": 171, "weightKg": 63,
                  "allergies": ["Pénicilline"], "treatments": [], "medicalNotes": "Entorse cheville droite en 2076, rétablie.", "isRealBadge": True},
    "astro-002": {"id": "astro-002", "badgeId": "AL-002", "name": "Dr. Malik Haddad", "role": "Médecin de bord", "specialty": "Médecine d'urgence",
                  "age": 39, "sex": "M", "bloodType": "O-", "nationality": "Française", "heightCm": 182, "weightKg": 78,
                  "allergies": [], "treatments": [], "medicalNotes": None, "isRealBadge": False},
    "astro-003": {"id": "astro-003", "badgeId": "AL-003", "name": "Ing. Sofia Renn", "role": "Ingénieure systèmes", "specialty": "Support vie et recyclage",
                  "age": 35, "sex": "F", "bloodType": "B+", "nationality": "Suédoise", "heightCm": 166, "weightKg": 58,
                  "allergies": ["Arachides"], "treatments": ["Mélatonine 2 mg le soir"], "medicalNotes": "Troubles du sommeil signalés en phase de transit.", "isRealBadge": False},
    "astro-004": {"id": "astro-004", "badgeId": "AL-004", "name": "Sgt. Théo Bakker", "role": "Pilote", "specialty": "Navigation interstellaire",
                  "age": 31, "sex": "M", "bloodType": "AB+", "nationality": "Néerlandaise", "heightCm": 188, "weightKg": 84,
                  "allergies": [], "treatments": [], "medicalNotes": None, "isRealBadge": False},
    "astro-005": {"id": "astro-005", "badgeId": "AL-005", "name": "Dr. Amara Chen", "role": "Biologiste", "specialty": "Microbiologie spatiale",
                  "age": 41, "sex": "F", "bloodType": "O+", "nationality": "Canadienne", "heightCm": 162, "weightKg": 55,
                  "allergies": ["Latex"], "treatments": [], "medicalNotes": None, "isRealBadge": False},
}

CONTAMINATED: dict[str, bool] = {cid: False for cid in CREW}
TELEMETRY: dict[str, list] = {cid: [] for cid in CREW}
CHECKINS: dict[str, list] = {cid: [] for cid in CREW}
DIAGNOSTICS: dict[str, list] = {cid: [] for cid in CREW}
RECOMMENDATIONS: dict[str, list] = {cid: [] for cid in CREW}
CHATS: dict[str, list] = {cid: [] for cid in CREW}
ALERTS: list[dict] = []
CRISIS = {"active": False, "since": None, "triage": [], "contaminationRate": 0.0, "acknowledged": False}

SIM = {cid: {"force": random.uniform(15, 45), "tilt": "actif", "temp": 36.7, "hr": random.uniform(62, 78)} for cid in CREW}


def seed_history() -> None:
    """Pré-remplit 6 h de télémétrie et 10 jours de check-ins pour avoir des courbes."""
    t = now_ms()
    for cid in CREW:
        force = random.uniform(20, 40)
        tilt = "actif"
        for i in range(72, 0, -1):  # un point toutes les 5 minutes
            force = max(2, min(95, force + random.uniform(-8, 8)))
            if random.random() < 0.15:
                tilt = "repos" if tilt == "actif" else "actif"
            TELEMETRY[cid].append({"ts": t - i * 300_000, "force": round(force, 1), "tilt": tilt,
                                   "temperature": round(random.uniform(36.4, 37.0), 1), "heartRate": round(random.uniform(60, 85))})
        base = {k: random.uniform(40, 70) for k in ("sommeil", "humeur", "fatigue", "stress", "isolement")}
        for d in range(10, 0, -1):
            ck = {k: round(max(0, min(100, v + random.uniform(-15, 15)))) for k, v in base.items()}
            CHECKINS[cid].append({"id": str(uuid.uuid4()), "crewId": cid, "ts": t - d * 86_400_000, **ck, "note": None})


# ---------------------------------------------------------------------------
# WebSocket : diffusion à tous les écrans connectés
# ---------------------------------------------------------------------------
class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def broadcast(self, message: dict) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()


# ---------------------------------------------------------------------------
# Logique métier simulée
# ---------------------------------------------------------------------------
def latest_vitals(cid: str) -> Optional[dict]:
    return TELEMETRY[cid][-1] if TELEMETRY[cid] else None


def latest_checkin(cid: str) -> Optional[dict]:
    return CHECKINS[cid][-1] if CHECKINS[cid] else None


def health_level(cid: str) -> str:
    if CONTAMINATED[cid]:
        return "red"
    v, c = latest_vitals(cid), latest_checkin(cid)
    score = max((v or {}).get("force", 0), (c or {}).get("stress", 0))
    return "orange" if score >= 60 else "green"


def member(cid: str) -> dict:
    return {**CREW[cid], "contaminated": CONTAMINATED[cid], "healthLevel": health_level(cid),
            "latestVitals": latest_vitals(cid), "latestCheckin": latest_checkin(cid)}


def contamination_rate() -> float:
    return sum(CONTAMINATED.values()) / len(CREW)


def compute_triage() -> list[dict]:
    rows = []
    for cid in CREW:
        v = latest_vitals(cid) or {}
        if CONTAMINATED[cid]:
            prio, reason = 1, f"Contaminé — température {v.get('temperature', '?')} °C"
        elif health_level(cid) == "orange":
            prio, reason = 2, "Anxiété élevée — surveillance rapprochée"
        else:
            prio, reason = 3, "Constantes nominales — isolement préventif"
        rows.append({"crewId": cid, "priority": prio, "reason": reason})
    return sorted(rows, key=lambda r: r["priority"])


async def add_alert(level: str, message: str, crew_id: Optional[str] = None) -> None:
    alert = {"id": str(uuid.uuid4()), "ts": now_ms(), "level": level, "message": message, "crewId": crew_id}
    ALERTS.insert(0, alert)
    del ALERTS[200:]
    await hub.broadcast({"type": "alert", **alert})


async def badge_command(cid: str, led: str, buzzer: str) -> None:
    """Dans le vrai système : publication MQTT sur astrolink/{badgeId}/command."""
    await hub.broadcast({"type": "badge_command", "crewId": cid, "led": led, "buzzer": buzzer, "ts": now_ms()})


async def evaluate_crisis() -> None:
    rate = contamination_rate()
    CRISIS["contaminationRate"] = rate
    if rate >= CONTAMINATION_THRESHOLD and not CRISIS["active"] and not CRISIS["acknowledged"]:
        CRISIS.update(active=True, since=now_ms(), triage=compute_triage())
        await hub.broadcast({"type": "crisis", "contaminationRate": rate, "triage": CRISIS["triage"], "since": CRISIS["since"], "ts": now_ms()})
        await add_alert("critical", f"Seuil de contamination atteint ({round(rate * 100)} %) — protocole de quarantaine engagé")
        for cid in CREW:
            if CONTAMINATED[cid]:
                await badge_command(cid, "red_blink", "alarm")
            else:
                await badge_command(cid, "green", "off")
    elif rate < CONTAMINATION_THRESHOLD:
        CRISIS["acknowledged"] = False
        if CRISIS["active"]:
            await resolve_crisis("threshold")


async def resolve_crisis(by: str) -> None:
    CRISIS.update(active=False, triage=[], acknowledged=True)
    await hub.broadcast({"type": "crisis_resolved", "by": by, "ts": now_ms()})
    await add_alert("info", "Alarme de quarantaine acquittée" + (" par la clé du médecin" if by == "hall_sensor" else ""))
    for cid in CREW:
        await badge_command(cid, "red" if CONTAMINATED[cid] else "green", "off")


def recommendations_for(ck: dict) -> list[dict]:
    recos = []
    if ck.get("stress", 0) >= 60:
        recos.append({"title": "Séance de cohérence cardiaque", "description": "10 minutes de respiration guidée avant la prochaine tâche.", "category": "Gestion du stress"})
    if ck.get("fatigue", 0) >= 60:
        recos.append({"title": "Repos supplémentaire", "description": "Décaler la prochaine tâche non critique de 45 minutes.", "category": "Récupération"})
    if ck.get("isolement", 0) >= 55:
        recos.append({"title": "Temps d'échange avec l'équipage", "description": "Partager le prochain repas avec un autre membre de l'équipage.", "category": "Lien social"})
    if ck.get("humeur", 100) <= 45:
        recos.append({"title": "Session de luminothérapie", "description": "Exposition lumineuse de 20 minutes en fin de cycle de repos.", "category": "Moral"})
    if ck.get("sommeil", 100) <= 45:
        recos.append({"title": "Ajuster le créneau de sommeil", "description": "Avancer le coucher de 30 minutes et limiter les écrans.", "category": "Sommeil"})
    return recos or [{"title": "Aucune action requise", "description": "Vos indicateurs sont dans la plage nominale.", "category": "Suivi"}]


def analyse_symptoms(text: str) -> dict:
    """Remplacé dans le vrai Back-End par un appel à Ollama (voir API_CONTRACT.md)."""
    t = text.lower()
    hyps, urgency = [], "low"
    if any(k in t for k in ("tête", "migraine")):
        hyps.append({"label": "Céphalée de tension", "confidence": 0.55})
    if any(k in t for k in ("touss", "gorge")):
        hyps.append({"label": "Irritation des voies respiratoires (air recyclé)", "confidence": 0.45})
    if any(k in t for k in ("fièvre", "chaud", "frisson")):
        hyps.append({"label": "Syndrome fébrile infectieux", "confidence": 0.6})
        urgency = "medium"
    if any(k in t for k in ("poitrine", "respir", "essouffl")):
        hyps.append({"label": "Détresse respiratoire à évaluer", "confidence": 0.5})
        urgency = "high"
    if any(k in t for k in ("fatigu", "dors", "sommeil")):
        hyps.append({"label": "Dette de sommeil liée au cycle circadien", "confidence": 0.5})
    if not hyps:
        hyps.append({"label": "Symptômes non spécifiques", "confidence": 0.3})
    return {
        "reply": "Voici mon analyse préliminaire de vos symptômes.",
        "hypotheses": hyps,
        "urgency": urgency,
        "followUp": "Depuis combien de temps ressentez-vous ces symptômes, et quelle est leur intensité de 1 à 10 ?",
    }


async def telemetry_loop() -> None:
    while True:
        await asyncio.sleep(TELEMETRY_PERIOD_S)
        for cid in CREW:
            s = SIM[cid]
            s["force"] = max(2, min(98, s["force"] + random.uniform(-7, 7) + (4 if CONTAMINATED[cid] else 0) * random.random()))
            if random.random() < 0.05:
                s["tilt"] = "repos" if s["tilt"] == "actif" else "actif"
            target = 38.9 if CONTAMINATED[cid] else 36.7
            s["temp"] += (target - s["temp"]) * 0.1 + random.uniform(-0.05, 0.05)
            s["hr"] = max(50, min(140, s["hr"] + random.uniform(-3, 3) + (1.5 if CONTAMINATED[cid] else 0)))
            point = {"ts": now_ms(), "force": round(s["force"], 1), "tilt": s["tilt"],
                     "temperature": round(s["temp"], 1), "heartRate": round(s["hr"])}
            TELEMETRY[cid].append(point)
            del TELEMETRY[cid][:-2000]
            await hub.broadcast({"type": "telemetry", "crewId": cid, "badgeId": CREW[cid]["badgeId"],
                                 "vitals": {k: v for k, v in point.items() if k != "ts"},
                                 "healthLevel": health_level(cid), "contaminated": CONTAMINATED[cid], "ts": point["ts"]})
            if s["force"] >= 90 and random.random() < 0.1:
                await add_alert("warning", "Pic d'anxiété détecté par le capteur de force", cid)


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_: FastAPI):
    seed_history()
    task = asyncio.create_task(telemetry_loop())
    yield
    task.cancel()


app = FastAPI(title="Horizon Health OS — simulateur", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def require(cid: str) -> str:
    if cid not in CREW:
        raise HTTPException(404, "Membre d'équipage inconnu")
    return cid


class CheckinIn(BaseModel):
    crewId: str
    sommeil: int = Field(ge=0, le=100)
    humeur: int = Field(ge=0, le=100)
    fatigue: int = Field(ge=0, le=100)
    stress: int = Field(ge=0, le=100)
    isolement: int = Field(ge=0, le=100)
    note: Optional[str] = None
    ts: Optional[str] = None


class ChatIn(BaseModel):
    crewId: str
    message: str = Field(min_length=1, max_length=2000)


class ContaminationIn(BaseModel):
    contaminated: bool


class LoginIn(BaseModel):
    username: str
    password: str


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "mock-1.0", "ollama": "simulé", "time": now_ms()}


@app.post("/api/auth/login")
async def login(body: LoginIn):
    if body.password != "medecin":
        raise HTTPException(401, "Identifiants refusés")
    return {"token": str(uuid.uuid4()), "user": {"name": body.username, "role": "medecin"}}


@app.get("/api/crew")
async def crew_list():
    return [member(cid) for cid in CREW]


@app.get("/api/crew/{cid}")
async def crew_detail(cid: str):
    return member(require(cid))


@app.get("/api/crew/{cid}/telemetry")
async def crew_telemetry(cid: str, range: str = "6h"):
    require(cid)
    hours = float(range.rstrip("h")) if range.endswith("h") else 6.0
    since = now_ms() - hours * 3_600_000
    pts = [p for p in TELEMETRY[cid] if p["ts"] >= since]
    step = max(1, math.ceil(len(pts) / 400))  # sous-échantillonnage pour alléger le front
    return {"points": pts[::step]}


@app.get("/api/crew/{cid}/checkins")
async def crew_checkins(cid: str, limit: int = Query(14, ge=1, le=200)):
    return CHECKINS[require(cid)][-limit:]


@app.post("/api/checkins")
async def post_checkin(body: CheckinIn):
    cid = require(body.crewId)
    ck = {"id": str(uuid.uuid4()), "crewId": cid, "ts": now_ms(),
          **body.model_dump(exclude={"crewId", "ts"})}
    CHECKINS[cid].append(ck)
    recos = recommendations_for(ck)
    RECOMMENDATIONS[cid] = recos
    urgency = "medium" if max(ck["stress"], ck["fatigue"], ck["isolement"]) >= 70 else "low"
    diag = {"id": str(uuid.uuid4()), "ts": now_ms(), "source": "check-in",
            "summary": "Analyse du check-in : " + ("vigilance recommandée sur l'état psychologique." if urgency == "medium" else "état psychologique stable."),
            "hypotheses": [], "urgency": urgency}
    DIAGNOSTICS[cid].insert(0, diag)
    await hub.broadcast({"type": "checkin", "crewId": cid, "checkin": ck})
    await hub.broadcast({"type": "recommendations", "crewId": cid, "items": recos})
    await hub.broadcast({"type": "diagnostic", "crewId": cid, "diagnostic": diag})
    await hub.broadcast({"type": "crew_update", "crew": member(cid)})
    return {"checkin": ck, "recommendations": recos, "diagnostic": diag}


@app.get("/api/crew/{cid}/diagnostics")
async def crew_diagnostics(cid: str):
    return DIAGNOSTICS[require(cid)]


@app.get("/api/crew/{cid}/recommendations")
async def crew_recommendations(cid: str):
    return RECOMMENDATIONS[require(cid)]


@app.get("/api/crew/{cid}/chat")
async def crew_chat(cid: str):
    return CHATS[require(cid)]


@app.post("/api/chat")
async def chat(body: ChatIn):
    cid = require(body.crewId)
    await asyncio.sleep(1.2)  # latence d'un LLM local
    res = analyse_symptoms(body.message)
    CHATS[cid] += [{"role": "user", "text": body.message, "ts": now_ms()},
                   {"role": "ai", "text": res["reply"], "hypotheses": res["hypotheses"], "urgency": res["urgency"], "followUp": res["followUp"], "ts": now_ms()}]
    diag = {"id": str(uuid.uuid4()), "ts": now_ms(), "source": "consultation",
            "summary": f"Symptômes décrits : « {body.message[:140]} »", "hypotheses": res["hypotheses"], "urgency": res["urgency"]}
    DIAGNOSTICS[cid].insert(0, diag)
    await hub.broadcast({"type": "diagnostic", "crewId": cid, "diagnostic": diag})
    if res["urgency"] in ("high", "critical"):
        await add_alert("critical", "Consultation IA : urgence élevée signalée", cid)
    return {**res, "diagnostic": diag}


@app.post("/api/crew/{cid}/contamination")
async def set_contamination(cid: str, body: ContaminationIn):
    require(cid)
    CONTAMINATED[cid] = body.contaminated
    if body.contaminated:
        CRISIS["acknowledged"] = False
        await add_alert("critical", "Contamination déclarée", cid)
    await hub.broadcast({"type": "crew_update", "crew": member(cid)})
    await evaluate_crisis()
    return member(cid)


@app.get("/api/alerts")
async def alerts(limit: int = Query(100, ge=1, le=500)):
    return ALERTS[:limit]


@app.get("/api/crisis")
async def crisis():
    return {k: v for k, v in CRISIS.items() if k != "acknowledged"} | {"contaminationRate": contamination_rate()}


@app.post("/api/crisis/acknowledge")
async def acknowledge():
    if CRISIS["active"]:
        await resolve_crisis("manual_override")
    return {"ok": True}


@app.post("/api/dev/hall/{cid}")
async def simulate_hall(cid: str):
    """Simule le passage de la clé aimantée du médecin sur le capteur à effet Hall."""
    require(cid)
    await hub.broadcast({"type": "hall_sensor", "crewId": cid, "detected": True, "ts": now_ms()})
    if CRISIS["active"]:
        await asyncio.sleep(1.0)
        await resolve_crisis("hall_sensor")
    return {"ok": True}


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        await ws.send_json({"type": "crew_list", "crew": [member(cid) for cid in CREW]})
        if CRISIS["active"]:
            await ws.send_json({"type": "crisis", "contaminationRate": contamination_rate(), "triage": CRISIS["triage"], "since": CRISIS["since"]})
        while True:
            await ws.receive_text()  # le front n'envoie rien pour l'instant
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(ws)


# Le front est servi à la racine (doit être monté APRÈS les routes API).
app.mount("/", StaticFiles(directory=FRONT_DIR, html=True), name="front")


if __name__ == "__main__":
    print(f"Interface servie depuis : {FRONT_DIR}")
    print("Ouvrir http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
