import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

key_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "firebase-questionservice.json")

# Initialize Firestore
if key_path and os.path.exists(key_path):
    cred = credentials.Certificate(key_path)
    firebase_admin.initialize_app(cred)
else:
    # Fallback to default credentials (e.g., if running in GCP)
    try:
        firebase_admin.initialize_app()
    except ValueError:
        # App might already be initialized or we need to provide a default empty init
        pass

db = firestore.client()