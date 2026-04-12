# AI Assistance Disclosure:
# Tool: Gemini 3.1 Pro 
# Scope: Refactored M1 User Service to integrate Firebase Auth for credential management and Firestore for RBAC/profile data.
# Author review: I validated correctness, tested the endpoints, and ensured the business logic aligns with the project backlog. 

import os
import time
import json
import boto3
from botocore.exceptions import ClientError
from typing import Optional
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, EmailStr, Field, model_validator
import firebase_admin
from firebase_admin import credentials, firestore, auth
import redis as redis_sync

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# ==========================================
# FIREBASE & ENV INITIALIZATION (WITH SECRETS MGR)
# ==========================================
def load_secrets():
    """Load both Firebase and Backend Env secrets from AWS Secrets Manager."""
    region_name = os.getenv("AWS_REGION", "ap-southeast-1")
    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    # 1. Load Firebase Credentials
    secret_file = "firebase-service-account.json"
    cred = None
    if os.path.exists(secret_file):
        cred = credentials.Certificate(secret_file)
    else:
        print("Local firebase-service-account.json not found. Attempting to fetch from AWS...")
        try:
            resp = client.get_secret_value(SecretId="peerprep/firebase-main")
            cred = credentials.Certificate(json.loads(resp['SecretString']))
        except Exception as e:
            print(f"WARNING: Could not fetch Firebase secret from AWS: {e}. This is expected in local/CI environments.")
    
    if cred and not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
        print("Firebase Admin initialized.")
    elif not firebase_admin._apps:
        print("WARNING: Firebase Admin not initialized (no credentials found).")

    # 2. Load Backend Env Vars (SMTP, etc.)
    try:
        resp = client.get_secret_value(SecretId="peerprep/backend-env")
        env_vars = json.loads(resp['SecretString'])
        for key, value in env_vars.items():
            if not os.getenv(key): # Don't override existing env vars
                os.environ[key] = str(value)
        print("Backend environment variables loaded from Secrets Manager.")
    except Exception as e:
        print(f"Note: Could not load peerprep/backend-env from Secrets Manager: {e}")

load_secrets()
db = firestore.client()

# Redis client for auth invalidation signals (read by the API gateway)
redis_auth = redis_sync.Redis(
    host=os.getenv("REDIS_AUTH_HOST", "redis-auth"),
    port=6379,
    decode_responses=True
)

app = FastAPI(title="PeerPrep User Service (Firebase Auth Version)")

# =========================
# SCHEMAS
# =========================

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    confirm_password: str
    avatar_id: int = 1
    role: str = Field(default="User", description="RBAC Role (e.g., Admin, User)")

    @model_validator(mode='after')
    def check_passwords_match(self) -> 'UserCreate':
        if self.password != self.confirm_password:
            raise ValueError('Passwords do not match')
        return self

class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    confirm_password: Optional[str] = None
    avatar_id: Optional[int] = None

    @model_validator(mode='after')
    def check_passwords_match(self) -> 'UserUpdate':
        if self.password is not None and self.password != self.confirm_password:
            raise ValueError('Passwords do not match')
        return self

class UserResponse(BaseModel):
    user_id: str
    username: str
    email: EmailStr
    avatar_id: int
    role: str

class AvatarUpdate(BaseModel):
    avatar_id: int

# =========================
# HELPER FUNCTIONS
# =========================

def send_verification_email(receiver_email: str, verification_link: str):
    """F1.1: Helper function to send an email using Gmail's SMTP server."""
    sender_email = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD") 

    if not sender_email or not sender_password:
        print("SMTP credentials missing. Skipping email delivery.")
        return

    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = receiver_email
    msg['Subject'] = "Verify your PeerPrep Account"

    body = f"Welcome to PeerPrep!\n\nPlease verify your email by clicking the link below:\n\n{verification_link}\n\nHappy coding!"
    msg.attach(MIMEText(body, 'plain'))

    try:
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        print(f"Verification email successfully sent to {receiver_email}")
    except Exception as e:
        print(f"Failed to send email: {str(e)}")

# =========================
# ENDPOINTS
# =========================

@app.post("/users", response_model=UserResponse)
def create_user(user: UserCreate):
    """
    Endpoint for User Creation.
    Checks for unique username (case-insensitive) by streaming and filtering in the backend.
    """
    users_ref = db.collection('Users')
    target_username = user.username.lower()
    
    # Manual backend-side case-insensitive check
    all_users = users_ref.stream()
    for doc in all_users:
        existing_user = doc.to_dict()
        if existing_user.get('username', '').lower() == target_username:
            raise HTTPException(status_code=400, detail="Username already exists")

    try:
        user_record = auth.create_user(
            email=user.email,
            password=user.password
        )
        auth.set_custom_user_claims(user_record.uid, {'role': user.role})
        
        verification_link = auth.generate_email_verification_link(user.email)
        send_verification_email(user.email, verification_link)

    except auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=400, detail="Email already exists in Firebase Auth")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firebase Auth Error: {str(e)}")

    user_data = {
        "user_id": user_record.uid,
        "username": user.username,
        "email": user.email,
        "avatar_id": user.avatar_id,
        "role": user.role
    }
    
    db.collection('Users').document(user_record.uid).set(user_data)
    
    return user_data

@app.get("/users/{user_id}", response_model=UserResponse)
def get_user(user_id: str):
    """
    Endpoint for retrieving user profile data.
    """
    doc_ref = db.collection('Users').document(user_id)
    doc = doc_ref.get()
    
    if doc.exists:
        return doc.to_dict()
    else:
        raise HTTPException(status_code=404, detail="User profile not found in database")

