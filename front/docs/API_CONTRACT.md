# Contrat d'API — Horizon Health OS

Ce document définit **exactement** ce que le front attend du Back-End Python.
Si le Back respecte ces formats, le front affiche les données sans aucune modification.

Implémentation de référence complète : `dev/mock_server.py` (FastAPI). Le vrai Back-End peut reprendre sa structure et remplacer les données simulées par MQTT, la base de données et Ollama.

---

## 1. Principes généraux

| Élément | Valeur |
|---|---|
| Format | JSON, UTF-8 |
| URL par défaut | `http://localhost:8000` (modifiable dans la vue Paramètres) |
| Temps réel | WebSocket brut sur `/ws` (**pas** Socket.IO) |
| Horodatages | millisecondes epoch **ou** secondes epoch **ou** ISO 8601 : le front accepte les trois |
| CORS | à autoriser si le front n'est pas servi par le Back (`allow_origins=["*"]` en local) |
| Authentification | optionnelle. Si activée côté front : en-tête `Authorization: Bearer <token>` |
| Erreurs | code HTTP ≠ 2xx + `{"detail": "message"}` (format FastAPI par défaut) |

Les réponses de type liste peuvent être un tableau direct `[...]` ou un objet `{"items": [...]}` : le front accepte les deux.

Si le Back sert lui-même le dossier `front/` (voir mock_server.py, dernière ligne), le front détecte automatiquement l'adresse et aucune configuration n'est nécessaire.

---

## 2. Objets de données

### 2.1 Profil d'équipage (`CrewMember`)

```json
{
  "id": "astro-001",
  "badgeId": "AL-001",
  "name": "Elena Voss",
  "role": "Commandante",
  "specialty": "Pilotage",
  "age": 44,
  "sex": "F",
  "bloodType": "A+",
  "nationality": "Allemande",
  "heightCm": 171,
  "weightKg": 63,
  "allergies": ["Pénicilline"],
  "treatments": [],
  "medicalNotes": "Texte libre",
  "isRealBadge": true,
  "contaminated": false,
  "healthLevel": "green",
  "latestVitals": { "ts": 1789990000000, "force": 32, "tilt": "actif", "temperature": 36.7, "heartRate": 72 },
  "latestCheckin": { "ts": 1789990000000, "sommeil": 60, "humeur": 55, "fatigue": 40, "stress": 35, "isolement": 30, "note": null }
}
```

Seuls `id` et `name` sont obligatoires. Chaque champ absent s'affiche « Non renseigné ».

- `healthLevel` : `"green"` | `"orange"` | `"red"` (couleur de la LED du badge). S'il est absent, le front le calcule : contaminé → rouge, force ou stress ≥ 60 → orange, sinon vert.
- `isRealBadge` : `true` pour le Bio-Badge physique (ESP8266) de la démo.
- `latestVitals` / `latestCheckin` : facultatifs, évitent des requêtes supplémentaires au démarrage.

### 2.2 Mesure de télémétrie (`Vitals`)

