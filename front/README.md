# Horizon Health OS — Front-End

Interface de supervision médicale et psychologique du projet **Astro-Link**
(Workshop EPSI 2026 — ESA Horizon 2080 — Pilier HumanTech & HealthTech).

- **100 % hors-ligne** : aucun CDN, aucune police ni bibliothèque externe. Les graphiques sont dessinés en SVG par notre propre code.
- **Aucune donnée écrite en dur** : chaque zone affiche un état vide explicite tant que le serveur n'a rien envoyé. Toutes les données viennent du Back-End Python (REST + WebSocket).
- **Aucune installation** : HTML, CSS et JavaScript natifs. Ouvrir `index.html` suffit.

## Vues

| Vue | Public | Contenu |
|---|---|---|
| **Accueil** | Médecin | Hologramme du corps de l'astronaute suivi, constantes, Bio-Badge, état de l'équipage, statut, priorités médicales, notifications |
| **Équipage** | Médecin | Équipage connecté, taux de contamination, alertes, anxiété moyenne, matrice de l'équipage, radar psychologique, courbe d'anxiété, journal des alertes, flux temps réel |
| **Fiches** | Médecin | Dossier médical complet, constantes en direct, historiques force et posture, ratio repos/activité, suivi des check-ins, analyses de l'IA, recommandations |
| **PsychoSpace** | Astronaute | Identification, check-in quotidien, Bio-Badge personnel, assistant médical IA, recommandations, évolution personnelle |
| **Paramètres** | Tous | Adresse du serveur, test de connexion, sons, authentification médecin, informations système |
| **Mode crise** | Automatique | Thème rouge, sirène, triage, attente de la clé aimantée (capteur à effet Hall), acquittement de secours |

## Lancer le projet

### Avec le simulateur (recommandé pour développer)

```bash
cd front/dev
pip install -r requirements.txt
python mock_server.py
```

Ouvrir **http://localhost:8000**. Le simulateur sert le front, génère des données **fictives** et envoie la télémétrie en temps réel.

Pour tester le scénario de crise : dans la matrice, déclarer un membre contaminé (1 sur 5 = 20 % ≥ 15 %). Pour simuler la clé aimantée :

```bash
curl -X POST http://localhost:8000/api/dev/hall/astro-003
```

### Avec le vrai Back-End

1. Le Back implémente les routes décrites dans **`docs/API_CONTRACT.md`**.
2. Ouvrir `index.html` (ou le faire servir par le Back).
3. Si le serveur n'est pas sur `localhost:8000` : **Paramètres → Connexion au serveur central**, saisir l'adresse puis « Enregistrer et reconnecter ».

### Sans serveur

L'interface démarre en mode dégradé, affiche les états vides et se reconnecte automatiquement dès que le serveur répond.

## Arborescence

```
front/
├── index.html                 Structure de toutes les vues (conteneurs vides)
├── README.md
├── docs/
│   └── API_CONTRACT.md        Contrat front ↔ Back-End (REST, WebSocket, MQTT)
├── assets/
│   ├── css/
│   │   ├── base.css           Jetons de design, reset, fond
│   │   ├── layout.css         Navigation, barre haute, grilles, responsive
│   │   ├── components.css     Panneaux, boutons, cartes, graphiques, chat, états vides
│   │   ├── home.css           Console d'accueil (hologramme, dock)
│   │   └── crisis.css         Mode Alerte Rouge
│   └── js/
│       ├── core/
│       │   ├── config.js      Adresses serveur, seuils, préférences
│       │   ├── util.js        Utilitaires et normalisation des données reçues
│       │   ├── store.js       Source de vérité unique (événements)
│       │   ├── api.js         Client REST
│       │   ├── socket.js      Client WebSocket + reconnexion automatique
│       │   ├── ui.js          Composants partagés + buzzer (Web Audio)
│       │   ├── charts.js      Graphiques SVG : courbes, radar, jauges
│       │   └── nav.js         Navigation + authentification médecin
│       ├── views/
│       │   ├── home.js        Console d'accueil
│       │   ├── command.js     Vue Équipage (matrice, radar, flux)
│       │   ├── crew.js        Fiches détaillées
│       │   ├── psycho.js      Terminal PsychoSpace
│       │   └── settings.js    Paramètres + contrôleur du mode crise
│       └── app.js             Démarrage et orchestration
└── dev/
    ├── mock_server.py         Simulateur du Back-End (FastAPI) — développement uniquement
    └── requirements.txt
```

## Fonctionnement des données

```
Bio-Badge ESP8266 ──MQTT──> Mosquitto ──> Back-End Python ──REST + WebSocket──> Front
                                               │
                                             Ollama (IA locale)
```

1. Au démarrage, le front interroge `/api/health`, ouvre le WebSocket et charge l'équipage, les historiques, les alertes et l'état de crise. Chaque étape affiche son vrai résultat.
2. Ensuite, tout arrive en temps réel par le WebSocket. Un rafraîchissement REST de secours tourne toutes les 20 secondes.
3. Le front ne décide jamais d'une crise : il affiche celle déclarée par le serveur (message `crisis`).

## Seuils

Modifiables dans `assets/js/core/config.js` :

| Paramètre | Valeur | Rôle |
|---|---|---|
| `CONTAMINATION_THRESHOLD` | 0,15 | seuil affiché pour la quarantaine |
| `ANXIETY_THRESHOLD` | 60 | force ≥ 60 % → orange |
| `ONLINE_TIMEOUT_MS` | 15 000 | badge « silencieux » au-delà |
| `CHAT_TIMEOUT_MS` | 90 000 | attente maximale de l'IA |