@app.get("/users/lookup/{username}")
def lookup_email_by_username(username: str):
    """
    Helper endpoint for looking up email (case-insensitive) via backend filtering.
    """
    users_ref = db.collection('Users')
    target_username = username.lower()
    
    all_users = users_ref.stream()
    for doc in all_users:
        user_data = doc.to_dict()
        if user_data.get('username', '').lower() == target_username:
            return {"email": user_data.get("email")}
        
    raise HTTPException(status_code=404, detail="Username not found")

@app.patch("/users/{user_id}")
def update_user(user_id: str, update_data: UserUpdate, x_user_id: str = Header(...)):
    """
    Endpoint for updating user profile.
    Performs case-insensitive uniqueness check in backend if username is changing.
    """
    if x_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this profile")
    
    doc_ref = db.collection('Users').document(user_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_dict = {}

    if update_data.username:
        users_ref = db.collection('Users')
        target_username = update_data.username.lower()
        
        # Manual backend-side check
        all_users = users_ref.stream()
        for u in all_users:
            if u.id != user_id and u.to_dict().get('username', '').lower() == target_username:
                raise HTTPException(status_code=400, detail="Username already exists")
        
        update_dict['username'] = update_data.username

    # Check for lowercase 'avatar_id'
    if update_data.avatar_id is not None:
        update_dict['avatar_id'] = update_data.avatar_id

    if update_data.password:
        try:
            auth.update_user(user_id, password=update_data.password)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Firebase Auth Error: {str(e)}")

    if update_dict:
        doc_ref.update(update_dict)

    return {"message": "User profile updated successfully"}

# --- DELETE USER (Self) ---
@app.delete("/users/{user_id}")
def delete_self(user_id: str, x_user_id: str = Header(...)):
    """
    Endpoint for users to delete their own account.
    """
    if x_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this profile")
    
    return perform_delete(user_id)

# --- DELETE USER (Admin) ---
@app.delete("/admin/users/{user_id}")
def delete_user_admin(user_id: str, x_user_role: str = Header(None)):
    """
    Endpoint for admins to delete any account (except Root).
    """
    role_check = x_user_role.strip().lower() if x_user_role else ""
    if role_check not in ["admin", "root"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    return perform_delete(user_id)

def perform_delete(user_id: str):
    doc_ref = db.collection('Users').document(user_id)
    doc = doc_ref.get()

    if doc.exists and doc.to_dict().get("role") == "Root":
        raise HTTPException(status_code=403, detail="The Root admin cannot be deleted")

    try:
        auth.delete_user(user_id)
        db.collection('Users').document(user_id).delete()
    except auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="User not found in Firebase Auth")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Revoke all Firebase refresh tokens so the client cannot silently obtain
    # a new JWT after deletion. This blocks the Firebase-level token refresh.
    try:
        auth.revoke_refresh_tokens(user_id)
    except Exception as e:
        print(f"Failed to revoke Firebase tokens for {user_id}: {e}")

    # Blacklist the UID in Redis so the API gateway immediately rejects any
    # still-valid JWT (tokens live up to 1 hour after issuance).
    # TTL = 3600s covers the full Firebase token lifetime.
    try:
        redis_auth.setex(f"invalidated_user:{user_id}", 3600, "1")
    except Exception as e:
        print(f"Failed to write invalidated_user to Redis for {user_id}: {e}")

    return {"message": f"User {user_id} deleted successfully"}


# --- GET ALL USERS ---
@app.get("/admin/users")
def get_all_users(x_user_role: str = Header(None)):
    role_check = x_user_role.strip().lower() if x_user_role else ""
    if role_check not in ["admin", "root"]:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    users_ref = db.collection('Users')
    all_users = []
    
    for doc in users_ref.stream():
        all_users.append(doc.to_dict())
            
    return all_users


# --- PROMOTE USER ---
@app.post("/admin/promote/{target_user_id}")
def promote_user(target_user_id: str, x_user_role: str = Header(None)):
    role_check = x_user_role.strip().lower() if x_user_role else ""
    if role_check not in ["admin", "root"]:
        raise HTTPException(status_code=403, detail="Admin access required")
        
    doc_ref = db.collection('Users').document(target_user_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
        
    current_role = doc.to_dict().get("role")
    if current_role == "Admin" or current_role == "Root":
        return {"message": f"User is already an {current_role}"}
        
    doc_ref.update({"role": "Admin"})
    auth.set_custom_user_claims(target_user_id, {'role': "Admin"})

    # Signal the API gateway that any token issued before this moment carries
    # stale claims (role=User). The gateway compares the token's iat against
    # this timestamp and returns 403 TOKEN_STALE if the token predates the
    # promotion, prompting the client to silently refresh its token.
    # TTL = 3600s covers the full Firebase token lifetime.
    try:
        redis_auth.setex(f"stale_claims:{target_user_id}", 3600, str(int(time.time())))
    except Exception as e:
        print(f"Failed to write stale_claims to Redis for {target_user_id}: {e}")

    return {"message": "User promoted to Admin successfully"}


# --- UPDATE AVATAR ---
@app.patch("/users/{user_id}/avatar")
def update_avatar(user_id: str, data: AvatarUpdate, x_user_id: str = Header(...)):
    """Updates avatar_id for the given user."""
    if x_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    doc_ref = db.collection('Users').document(user_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="User not found")

    doc_ref.update({"avatar_id": data.avatar_id})
    return {"message": "Avatar updated successfully"}

from mangum import Mangum
handler = Mangum(app, lifespan="off")