| Champ | Type | Source matérielle |
|---|---|---|
| `force` | 0–100 | capteur de force (jauge d'anxiété) |
| `tilt` | `"actif"` \| `"repos"` (ou `1` / `0`) | capteur d'inclinaison |
| `temperature` | °C, facultatif | simulée |
| `heartRate` | bpm, facultatif | simulée |

### 2.3 Check-in PsychoSpace (`Checkin`)

```json
{ "id": "uuid", "crewId": "astro-001", "ts": 1789990000000,
  "sommeil": 60, "humeur": 55, "fatigue": 40, "stress": 35, "isolement": 30, "note": "texte ou null" }
```

Toutes les valeurs de 0 à 100. `sommeil` et `humeur` : 100 = très bien. `fatigue`, `stress`, `isolement` : 100 = très mal.

### 2.4 Analyse IA (`Diagnostic`)

```json
{ "id": "uuid", "ts": 1789990000000, "source": "consultation",
  "summary": "Texte de synthèse",
  "hypotheses": [ { "label": "Céphalée de tension", "confidence": 0.55 } ],
  "urgency": "low" }
```

- `urgency` : `"low"` | `"medium"` | `"high"` | `"critical"`
- `hypotheses` : tableau d'objets ou de chaînes simples. `confidence` entre 0 et 1 (ou 0 et 100).

### 2.5 Recommandation (`Recommendation`)

```json
{ "title": "Séance de cohérence cardiaque", "description": "10 minutes de respiration guidée.", "category": "Gestion du stress" }
```

Une simple chaîne de caractères est aussi acceptée.

### 2.6 Alerte (`Alert`)

```json
{ "id": "uuid", "ts": 1789990000000, "level": "critical", "message": "Contamination déclarée", "crewId": "astro-003" }
```

`level` : `"info"` | `"warning"` | `"critical"`. `crewId` peut être `null` pour une alerte système.

### 2.7 Entrée de triage (`TriageEntry`)

```json
{ "crewId": "astro-003", "priority": 1, "reason": "Contaminé — température 38.9 °C" }
```

`priority` : 1 (immédiat), 2 (sous 30 min), 3 (surveillance).

---

## 3. Routes REST

| Méthode | Route | Réponse | Utilisée par |
|---|---|---|---|
| GET | `/api/health` | `{"status":"ok","version":"...","ollama":"ok"}` | démarrage, Paramètres |
| POST | `/api/auth/login` | corps `{"username","password"}` → `{"token","user"}` ou 401 | auth médecin (optionnelle) |
| GET | `/api/crew` | `CrewMember[]` | toutes les vues |
| GET | `/api/crew/{id}` | `CrewMember` | fiche détaillée |
| GET | `/api/crew/{id}/telemetry?range=6h` | `{"points": [Vitals + "ts"]}` | graphiques force et posture |
| POST | `/api/crew/{id}/contamination` | corps `{"contaminated": true}` → `CrewMember` | bouton « Déclarer contaminé » |
| GET | `/api/crew/{id}/checkins?limit=14` | `Checkin[]` | historiques psychologiques |
| POST | `/api/checkins` | corps `Checkin` sans id → `{"checkin","recommendations","diagnostic"}` | formulaire PsychoSpace |
| GET | `/api/crew/{id}/diagnostics` | `Diagnostic[]` | fiche détaillée |
| GET | `/api/crew/{id}/recommendations` | `Recommendation[]` | fiche + PsychoSpace |
| GET | `/api/crew/{id}/chat` | `[{"role":"user"\|"ai","text","hypotheses","urgency","followUp","ts"}]` | historique du chat |
| POST | `/api/chat` | corps `{"crewId","message"}` → voir 3.1 | assistant médical |
| GET | `/api/alerts?limit=100` | `Alert[]` | journal des alertes |
| GET | `/api/crisis` | `{"active","contaminationRate","triage","since"}` | état de crise au démarrage |
| POST | `/api/crisis/acknowledge` | corps `{"method":"manual_override"}` → `{"ok":true}` | acquittement de secours |

Dans `POST /api/checkins` et `POST /api/chat`, les champs `recommendations` et `diagnostic` de la réponse sont facultatifs.

### 3.1 Réponse de `POST /api/chat`

```json
{
  "reply": "Voici mon analyse préliminaire.",
  "hypotheses": [ { "label": "Syndrome fébrile", "confidence": 0.6 } ],
  "urgency": "medium",
  "followUp": "Depuis combien de temps ?",
  "diagnostic": { "...": "Diagnostic facultatif, ajouté à la fiche" }
}
```

Le front attend jusqu'à **90 secondes** (un LLM local peut être lent).

Exemple d'appel Ollama côté Back (à adapter) :

```python
import httpx, json
PROMPT = ("Tu es l'assistant médical d'un vaisseau spatial. Réponds UNIQUEMENT en JSON "
          '{"reply": str, "hypotheses": [{"label": str, "confidence": float}], '
          '"urgency": "low|medium|high|critical", "followUp": str}. Symptômes : ')
async def ask_ollama(message: str) -> dict:
    async with httpx.AsyncClient(timeout=80) as client:
        r = await client.post("http://localhost:11434/api/generate",
                              json={"model": "llama3", "prompt": PROMPT + message, "stream": False, "format": "json"})
        return json.loads(r.json()["response"])
```

---

## 4. WebSocket `/ws`

Le Back envoie des messages JSON. Le front n'envoie rien pour l'instant. Un tableau de messages dans une même trame est accepté.

| `type` | Champs | Effet dans le front |
|---|---|---|
| `crew_list` | `crew: CrewMember[]` | remplace la liste (à envoyer à la connexion) |
| `crew_update` | `crew: CrewMember` (partiel accepté, `id` obligatoire) | met à jour un profil |
| `telemetry` | `crewId`, `badgeId`, `vitals: Vitals`, `ts`, `healthLevel?`, `contaminated?` | courbes, jauges, LED, flux |
| `checkin` | `crewId`, `checkin: Checkin` | historiques et radar |
| `diagnostic` | `crewId`, `diagnostic: Diagnostic` | fiche détaillée |
| `recommendations` | `crewId`, `items: Recommendation[]` | fiche + PsychoSpace |
| `alert` | champs de `Alert` à plat | journal + son de notification |
| `crisis` | `contaminationRate` (0–1), `triage: TriageEntry[]`, `since` | **active le mode Alerte Rouge** |
| `crisis_resolved` | `by`: `"hall_sensor"` \| `"manual_override"` \| `"threshold"` | désactive le mode crise |
| `hall_sensor` | `crewId`, `detected: true` | animation « clé du médecin détectée » |
| `badge_command` | `crewId`, `led`, `buzzer` | affiché dans le flux (information) |

Exemple de message télémétrie :

```json
{ "type": "telemetry", "crewId": "astro-001", "badgeId": "AL-001",
  "vitals": { "force": 42.5, "tilt": "actif", "temperature": 36.8, "heartRate": 74 },
  "healthLevel": "green", "contaminated": false, "ts": 1789990000000 }
```

---

## 5. Logique de crise (responsabilité du Back-End)

Le front **n'invente jamais** une crise : il affiche ce que le Back décide.

1. À chaque changement de contamination, le Back calcule `taux = contaminés / effectif`.
2. Si `taux ≥ 0,15` → message `crisis` avec le triage, puis commande MQTT aux badges : LED rouge clignotante + buzzer alarme pour les contaminés.
3. Quand un badge publie la détection de l'aimant (capteur à effet Hall) → message `hall_sensor`, puis `crisis_resolved` avec `by: "hall_sensor"`, puis extinction du buzzer.
4. Secours : `POST /api/crisis/acknowledge` produit le même résultat avec `by: "manual_override"`.

---

## 6. Topics MQTT suggérés (Back ↔ Bio-Badges)

Le front ne se connecte pas à MQTT, mais ce découpage simplifie le travail du Back et de l'IoT :

| Topic | Sens | Contenu |
|---|---|---|
| `astrolink/{badgeId}/telemetry` | badge → Back | `{"force": 0-1023, "tilt": 0\|1}` (le Back convertit la force en 0–100) |
| `astrolink/{badgeId}/hall` | badge → Back | `{"detected": true}` |
| `astrolink/{badgeId}/command` | Back → badge | `{"led": "green\|orange\|red\|red_blink\|off", "buzzer": "off\|chime\|alarm"}` |
