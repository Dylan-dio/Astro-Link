🚀 Astro-Link : Horizon Health OS

Projet développé dans le cadre du Workshop ESA B3 (2026-2027) - Mission Horizon 2080   

Pilier 1 : HumanTech & Health Tech Spatiales   En route vers l'espace profond, le vaisseau interplanétaire fait face à une rupture totale de communication avec la Terre. Horizon Health OS est l'interface du "Bio-Badge" (Astro-Link), un écosystème de santé 100% autonome et déconnecté (Edge Computing) permettant de surveiller les constantes vitales et psychologiques de l'équipage grâce à une IA embarquée.


🌟 Fonctionnalités Principales

Zéro-Cloud Strict : L'intégralité du système (Base de données, Serveur, Interface, IA) fonctionne sur un réseau local (WLAN) sans aucun accès Internet.

Télémétrie IoT en Temps Réel : Réception directe via HTTP des données envoyées par le badge ESP8266 (pouls, bouton SOS, Tilt et clé magnétique), puis diffusion au dashboard par WebSocket.

Module PsychoSpace : Interface permettant aux astronautes de remplir leur bilan quotidien (fatigue, stress, isolement) pour un suivi psychologique.

Diagnostic IA Local : Intégration d'OpenVINO avec un modèle LLM léger exécuté sur l'Intel AI Boost (NPU) pour analyser les symptômes et formuler des hypothèses médicales offline.

Protocole de Crise Automatisé : Détection automatique lorsque 15% de l'équipage est contaminé, déclenchant le mode Quarantaine (priorisation des patients sur le dashboard, alertes visuelles et sonores sur le badge physique).


🏗️ Architecture Technique

1. Infrastructure (Edge Computing)Réseau : Point d'accès Wi-Fi local isolé.Broker MQTT : Eclipse Mosquitto (gestion des messages IoT entre l'ESP8266 et le serveur Node.js/Python).IA Locale : OpenVINO avec un modèle causal local compatible Intel AI Boost (NPU).

2. Back-End (Cerveau Analytique)Technologie : Node.js / Express (ou Python/FastAPI).Base de Données : SQLite ou Fichier JSON local.Rôle : Orchestration MQTT, exécution du modèle OpenVINO local, calcul de l'algorithme de crise des 15%.

3. Front-End (Horizon Health OS)Technologie : React.js / Vue.js ou Vanilla JS/HTML/CSS.Contrainte : Tous les assets (CSS, Polices, Chart.js) sont hébergés localement. Aucun CDN autorisé.Rôle : Dashboard du médecin (Data-viz), Terminal PsychoSpace de l'astronaute, affichage des alertes WebSockets.

4. Matériel Embarqué (Bio-Badge IoT)Microcontrôleur : ESP8266 (ESP-12E NodeMCU v3).   Capteurs : capteur de pouls, bouton SOS, capteur d'inclinaison à bille (Tilt), capteur magnétique (Effet Hall ou Bilame) et température.   Actionneurs : LED RVB, buzzer passif (contrôlé en PWM).

Le badge envoie une télémétrie JSON vers `POST /api/telemetrie` :

```json
{"force": 512, "tilt": 0, "button": 0, "magnetic": 0, "proximity": 0,
 "heartRate": 72, "sos": 0, "bpmAlert": 0, "temperature": 36.7, "humidity": 45.0}
```

`tilt`, `button` et `magnetic` valent `0` ou `1`. `heartRate` est la
fréquence cardiaque calculée en battements par minute à partir du capteur de
pouls analogique. `force` est sa valeur analogique brute, `proximity` indique
le capteur infrarouge et `sos` / `bpmAlert` les alertes locales du badge.
La température et l'humidité sont mesurées par le DHT11 (`null` si la lecture
échoue). Le serveur renvoie les commandes
d'actionneurs à l'ESP8266 sur
`POST /alerte` (`led` et `buzzer`).

