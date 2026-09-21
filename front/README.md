# Horizon Health OS — Front-End (Astro-Link)

Interface du Command Center + module PsychoSpace pour le projet **Astro-MedBox** (EPSI Workshop 2026 B3, Pilier 1 HumanTech & HealthTech).

## Lancer le front

Aucune installation, aucune dépendance. Un seul fichier HTML autonome (zéro CDN, zéro appel réseau externe — conforme à la contrainte Zéro-Cloud du projet).

```bash
# Depuis le dossier front/
open index.html          # macOS
xdg-open index.html      # Linux
# ou juste double-cliquer sur index.html
```

Il n'y a rien à build. Tout (CSS, JS, SVG) est inline dans `index.html`.

## Ce qui est déjà fonctionnel (100% front, mocké)

- **Vue Astronaute (PsychoSpace)** : daily check-in, jauges bio-badge (force/tilt) animées, chatbot médical simulé, prescriptions IA générées côté client
- **Vue Médecin (Command Center)** : matrice des 5 membres d'équipage, radar psychologique SVG, télémétrie
- **Mode Crise** : déclenchement automatique dès que 15% de l'équipage est marqué "contaminé", thème rouge, buzzer via Web Audio API, triage automatique, déverrouillage par maintien (hold-to-confirm) simulant le capteur à effet Hall
- **Boot sequence** au chargement (désactivée si `prefers-reduced-motion`)

## Point d'intégration pour le Back-End

Tout le pont réseau est isolé dans un seul objet JS, en bas de `index.html`, cherche `AstroLinkTelemetry` :

```js
const AstroLinkTelemetry = {
  connect(url) { ... },
  handleMessage(msg) { ... },
  fallbackToSimulation() { ... }
};
// AstroLinkTelemetry.connect("ws://localhost:8000/ws/telemetrie");
```

Tant qu'aucune connexion n'est établie, le front tourne en simulation locale — aucun risque de casser la démo si le back n'est pas prêt.

### Format JSON attendu (badge → front, un message par événement)

```json
{
  "badgeId": "astro-001",
  "crewId": 0,
  "vitals": { "force": 0, "tiltStatus": "actif" },
  "contaminated": false,
  "ts": 1234567890
}
```

- `crewId` : entier 0 à 4 (0 = badge réel connecté, 1-4 = simulés)
- `vitals.force` : 0-100 (capteur de déformation / jauge d'anxiété)
- `vitals.tiltStatus` : `"actif"` ou `"repos"` (capteur d'inclinaison)
- `contaminated` : booléen — passer à `true` déclenche automatiquement le mode crise si ≥ 15% de l'équipage est contaminé

### Commande de quarantaine (serveur → badge physique)

Le front n'envoie pas cette commande lui-même pour l'instant (c'est le rôle du Back). Format prévu si vous voulez que le front la relaie :

```json
{ "type": "quarantine", "crewId": 2, "action": "lock" }
```

### À faire côté back pour brancher le vrai flux

1. Exposer un WebSocket (`ws://` ou `wss://`) qui relaie les messages du broker MQTT vers le front, un message JSON par mise à jour de capteur
2. Le back FastAPI expose `ws://localhost:8000/ws/telemetrie` et sert directement ce dossier front.
3. Si vous utilisez Socket.IO plutôt qu'un WebSocket brut, prévenez-moi : le protocole diffère (`socket.on(...)` vs `onmessage` + `JSON.parse`), il faudra que j'adapte ce bloc

## Stack

Vanilla HTML/CSS/JS, aucune librairie externe. Pensé pour être facilement découpé en composants React si l'équipe en a besoin plus tard (chaque bloc `.panel` est déjà isolé).

## Auteur

Romain (Dev Front-End) — Astro-Link / Horizon Health OS
