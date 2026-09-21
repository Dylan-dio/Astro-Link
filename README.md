🚀 Astro-Link : Horizon Health OS

Projet développé dans le cadre du Workshop ESA B3 (2026-2027) - Mission Horizon 2080   

Pilier 1 : HumanTech & Health Tech Spatiales   En route vers l'espace profond, le vaisseau interplanétaire fait face à une rupture totale de communication avec la Terre. Horizon Health OS est l'interface du "Bio-Badge" (Astro-Link), un écosystème de santé 100% autonome et déconnecté (Edge Computing) permettant de surveiller les constantes vitales et psychologiques de l'équipage grâce à une IA embarquée.


🌟 Fonctionnalités Principales

Zéro-Cloud Strict : L'intégralité du système (Base de données, Serveur, Interface, IA) fonctionne sur un réseau local (WLAN) sans aucun accès Internet.

Télémétrie IoT en Temps Réel : Réception via MQTT des données envoyées par le badge ESP8266 (niveau de stress via capteur de force, suivi d'activité via capteur Tilt).

Module PsychoSpace : Interface permettant aux astronautes de remplir leur bilan quotidien (fatigue, stress, isolement) pour un suivi psychologique.

Diagnostic IA Local : Intégration d'Ollama avec un modèle LLM léger pour analyser les symptômes et formuler des hypothèses médicales offline.

Protocole de Crise Automatisé : Détection automatique lorsque 15% de l'équipage est contaminé, déclenchant le mode Quarantaine (priorisation des patients sur le dashboard, alertes visuelles et sonores sur le badge physique).


🏗️ Architecture Technique

1. Infrastructure (Edge Computing)Réseau : Point d'accès Wi-Fi local isolé.Broker MQTT : Eclipse Mosquitto (gestion des messages IoT entre l'ESP8266 et le serveur Node.js/Python).IA Locale : Ollama (LLM type Llama 3.2 1B/3B ou Qwen2 1.5B) exposé sur 0.0.0.0.

2. Back-End (Cerveau Analytique)Technologie : Node.js / Express (ou Python/FastAPI).Base de Données : SQLite ou Fichier JSON local.Rôle : Orchestration MQTT, requêtage de l'API Ollama locale, calcul de l'algorithme de crise des 15%.

3. Front-End (Horizon Health OS)Technologie : React.js / Vue.js ou Vanilla JS/HTML/CSS.Contrainte : Tous les assets (CSS, Polices, Chart.js) sont hébergés localement. Aucun CDN autorisé.Rôle : Dashboard du médecin (Data-viz), Terminal PsychoSpace de l'astronaute, affichage des alertes WebSockets.

4. Matériel Embarqué (Bio-Badge IoT)Microcontrôleur : ESP8266 (ESP-12E NodeMCU v3).   Capteurs : Capteur de déformation (Force), Capteur d'inclinaison à bille (Tilt), Capteur magnétique (Effet Hall ou Bilame).   Actionneurs : LED RVB, Buzzer passif (contrôlé en PWM). 


⚙️ Prérequis

Pour faire tourner le projet sur le réseau de démonstration, la machine serveur doit posséder :Node.js (v18+) ou Python (v3.10+)Eclipse MosquittoOllamaIDE Arduino / PlatformIO pour téléverser le code C++ sur l'ESP8266


🚀 Installation & Déploiement

Étape 1 : Démarrer l'infrastructure

- Connectez tous les postes (Devs et ESP8266) sur le même routeur Wi-Fi (sans accès WAN).- Lancez le broker Mosquitto (port par défaut 1883).
- Lancez Ollama en exposant l'hôte sur le réseau local
    # Sur Windows (PowerShell)
    $env:OLLAMA_HOST="0.0.0.0"
    ollama serve
- Téléchargez le modèle IA léger
    shollama run <nom_du_modele_leger>

Étape 2 : 
- Configurer le Back-EndNaviguez dans le dossier /backend.
- Installez les dépendances
    npm install
    # ou pip install -r requirements.txt
- Copiez le fichier .env.example vers .env et configurez les adresses IP locales (Broker MQTT, API Ollama).Lancez le serveur :Bashnpm run start

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
| Tilt (Inclinaison)    | Capteur   | Détection Activité/Sommeil   | Numérique (D1)         |
| Force (Déformation)   | Capteur   | Jauge de Stress (Pression)   | Analogique (A0)        |
| Magnétique (Hall/ILS) | Capteur   | Clé médecin pour acquittement| Numérique (D2)         |
| LED RVB               | Actionneur| Statut de santé visuel       | Numérique (D5, D6,D7)  |
| Buzzer Passif         | Actionneur| Alarme (Programmation PWM)   | Numérique PWM (D8)     |
---------------------------------------------------------------------------------------------


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