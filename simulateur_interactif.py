import httpx

API_URL = "http://127.0.0.1:8000"


def poster(path, payload=None):
    response = httpx.post(f"{API_URL}{path}", json=payload, timeout=10)
    response.raise_for_status()
    print(f"✅ {path}: {response.json()}")


print("🚀 Envoi de constantes normales à l'API...")
poster("/api/telemetrie", {"force": 150, "tilt": 0})

input("Appuie sur Entrée pour simuler une CRISE PANURGIQUE (Force: 950)...")
poster("/api/telemetrie", {"force": 950, "tilt": 0})

input("Appuie sur Entrée pour simuler le passage de la CLÉ MAGNÉTIQUE...")
poster("/api/badge_medecin")
print("État final:", httpx.get(f"{API_URL}/api/equipage", timeout=10).json())