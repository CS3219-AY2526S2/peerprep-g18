import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

key_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

# Initialize Firestore
if os.path.exists(key_path):
    cred = credentials.Certificate(key_path)
    firebase_admin.initialize_app(cred)
else:
    firebase_admin.initialize_app()

db = firestore.client()