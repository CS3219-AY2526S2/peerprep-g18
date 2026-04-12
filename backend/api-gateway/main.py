# AI Assistance Disclosure:
# Tool: Gemini 3.1 Pro
# Scope: Generated API Gateway to centralize Firebase Auth, handle CORS, and reverse-proxy requests to underlying microservices.
# Author review: I validated the proxy logic, tested header injection, and configured the routing table.

import os
import uuid
import json
import asyncio
import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx
import redis.asyncio as redis
import firebase_admin
from firebase_admin import credentials, auth

# ==========================================
# FIREBASE INITIALIZATION (WITH SECRETS MGR)
# ==========================================
def get_firebase_credentials():
    secret_file = "firebase-service-account.json"
    if os.path.exists(secret_file):
        return credentials.Certificate(secret_file)

    # Fallback to AWS Secrets Manager (for Lambda deployment)
    print("Local firebase-service-account.json not found. Attempting to fetch from AWS Secrets Manager...")
    secret_name = "peerprep/firebase-main"
    region_name = os.getenv("AWS_REGION", "ap-southeast-1")

    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        if 'SecretString' in get_secret_value_response:
            secret_data = json.loads(get_secret_value_response['SecretString'])
            # Certificate can also take a dict
            return credentials.Certificate(secret_data)
        else:
            raise Exception("SecretString not found in Secrets Manager response")
    except Exception as e:
        print(f"WARNING: Could not fetch secret from AWS: {str(e)}. This is expected in local/CI environments.")
        return None

# Initialize Firebase
if not firebase_admin._apps:
    try:
        cred = get_firebase_credentials()
        if cred:
            firebase_admin.initialize_app(cred)
            print("Firebase Admin initialized successfully.")
        else:
            print("WARNING: Firebase Admin not initialized (no credentials found).")
    except Exception as e:
        print(f"WARNING: Firebase initialization failed: {str(e)}")

app = FastAPI(title="PeerPrep API Gateway")

# ==========================================
# CORS CONFIGURATION
# ==========================================
# This handles preflight (OPTIONS) requests. 
# In AWS API Gateway HTTP APIs with a proxy route, the Lambda must handle CORS.
frontend_url = os.getenv("FRONTEND_URL", "*")
origins = [frontend_url, "http://localhost:5173"] if frontend_url != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True if frontend_url != "*" else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

http_client = httpx.AsyncClient()
redis_sessions: redis.Redis = None
redis_auth: redis.Redis = None

@app.on_event("startup")
async def startup():
    global redis_sessions, redis_auth

    sessions_host = os.getenv("REDIS_SESSIONS_HOST", "redis-sessions")
    redis_sessions = redis.Redis(host=sessions_host, port=6379, decode_responses=True)
    print("Gateway connected to Redis Sessions DB!")

    auth_host = os.getenv("REDIS_AUTH_HOST", "redis-auth")
    redis_auth = redis.Redis(host=auth_host, port=6379, decode_responses=True)
    print("Gateway connected to Redis Auth DB!")

@app.on_event("shutdown")
async def shutdown_event():
    await http_client.aclose()
    if redis_sessions:
        await redis_sessions.close()
    if redis_auth:
        await redis_auth.close()

# ==========================================
# MICROSERVICE ROUTING TABLE
# ==========================================
# Maps the first part of the URL path to the internal microservice address.
SERVICES = {
    "users":    os.getenv("USER_SERVICE_URL", "http://user-service:6767"),
    "admin":    os.getenv("USER_SERVICE_URL", "http://user-service:6767"),
    "question": os.getenv("QUESTION_SERVICE_URL", "http://question-service:6768"),
    "matching": os.getenv("MATCHING_SERVICE_URL", "http://matching-service:6769"),
    "collab":   os.getenv("COLLAB_SERVICE_URL", "http://collab-service:4000"),
    "history":  os.getenv("HISTORY_SERVICE_URL", "http://history-service:6770"),
}

# Routes that DO NOT require authentication (e.g., login, registration)
PUBLIC_ROUTES = [
    ("POST", "/users"),
    ("GET", "/users/lookup")
]

