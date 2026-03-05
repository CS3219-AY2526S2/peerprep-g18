import firebase_admin
from firebase_admin import credentials, firestore

# Initialize Firestore
# Note: Ensure the JSON key is in your project root or set via ENV
cred = credentials.Certificate("firebase-questionservice.json")
firebase_admin.initialize_app(cred)

db = firestore.client()