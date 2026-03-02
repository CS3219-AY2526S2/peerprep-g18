# AI Assistance Disclosure:
# Tool: Gemini 3.1 Pro 
# Scope: Refactored M1 User Service to integrate Firebase Auth for credential management and Firestore for RBAC/profile data.
# Author review: I validated correctness, tested the endpoints, and ensured the business logic aligns with the project backlog. 

import os
from typing import Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr, Field, model_validator
import firebase_admin
from firebase_admin import credentials, firestore, auth

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends

# Initialize Firebase Admin
cred = credentials.Certificate("firebase-service-account.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

app = FastAPI(title="PeerPrep User Service (Firebase Auth Version)")

security = HTTPBearer()

# =========================
# SCHEMAS
# =========================

class UserCreate(BaseModel):
    Username: str
    Email: EmailStr
    Password: str
    ConfirmPassword: str
    AvatarID: int = 1
    Role: str = Field(default="User", description="RBAC Role (e.g., Admin, User)")

    @model_validator(mode='after')
    def check_passwords_match(self) -> 'UserCreate':
        if self.Password != self.ConfirmPassword:
            raise ValueError('Passwords do not match')
        return self

class UserUpdate(BaseModel):
    Username: Optional[str] = None
    Password: Optional[str] = None
    ConfirmPassword: Optional[str] = None
    AvatarID: Optional[int] = None

    @model_validator(mode='after')
    def check_passwords_match(self) -> 'UserUpdate':
        if self.Password is not None and self.Password != self.ConfirmPassword:
            raise ValueError('Passwords do not match')
        return self

class UserResponse(BaseModel):
    UserID: str
    Username: str
    Email: EmailStr
    AvatarID: int
    Role: str

# =========================
# HELPER FUNCTIONS
# =========================

def verify_firebase_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    The Bouncer: Intercepts the request, extracts the JWT, and asks Firebase if it is valid.
    """
    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {str(e)}")

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
        # Connect to Gmail's SMTP server
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls() # Secure the connection
        server.login(sender_email, sender_password)
        server.send_message(msg)
        server.quit()
        print(f"Verification email successfully sent to {receiver_email}")
    except Exception as e:
        print(f"Failed to send email: {str(e)}")

# =========================
# ENDPOINTS
# =========================

@app.post("/users/", response_model=UserResponse)
def create_user(user: UserCreate):
    """
    Endpoint for User Creation.
    Checks for unique username in Firestore, creates user in Firebase Auth,
    generates email verification link, and stores profile data in Firestore.
    """
    users_ref = db.collection('Users')
    username_query = users_ref.where('Username', '==', user.Username).stream()
    if any(username_query):
        raise HTTPException(status_code=400, detail="Username already exists")

    try:
        user_record = auth.create_user(
            email=user.Email,
            password=user.Password
        )
        
        verification_link = auth.generate_email_verification_link(user.Email)
        send_verification_email(user.Email, verification_link)

    except auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=400, detail="Email already exists in Firebase Auth")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Firebase Auth Error: {str(e)}")

    user_data = {
        "UserID": user_record.uid,
        "Username": user.Username,
        "Email": user.Email,
        "AvatarID": user.AvatarID,
        "Role": user.Role
    }
    
    db.collection('Users').document(user_record.uid).set(user_data)
    
    return user_data

@app.get("/users/{user_id}", response_model=UserResponse)
def get_user(user_id: str):
    """
    Endpoint for retrieving user profile data.
    Fetches user data from Firestore based on UserID.
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
    Helper endpoint for Username Login.
    The frontend sends the username here, gets the email back, 
    and then uses that email to authenticate with Firebase Auth.
    """
    users_ref = db.collection('Users')
    username_query = users_ref.where('Username', '==', username).stream()
    
    for doc in username_query:
        return {"Email": doc.to_dict().get("Email")}
        
    raise HTTPException(status_code=404, detail="Username not found")

@app.patch("/users/{user_id}")
def update_user(user_id: str, update_data: UserUpdate, token: dict = Depends(verify_firebase_token)):
    """
    Helper endpoint for updating user profile data.
    Checks if the authenticated user matches the user_id being updated, then
    handles password changes via Firebase Auth and updates other profile fields in Firestore.
    """
    if token.get("uid") != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this profile")
    
    doc_ref = db.collection('Users').document(user_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_dict = {}

    if update_data.Username:
        users_ref = db.collection('Users')
        username_query = users_ref.where('Username', '==', update_data.Username).stream()
        for u in username_query:
            if u.id != user_id:
                raise HTTPException(status_code=400, detail="Username already exists")
        update_dict['Username'] = update_data.Username

    if update_data.AvatarID is not None:
        update_dict['AvatarID'] = update_data.AvatarID

    if update_data.Password:
        try:
            auth.update_user(user_id, password=update_data.Password)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Firebase Auth Error: {str(e)}")

    if update_dict:
        doc_ref.update(update_dict)

    return {"message": "User profile updated successfully"}

@app.delete("/users/{user_id}")
def delete_user(user_id: str, token: dict = Depends(verify_firebase_token)):
    """
    Endpoint for deleting a user.
    Checks if the authenticated user matches the user_id being deleted, then
    deletes the user from Firebase Auth and Firestore.
    """
    if token.get("uid") != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this profile")
    
    try:
        auth.delete_user(user_id)
        db.collection('Users').document(user_id).delete()
        return {"message": f"User {user_id} deleted successfully from Auth and Database"}
    except auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="User not found in Firebase Auth")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))