async def verify_token(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Header")

    token = auth_header.split(" ")[1]

    try:
        decoded_token = auth.verify_id_token(token, clock_skew_seconds=30)
    except Exception as e:
        print(f"FIREBASE ERROR: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Auth Failed: {str(e)}")
    
    uid = decoded_token.get("uid")
    iat = decoded_token.get("iat", 0)  # Token issued-at timestamp (Unix seconds)

    # -------------------------------------------------------
    # Redis auth-state checks (fail open: skip if Redis is down)
    # -------------------------------------------------------
    try:
        # 1. Was this user deleted by an admin?
        if await redis_auth.exists(f"invalidated_user:{uid}"):
            raise HTTPException(status_code=401, detail="ACCOUNT_DELETED")

        # 2. Were this user's claims updated after this token was issued?
        #    (e.g. promoted to admin — token still carries old role)
        stale_ts = await redis_auth.get(f"stale_claims:{uid}")
        if stale_ts and iat <= int(stale_ts):
            raise HTTPException(status_code=403, detail="TOKEN_STALE")
    except HTTPException:
        raise  # Always re-raise our own 401/403 decisions
    except Exception as e:
        print(f"Redis auth check failed (failing open): {e}")

    return decoded_token

# ==========================================
# DISTRIBUTED SESSION INITIALIZATION
# ==========================================
@app.post("/session/init")
async def initialize_collab_session(request: Request):
    """
    Both matched users will hit this endpoint simultaneously.
    We use a Redis SETNX lock to elect a leader to provision the room.
    Leader will get required details like question
    """
    decoded = await verify_token(request)
    uid = decoded["uid"]
    
    body = await request.json()
    peer_id = body.get("peer_id")
    topic = body.get("topic")
    difficulty = body.get("difficulty")

    if not peer_id:
        raise HTTPException(status_code=400, detail="Missing peer_id")

    # Create a consistent, alphabetical lock key so both users target the exact same string
    users = sorted([uid, peer_id])
    lock_key = f"lock:match:{users[0]}:{users[1]}"

    # Generate a potential Room ID
    my_generated_room_id = str(uuid.uuid4())

    # The Atomic Race
    # SETNX returns True if it successfully set the key, False if the key already existed.
    is_leader = await redis_sessions.setnx(lock_key, my_generated_room_id)
    
    # Set a 5s expiration on the lock
    await redis_sessions.expire(lock_key, 5) 

    if is_leader:
        # --- LEADER LOGIC ---
        final_room_id = my_generated_room_id
        
        # Fetch question
        question_id = "1"
        try:
            target_question_service = os.getenv("QUESTION_SERVICE_URL", "http://question-service:6768").rstrip("/")
            response = await http_client.get(
                f"{target_question_service}/question/", 
                params={"topic": topic, "difficulty": difficulty},
                timeout=5.0
            )
            if response.status_code == 200:
                q_data = response.json()
                question_id = q_data.get("question_id", question_id)
        except Exception as e:
            print(f"Leader failed to fetch question from Question Service: {str(e)}")

        # Write the shared metadata for the Collab Service to use
        from datetime import datetime, timezone
        utc_time = datetime.now(timezone.utc).isoformat()

        meta_payload = json.dumps({
            "user1_id": users[0],
            "user2_id": users[1],
            "topic": topic,
            "difficulty": difficulty,
            "questionId": question_id,
            "startedAt": utc_time
        })        
        # Session expires in 2 hours
        await redis_sessions.setex(f"session:{final_room_id}:meta", 7200, meta_payload)
        await redis_sessions.setex(f"active_session:{users[0]}", 7200, final_room_id)
        await redis_sessions.setex(f"active_session:{users[1]}", 7200, final_room_id)
        print(f"I am the LEADER. Provisioned room: {final_room_id} with Question: {question_id}")

    else:
        # --- FOLLOWER LOGIC ---
        final_room_id = await redis_sessions.get(lock_key)
        
        # Briefly poll to ensure the Leader finished writing the meta payload
        for _ in range(50):
            meta = await redis_sessions.get(f"session:{final_room_id}:meta")
            if meta:
                break
            await asyncio.sleep(0.2)
            
        print(f"I am the FOLLOWER. Joining existing room: {final_room_id}")

    # Both leader and follower return the exact same room_id to the React frontend
    return {"room_id": final_room_id}

# ==========================================
# CATCH-ALL PROXY ROUTE
# ==========================================

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def gateway_proxy(request: Request, path: str):
    """
    The core proxy function. Catches all requests, authenticates them,
    and forwards them to the correct microservice.
    """
    path_parts = path.split("/")
    service_prefix = path_parts[0] if path_parts else ""

    if service_prefix not in SERVICES:
        raise HTTPException(status_code=404, detail="Service not found")

    target_base_url = SERVICES[service_prefix].rstrip("/")
    target_url = f"{target_base_url}/{path}"

    if request.url.query:
        target_url += f"?{request.url.query}"

    is_public = any(
        request.method == pub_method and f"/{path}".startswith(pub_path)
        for pub_method, pub_path in PUBLIC_ROUTES
    )

    user_headers = {}
    if not is_public:
        decoded_token = await verify_token(request)
        user_headers["X-User-Id"] = decoded_token.get("uid")

        if "role" in decoded_token:
            user_headers["X-User-Role"] = decoded_token.get("role")

    forwarded_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ["host", "authorization"]
    }
    forwarded_headers.update(user_headers)

    body = await request.body()

    try:
        target_response = await http_client.request(
            method=request.method,
            url=target_url,
            headers=forwarded_headers,
            content=body,
            timeout=10.0
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Target service unavailable: {str(e)}")

    # Strip CORS headers from upstream — nginx owns CORS for /api/ requests.
    # Forwarding upstream CORS headers alongside nginx's would produce duplicates.
    cors_headers = {
        "access-control-allow-origin",
        "access-control-allow-methods",
        "access-control-allow-headers",
        "access-control-allow-credentials",
        "access-control-max-age",
    }
    filtered_headers = {
        k: v for k, v in target_response.headers.items()
        if k.lower() not in cors_headers
    }
    return Response(
        content=target_response.content,
        status_code=target_response.status_code,
        headers=filtered_headers
    )

from mangum import Mangum
handler = Mangum(app, lifespan="auto")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=1234, reload=True)
