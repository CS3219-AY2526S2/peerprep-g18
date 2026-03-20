from fastapi import FastAPI
import firebase_admin
from firebase_admin import credentials, firestore

cred = credentials.Certificate("firebase-history-account.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

app = FastAPI(title="PeerPrep History Service")

@app.post("/history", status_code=201)
async def save_history(payload: dict):
    db.collection("session_history").document(payload["sessionId"]).set(payload)
    return {"detail": "saved"}

@app.get("/history/{user_id}")
async def get_history(user_id: str):
    docs = db.collection("session_history") \
              .where("user1_id", "==", user_id) \
              .stream()
    docs2 = db.collection("session_history") \
               .where("user2_id", "==", user_id) \
               .stream()
    results = [d.to_dict() for d in docs] + [d.to_dict() for d in docs2]
    return results
