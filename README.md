🚀 Astro-Link : Horizon Health OS

Projet développé dans le cadre du Workshop ESA B3 (2026-2027) - Mission Horizon 2080   

Pilier 1 : HumanTech & Health Tech Spatiales   En route vers l'espace profond, le vaisseau interplanétaire fait face à une rupture totale de communication avec la Terre. Horizon Health OS est l'interface du "Bio-Badge" (Astro-Link), un écosystème de santé 100% autonome et déconnecté (Edge Computing) permettant de surveiller les constantes vitales et psychologiques de l'équipage grâce à une IA embarquée.


🌟 Fonctionnalités Principales

Zéro-Cloud Strict : L'intégralité du système (Base de données, Serveur, Interface, IA) fonctionne sur un réseau local (WLAN) sans aucun accès Internet.

Télémétrie IoT en Temps Réel : Réception directe via HTTP des données envoyées par le badge ESP8266 (force, bouton SOS, Tilt et clé magnétique), puis diffusion au dashboard par WebSocket.

Module PsychoSpace : Interface permettant aux astronautes de remplir leur bilan quotidien (fatigue, stress, isolement) pour un suivi psychologique.

Diagnostic IA Local : Intégration d'OpenVINO avec un modèle LLM léger exécuté sur l'Intel AI Boost (NPU) pour analyser les symptômes et formuler des hypothèses médicales offline.

Protocole de Crise Automatisé : Détection automatique lorsque 15% de l'équipage est contaminé, déclenchant le mode Quarantaine (priorisation des patients sur le dashboard, alertes visuelles et sonores sur le badge physique).


🏗️ Architecture Technique

1. Infrastructure (Edge Computing)Réseau : Point d'accès Wi-Fi local isolé.Broker MQTT : Eclipse Mosquitto (gestion des messages IoT entre l'ESP8266 et le serveur Node.js/Python).IA Locale : OpenVINO avec un modèle causal local compatible Intel AI Boost (NPU).

2. Back-End (Cerveau Analytique)Technologie : Node.js / Express (ou Python/FastAPI).Base de Données : SQLite ou Fichier JSON local.Rôle : Orchestration MQTT, exécution du modèle OpenVINO local, calcul de l'algorithme de crise des 15%.

3. Front-End (Horizon Health OS)Technologie : React.js / Vue.js ou Vanilla JS/HTML/CSS.Contrainte : Tous les assets (CSS, Polices, Chart.js) sont hébergés localement. Aucun CDN autorisé.Rôle : Dashboard du médecin (Data-viz), Terminal PsychoSpace de l'astronaute, affichage des alertes WebSockets.

4. Matériel Embarqué (Bio-Badge IoT)Microcontrôleur : ESP8266 (ESP-12E NodeMCU v3).   Capteurs : Capteur de déformation (Force), bouton SOS, capteur d'inclinaison à bille (Tilt), capteur magnétique (Effet Hall ou Bilame).   Actionneurs : LED RVB, buzzer passif (contrôlé en PWM).

Le badge envoie une télémétrie JSON vers `POST /api/telemetrie` :

```json
{"force": 0, "tilt": 0, "button": 0, "magnetic": 0}
```

`force` est la mesure analogique (0 à 1023) et les trois autres champs valent
`0` ou `1`. Le serveur renvoie les commandes d'actionneurs à l'ESP8266 sur
`POST /alerte` (`led` et `buzzer`).


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
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Ouvrez ensuite [front/index.html](front/index.html) dans le navigateur. La
liaison doit afficher `WebSocket connecté`. Dans un troisième terminal, lancez
le simulateur :

```powershell
.\.venv\Scripts\python.exe simulateur_interactif.py
```

Le simulateur envoie successivement une télémétrie normale, une force de 950
qui déclenche Ollama et la quarantaine, puis l'acquittement par clé médicale.
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

2. Relier le capteur magnétique au **D2 (GPIO4)** et au **GND** de
   l'ESP8266, conformément au câblage du montage. Le capteur doit fournir un
   niveau logique stable ; ajouter une résistance de rappel si le module n'en
   intègre pas.
3. Connecter l'ordinateur et l'ESP8266 au même réseau Wi-Fi, puis ouvrir
   `http://127.0.0.1:8000/`. Attendre `API REST : online` et
   `Liaison temps réel : online`.
4. Faire envoyer par l'ESP8266 toutes les secondes un JSON
   `POST /api/telemetrie` contenant notamment
   `{"force":0,"tilt":0,"button":0,"magnetic":0}`. Le front doit afficher
   le badge physique et son signal comme actif.
5. Provoquer une crise en envoyant `force: 950` (ou en utilisant le capteur
   de force). Le mode **Alerte Rouge** apparaît dès que le badge est
   contaminé.
6. Approcher l'aimant du capteur : l'ESP8266 doit envoyer `magnetic: 1`,
   puis `magnetic: 0` lorsqu'il est retiré. Le serveur diffuse
   `hall_sensor`, l'interface affiche **Clé du médecin détectée**, l'état
   contaminé repasse à sain et le mode crise se ferme.

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
| Bouton SOS            | Capteur   | Déclenchement d'urgence      | Numérique (D0 → GND)   |
| Tilt (Inclinaison)    | Capteur   | Détection Activité/Sommeil   | Numérique (D1 → GND)   |
| Magnétique (Hall/ILS) | Capteur   | Clé médecin pour acquittement| Numérique (D2 → GND)   |
| LED RVB               | Actionneur| Statut de santé visuel       | Numérique (D5, D6,D7)  |
| Buzzer Passif         | Actionneur| Alarme (Programmation PWM)   | Numérique PWM (D8)     |
---------------------------------------------------------------------------------------------

Le signal analogique du capteur de pouls est envoyé dans le champ `force` pour
rester compatible avec la jauge d'anxiété existante (valeur brute 0–1023).
Une estimation BPM est également envoyée dans `heartRate`. Le PC doit être
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

[Nom 1] - Architecte Infrastructure & Réseau (Edge Computing)

[Nom 2] - Développeur IoT / Logiciel Embarqué (C++)

[Nom 3] - Développeur Back-End & IA (Prompt Engineering)

[Nom 4] - Développeur Front-End (UI/UX PsychoSpace)

[Nom 5] - Full-Stack & Scrum Master (Coordination, Boîtier Physique & Livrables)