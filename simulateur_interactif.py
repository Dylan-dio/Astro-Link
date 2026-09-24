import os

import httpx

API_URL = os.getenv("ASTRO_LINK_API_URL", "http://127.0.0.1:8000")
REQUEST_TIMEOUT_SECONDS = 45


def poster(path, payload=None, timeout=REQUEST_TIMEOUT_SECONDS):
    response = httpx.post(f"{API_URL}{path}", json=payload, timeout=timeout)
    response.raise_for_status()
    result = response.json()
    print(f"✅ {path}: {result}")
    return result


def main():
    print("🚀 Envoi d'une fréquence cardiaque normale à l'API...")
    poster(
        "/api/telemetrie",
        {"tilt": 0, "button": 0, "magnetic": 0, "heartRate": 72, "temperature": 36.7},
    )

    input("Appuie surx² Entrée pour simuler une CRISE CARDIAQUE (Pouls: 150 bpm)...")
    poster(
        "/api/telemetrie",
        {"tilt": 0, "button": 0, "magnetic": 0, "heartRate": 150, "temperature": 37.1},
    )

    input("Appuie sur Entrée pour simuler le passage de la CLÉ MAGNÉTIQUE...")
    poster("/api/badge_medecin")
    print(
        "État final:",
        httpx.get(f"{API_URL}/api/equipage", timeout=REQUEST_TIMEOUT_SECONDS).json(),
    )


if __name__ == "__main__":
    main()
