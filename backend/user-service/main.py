# AI Assistance Disclosure:
# Tool: Gemini 3.1 Pro 
# Scope: Refactored M1 User Service to integrate Firebase Auth for credential management and Firestore for RBAC/profile data.
# Author review: I validated correctness, tested the endpoints, and ensured the business logic aligns with the project backlog. 

import os
from typing import Optional
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, EmailStr, Field, model_validator
import firebase_admin
from firebase_admin import credentials, firestore, auth

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# Initialize Firebase Admin
cred = credentials.Certificate("firebase-service-account.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

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

@app.post("/users/", response_model=UserResponse)
def create_user(user: UserCreate):
    """
    Endpoint for User Creation.
    Checks for unique username in Firestore, creates user in Firebase Auth,
    generates email verification link, and stores profile data in Firestore.
    """
    users_ref = db.collection('Users')
    username_query = users_ref.where('username', '==', user.username).stream()
    if any(username_query):
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
    Helper endpoint for looking up a user's email by their username.
    Used during login to allow users to enter either their email or username.
    """
    users_ref = db.collection('Users')
    username_query = users_ref.where('username', '==', username).stream()
    
    for doc in username_query:
        return {"email": doc.to_dict().get("email")}
        
    raise HTTPException(status_code=404, detail="Username not found")

@app.patch("/users/{user_id}")
def update_user(user_id: str, update_data: UserUpdate, x_user_id: str = Header(...)):
    """
    Helper endpoint for updating user profile data.
    Checks if the authenticated user matches the user_id being updated, then
    handles password changes via Firebase Auth and updates other profile fields in Firestore.
    """
    if x_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to edit this profile")
    
    doc_ref = db.collection('Users').document(user_id)
    doc = doc_ref.get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_dict = {}

    # Check for lowercase 'username' in update_data
    if update_data.username:
        users_ref = db.collection('Users')
        # Query lowercase 'username' in Firestore
        username_query = users_ref.where('username', '==', update_data.username).stream()
        for u in username_query:
            if u.id != user_id:
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

@app.delete("/users/{user_id}")
def delete_user(user_id: str, x_user_id: str = Header(...)):
    """
    Endpoint for deleting a user.
    Checks if the authenticated user matches the user_id being deleted, then
    deletes the user from Firebase Auth and Firestore.
    """
    if x_user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this profile")
    
    try:
        auth.delete_user(user_id)
        db.collection('Users').document(user_id).delete()
        return {"message": f"User {user_id} deleted successfully from Auth and Database"}
    except auth.UserNotFoundError:
        raise HTTPException(status_code=404, detail="User not found in Firebase Auth")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))