L'ESP8266 crée le point d'accès `MedBox_Network` et envoie les mesures vers
`ASTRO_LINK_ESP_URL` côté serveur pour les commandes (par défaut
`http://192.168.4.1`). Pour le sketch fourni, configurez son adresse de
destination avec `BACKEND_HOST` (par défaut `192.168.4.100`) et démarrez
Uvicorn sur `0.0.0.0:8000`.


⚙️ Prérequis

Pour faire tourner le projet sur le réseau de démonstration, la machine serveur doit posséder :Node.js (v18+) ou Python (v3.10+)Eclipse MosquittoOpenVINO Runtime et le modèle local `./llama_openvino_model`IDE Arduino / PlatformIO pour téléverser le code C++ sur l'ESP8266


🚀 Installation & Déploiement

### Test local rapide (back-end + front + simulateur)

Depuis la racine du projet, installez les dépendances Python puis démarrez
Ollama avec le modèle local utilisé par le back-end :

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
ollama serve
ollama run llama3.2:1b
```

Dans un autre terminal, démarrez l'API :

```powershell
$env:ASTRO_LINK_AUTH_REQUIRED = "true"
$env:ASTRO_LINK_DOCTOR_USERNAME = "medecin"
$env:ASTRO_LINK_DOCTOR_PASSWORD = "changez-moi"
$env:ASTRO_LINK_AUTH_SECRET = "une-cle-secrete-longue"
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Ouvrez ensuite [front/index.html](front/index.html) dans le navigateur. La
liaison doit afficher `WebSocket connecté`. Dans un troisième terminal, lancez
le simulateur :

```powershell
.\.venv\Scripts\python.exe simulateur_interactif.py
```

Lorsque `ASTRO_LINK_AUTH_REQUIRED=true`, activez **Exiger une authentification
médecin** dans **Réglages**, puis connectez-vous avec les identifiants définis
dans `ASTRO_LINK_DOCTOR_USERNAME` et `ASTRO_LINK_DOCTOR_PASSWORD`. Le jeton est
valable huit heures et reste uniquement dans la session du navigateur. Les
valeurs par défaut (`medecin` / `astro-link-demo`) sont réservées à la
démonstration locale et ne doivent pas être utilisées sur un réseau partagé.

Le simulateur envoie successivement une fréquence cardiaque normale, un pouls
élevé à 150 bpm qui déclenche Ollama et la quarantaine, puis l'acquittement par
clé médicale.
Avec cinq membres, un seul membre en quarantaine représente 20 %, donc dépasse
le seuil critique de 15 %. L'ESP8266 est facultatif pour ce test : s'il est
absent, l'alerte est conservée côté serveur et le reste du scénario continue.

### Test réel du capteur magnétique

Le backend sert directement le nouveau front sur `http://127.0.0.1:8000/`.
Cette adresse est préférable à l'ouverture de `front/index.html` en
`file://`, car elle configure automatiquement l'API et le WebSocket.

1. Démarrer le serveur :

   ```powershell
   .\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```

   Depuis le PC qui héberge le serveur, `http://127.0.0.1:8000/` reste valable.
   Depuis un autre PC connecté au même réseau local, utilisez l'adresse IPv4
   du PC serveur, par exemple `http://192.168.1.42:8000/`. Pour la connaître :

   ```powershell
   ipconfig
   ```

   Si Windows bloque la connexion, autorisez le port TCP 8000 sur le profil
   **Privé** du pare-feu (à exécuter dans PowerShell en administrateur) :

   ```powershell
   New-NetFirewallRule -DisplayName "Astro-Link FastAPI" `
     -Direction Inbound -Protocol TCP -LocalPort 8000 `
     -Action Allow -Profile Private
   ```

   Les deux ordinateurs doivent être sur le même réseau local. Un Wi-Fi invité
   ou l'option d'isolation des clients peut empêcher les postes de communiquer.
   Si l'ESP8266 crée son propre réseau Wi-Fi (`192.168.4.1`), les autres postes
   doivent également être connectés à ce réseau, ou le PC serveur doit disposer
   d'une seconde connexion réseau permettant de joindre les deux réseaux.

