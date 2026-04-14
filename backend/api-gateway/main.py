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

_firebase_initialized = False

def _init_firebase():
    global _firebase_initialized
    if _firebase_initialized or firebase_admin._apps:
        return
    try:
        cred = get_firebase_credentials()
        if cred:
            firebase_admin.initialize_app(cred)
            print("Firebase Admin initialized successfully.")
        else:
            print("WARNING: Firebase Admin not initialized (no credentials found).")
    except Exception as e:
        print(f"WARNING: Firebase initialization failed: {str(e)}")
    _firebase_initialized = True

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

http_client: httpx.AsyncClient = None
redis_sessions: redis.Redis = None
redis_auth: redis.Redis = None

def get_http_client():
    global http_client
    if http_client is None or http_client.is_closed:
        http_client = httpx.AsyncClient()
    return http_client

def get_redis_sessions():
    # Lazy initialisation — reused across warm Lambda invocations.
    global redis_sessions
    if redis_sessions is None:
        sessions_host = os.getenv("REDIS_SESSIONS_HOST", "redis-sessions")
        redis_sessions = redis.Redis(host=sessions_host, port=6379, decode_responses=True)
        print("Gateway connected to Redis Sessions DB!")
    return redis_sessions

def get_redis_auth():
    # Lazy initialisation — reused across warm Lambda invocations.
    global redis_auth
    if redis_auth is None:
        auth_host = os.getenv("REDIS_AUTH_HOST", "redis-auth")
        redis_auth = redis.Redis(host=auth_host, port=6379, decode_responses=True)
        print("Gateway connected to Redis Auth DB!")
    return redis_auth

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
    _init_firebase()
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Header")

    token = auth_header.split(" ")[1]
    if not token or token.lower() == "null":
        raise HTTPException(status_code=401, detail="Invalid Token")

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
        if await get_redis_auth().exists(f"invalidated_user:{uid}"):
            raise HTTPException(status_code=401, detail="ACCOUNT_DELETED")

        # 2. Were this user's claims updated after this token was issued?
        #    (e.g. promoted to admin — token still carries old role)
        stale_ts = await get_redis_auth().get(f"stale_claims:{uid}")
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
    is_leader = await get_redis_sessions().setnx(lock_key, my_generated_room_id)
    
    # Set a 5s expiration on the lock
    await get_redis_sessions().expire(lock_key, 5) 

    print(f"[session/init] uid={uid} peer={peer_id} topic={topic} difficulty={difficulty} is_leader={is_leader}")

    if is_leader:
        # --- LEADER LOGIC ---
        final_room_id = my_generated_room_id

        # Fetch question
        question_id = "1"
        try:
            target_question_service = os.getenv("QUESTION_SERVICE_URL", "http://question-service:6768").rstrip("/")
            question_url = f"{target_question_service}/question/"
            print(f"[session/init] Fetching question from {question_url} params={{topic={topic}, difficulty={difficulty}}}")
            response = await get_http_client().get(
                question_url,
                params={"topic": topic, "difficulty": difficulty},
                timeout=20.0
            )
            print(f"[session/init] Question service responded: status={response.status_code} body={response.text[:200]}")
            if response.status_code == 200:
                q_data = response.json()
                question_id = q_data.get("question_id", question_id)
                print(f"[session/init] Resolved question_id={question_id}")
            else:
                print(f"[session/init] Non-200 from question service — falling back to question_id=1")
        except Exception as e:
            print(f"[session/init] Exception fetching question: {type(e).__name__}: {str(e)}")

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
        await get_redis_sessions().setex(f"session:{final_room_id}:meta", 7200, meta_payload)
        await get_redis_sessions().setex(f"active_session:{users[0]}", 7200, final_room_id)
        await get_redis_sessions().setex(f"active_session:{users[1]}", 7200, final_room_id)
        print(f"[session/init] LEADER provisioned room={final_room_id} question_id={question_id}")

    else:
        # --- FOLLOWER LOGIC ---
        final_room_id = await get_redis_sessions().get(lock_key)
        print(f"[session/init] FOLLOWER joining room={final_room_id}")

        # Briefly poll to ensure the Leader finished writing the meta payload
        for attempt in range(50):
            meta = await get_redis_sessions().get(f"session:{final_room_id}:meta")
            if meta:
                print(f"[session/init] FOLLOWER got meta after {attempt + 1} poll(s)")
                break
            await asyncio.sleep(0.2)
        else:
            print(f"[session/init] FOLLOWER timed out waiting for meta on room={final_room_id}")

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
        target_response = await get_http_client().request(
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
# api_gateway_base_path="/api": strips the /api prefix that CloudFront forwards for AWS API Gateway
# invocations. Has no effect when running locally via uvicorn (where nginx strips /api already).
# lifespan="off": prevents Mangum from triggering startup/shutdown events on every Lambda
# invocation, which would otherwise close and re-open Redis connections on each request.
handler = Mangum(app, lifespan="off", api_gateway_base_path="/api")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=1234, reload=True)