3. Relier le capteur magnétique au **D2 (GPIO4)** et au **GND** de
   l'ESP8266, conformément au câblage du montage. Le capteur doit fournir un
   niveau logique stable ; ajouter une résistance de rappel si le module n'en
   intègre pas.
4. Connecter l'ordinateur et l'ESP8266 au même réseau Wi-Fi, puis ouvrir
   l'URL correspondant au PC serveur. Attendre `API REST : online` et
   `Liaison temps réel : online`.
5. Faire envoyer par l'ESP8266 toutes les secondes un JSON
   `POST /api/telemetrie` contenant notamment
   `{"tilt":0,"button":0,"magnetic":0,"heartRate":72}`. Le front doit afficher
   le badge physique et son signal comme actif.

Pour vérifier rapidement que le serveur reçoit bien les données, utilisez
PowerShell depuis le PC serveur :

```powershell
$payload = @{
  force = 512; tilt = 0; button = 0; magnetic = 0; proximity = 0
  heartRate = 72; sos = 0; bpmAlert = 0; temperature = 36.7; humidity = 45.0
} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8000/api/telemetrie `
  -Method Post -ContentType "application/json" -Body $payload
Invoke-RestMethod http://127.0.0.1:8000/api/health
```

La réponse de `/api/health` doit contenir `telemetry.received: true` et un
compteur `telemetry.count` supérieur à zéro. Depuis un autre PC, remplacez
`127.0.0.1` par l'adresse IPv4 du PC serveur.

Le formulaire PsychoSpace envoie le check-in à `POST /api/checkins`. Si cette
route répond 404, le serveur n'a pas été redémarré après une mise à jour du
backend ou le navigateur utilise une ancienne instance : arrêtez Uvicorn,
relancez-le avec `--host 0.0.0.0 --port 8000`, puis rechargez l'interface.

6. Provoquer une crise en envoyant `heartRate: 150` (ou en utilisant le
   capteur de pouls). Le mode **Alerte Rouge** apparaît dès que le badge est
   contaminé.
7. Approcher l'aimant du capteur : l'ESP8266 doit envoyer `magnetic: 1`,
   puis `magnetic: 0` lorsqu'il est retiré. Le serveur diffuse
   `hall_sensor`, l'interface affiche **Clé du médecin détectée**, l'état
   contaminé repasse à sain et le mode crise se ferme.

Pour un accès depuis un réseau partagé, activez l'authentification avant de
démarrer Uvicorn, et remplacez les valeurs de démonstration :

```powershell
$env:ASTRO_LINK_AUTH_REQUIRED = "true"
$env:ASTRO_LINK_DOCTOR_USERNAME = "medecin"
$env:ASTRO_LINK_DOCTOR_PASSWORD = "un-mot-de-passe-long"
$env:ASTRO_LINK_AUTH_SECRET = "une-cle-secrete-aleatoire-et-longue"
```

Ollama n'a pas besoin d'être exposé sur le réseau : laissez
`OLLAMA_URL=http://127.0.0.1:11434`. Les autres PC parlent uniquement au
serveur FastAPI sur le port 8000, et FastAPI appelle Ollama localement.

Pour tester uniquement le backend sans matériel, le simulateur existant
reproduit la même séquence :

```powershell
.\.venv\Scripts\python.exe simulateur_interactif.py
```

La commande `/api/badge_medecin` du simulateur correspond à un acquittement
manuel ; elle ne valide pas le niveau électrique du capteur.

Étape 1 : Démarrer l'infrastructure

- Connectez tous les postes (Devs et ESP8266) sur le même routeur Wi-Fi (sans accès WAN).- Lancez le broker Mosquitto (port par défaut 1883).
- Placez le modèle OpenVINO dans `./llama_openvino_model` et vérifiez que l’environnement OpenVINO Intel est installé.

Étape 2 : 
- Configurer le Back-EndNaviguez dans le dossier /backend.
- Installez les dépendances
    npm install
    # ou pip install -r requirements.txt
- Copiez le fichier .env.example vers .env et configurez l’adresse IP locale du broker MQTT. Lancez le serveur :Bashnpm run start

Étape 3 : 
- Configurer le Front-EndNaviguez dans le dossier /frontend.Installez les dépendances
    npm install
- Lancez le serveur de développement
    npm run dev

Étape 4 : Déployer le Badge IoT (ESP8266)
- Ouvrez le dossier /firmware_esp dans l'IDE Arduino.
- Modifiez le fichier config.h avec le SSID Wi-Fi, le mot de passe et l'adresse IP statique du serveur MQTT.
- Téléversez le code sur l'ESP8266 via le câble USB-A vers Micro-USB.


🔌 Câblage Matériel (Bio-Badge)

L'alimentation électrique se fait par câble USB pendant le développement.
Pour la phase de production (soutenance), utiliser le bloc d'alimentation 220V-7.5V en branchant le bornier Wago (marque rouge) sur la broche VIN de l'ESP8266 et le pôle négatif sur la broche G (GND). 
Ne jamais connecter l'USB et le bloc 7.5V simultanément.

---------------------------------------------------------------------------------------------
| Composant             | Type      | Rôle                         |Connexion (Exemple GPIO)|
|-----------------------|-----------|------------------------------|------------------------|
| Pouls (Pulse Sensor)  | Capteur   | Fréquence cardiaque + signal | Analogique (A0)        |
| Température / humidité (DHT11) | Capteur   | Température et humidité       | DATA D4 |
| Bouton SOS            | Capteur   | Déclenchement d'urgence      | Numérique (D1 → GND)   |
| Tilt (Inclinaison)    | Capteur   | Détection Activité/Sommeil   | Numérique (D7 → GND)   |
| Magnétique (Hall/ILS) | Capteur   | Clé médecin pour acquittement| Numérique (D8 → GND)   |
| LED RVB               | Actionneur| Statut de santé visuel       | Numérique (D0, D3, D4)  |
| Buzzer Passif         | Actionneur| Alarme (Programmation PWM)   | Numérique PWM (D2)      |
---------------------------------------------------------------------------------------------

Le signal analogique du capteur de pouls est traité sur l'ESP8266 pour calculer
une estimation BPM envoyée dans `heartRate`. Le DHT11 fournit la température et
l'humidité envoyées dans `temperature` et `humidity`. Les bibliothèques Arduino
**DHT sensor library** et **Adafruit Unified Sensor** sont nécessaires. Le PC doit être
connecté au point d'accès `MedBox_Network` ; l'ESP utilise alors
`192.168.4.1` et le PC `192.168.4.2`.


🧪 Scénario de Démonstration (Le Test des 15%)

Pour tester la fonctionnalité critique demandée par l'ESA lors du jury :

- Sur le Dashboard Front-End, sélectionnez un astronaute virtuel et modifiez ses constantes pour simuler une infection.
- Le Back-End détecte que le seuil de 15% de contamination est franchi.
- L'application Web bascule en "Alerte Rouge" et génère la liste de priorisation du triage médical.
- Le Back-End publie un ordre MQTT ({"alerte": "quarantaine"}).
- Le Bio-Badge physique (ESP8266) allume sa LED en rouge et fait sonner le buzzer.
- Le médecin passe sa clé aimantée sur le capteur magnétique du badge pour lever physiquement la quarantaine.


👥 L'Équipe

Ugo GRINDA - Architecte Infrastructure & Réseau (Edge Computing)

Korto GRINDA - Développeur IoT / Logiciel Embarqué (C++)

Dylan DIO - Développeur Back-End & IA (Python)

Romain DOIT - Développeur Front-End (UI/UX PsychoSpace)

Albin ROUSTAN-LABOURET - Designer 3D & Scrum Master (Coordination, Boîtier Physique & Livrables)