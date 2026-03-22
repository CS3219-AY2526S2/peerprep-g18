# AI Assistance Disclosure:
# Tool: Gemini 3.1 Pro
# Scope: Generated API Gateway to centralize Firebase Auth, handle CORS, and reverse-proxy requests to underlying microservices.
# Author review: I validated the proxy logic, tested header injection, and configured the routing table.

import os
import asyncio
import json
import uuid
import time
from urllib.parse import urlparse, parse_qs
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import firebase_admin
from firebase_admin import credentials, auth
from redis.asyncio import Redis as AsyncRedis

cred = credentials.Certificate("firebase-service-account.json")
firebase_admin.initialize_app(cred)

app = FastAPI(title="PeerPrep API Gateway")

http_client = httpx.AsyncClient()

redis_sessions: AsyncRedis = None
redis_events: AsyncRedis = None

@app.on_event("startup")
async def startup():
    global redis_sessions, redis_events
    redis_sessions = AsyncRedis(
        host=os.getenv("REDIS_SESSIONS_HOST", "redis-sessions"), port=6379, decode_responses=True
    )
    redis_events = AsyncRedis(
        host=os.getenv("REDIS_EVENT_BUS_HOST", "redis-event-bus"), port=6379, decode_responses=True
    )

@app.on_event("shutdown")
async def shutdown_event():
    await http_client.aclose()
    if redis_sessions:
        await redis_sessions.aclose()
    if redis_events:
        await redis_events.aclose()

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )

# ==========================================
# MICROSERVICE ROUTING TABLE
# ==========================================
# Maps the first part of the URL path to the internal microservice address.
# When running locally, use localhost. In Docker Compose later, use container names.
SERVICES = {
    "users": "http://user-service:6767",
    "admin": "http://user-service:6767",
    "question": "http://question-service:6768",
    "matching": "http://matching-service:6769",
    # collab routes are handled directly below — not proxied
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
        return decoded_token
    except Exception as e:
        print(f"❌ FIREBASE ERROR: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Auth Failed: {str(e)}")

# ==========================================
# SESSION CREATION HELPER
# ==========================================
async def create_or_join_session(match_data: dict, uid: str) -> dict:
    uid_A, uid_B = match_data["user1_id"], match_data["user2_id"]
    match_id = match_data.get("match_id", f"{':'.join(sorted([uid_A, uid_B]))}:{match_data.get('topic', '')}:{match_data.get('difficulty', '')}:{match_data.get('matched_at', '')}")
    lock_key = f"lock:match:{match_id}"
    session_id = str(uuid.uuid4())

    is_leader = await redis_sessions.setnx(lock_key, session_id)
    await redis_sessions.expire(lock_key, 7200)  # 2-hour session TTL

    if is_leader:
        # Internal call to question service (no auth headers needed)
        r = await http_client.get(
            "http://question-service:6768/question/",
            params={"topic": match_data["topic"], "difficulty": match_data["difficulty"]}
        )
        question_id = r.json()["question_id"]
        meta = {
            "user1_id": uid_A, "user2_id": uid_B,
            "questionId": question_id,
            "topic": match_data["topic"], "difficulty": match_data["difficulty"],
            "startedAt": time.time()
        }
        await redis_sessions.set(f"session:{session_id}:meta", json.dumps(meta), ex=7200)
        # Track active session for both users
        await redis_sessions.set(f"active_session:{uid_A}", session_id, ex=7200)
        await redis_sessions.set(f"active_session:{uid_B}", session_id, ex=7200)
        return {"sessionId": session_id, "questionId": question_id}
    else:
        winning_id = await redis_sessions.get(lock_key)
        for _ in range(50):
            raw = await redis_sessions.get(f"session:{winning_id}:meta")
            if raw:
                meta = json.loads(raw)
                return {"sessionId": winning_id, "questionId": meta["questionId"]}
            await asyncio.sleep(0.2)
        raise HTTPException(503, "Session init timeout")

# ==========================================
# COLLAB ENDPOINTS (declared before catch-all)
# ==========================================

@app.get("/matching/events")
async def match_events(request: Request):
    decoded = await verify_token(request)
    uid = decoded["uid"]

    async def stream():
        pubsub = redis_events.pubsub()
        await pubsub.subscribe(f"match_events:{uid}")
        try:
            yield 'event: connected\ndata: {}\n\n'
            async for msg in pubsub.listen():
                if msg["type"] != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                except Exception:
                    continue
                if data["event"] == "match":
                    try:
                        result = await create_or_join_session(data, uid)
                        yield f"event: match_found\ndata: {json.dumps(result)}\n\n"
                    except Exception as e:
                        print(f"Session creation error for {uid}: {e}")
                        yield f"event: error\ndata: {json.dumps({'message': 'Session creation failed'})}\n\n"
                elif data["event"] == "timeout":
                    yield 'event: timeout\ndata: {}\n\n'
                    break
        finally:
            await pubsub.unsubscribe(f"match_events:{uid}")
            await pubsub.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/collab/session/{session_id}")
async def get_session(session_id: str, request: Request):
    decoded = await verify_token(request)
    uid = decoded["uid"]
    raw = await redis_sessions.get(f"session:{session_id}:meta")
    if not raw:
        raise HTTPException(404, "Session not found")
    meta = json.loads(raw)
    if uid not in [meta["user1_id"], meta["user2_id"]]:
        raise HTTPException(403, "Not a member of this session")
    return {**meta, "sessionId": session_id}

@app.get("/collab/active-session")
async def get_active_session(request: Request):
    decoded = await verify_token(request)
    uid = decoded["uid"]
    session_id = await redis_sessions.get(f"active_session:{uid}")
    if not session_id:
        return {"sessionId": None}
    # Verify the session still exists
    raw = await redis_sessions.get(f"session:{session_id}:meta")
    if not raw:
        await redis_sessions.delete(f"active_session:{uid}")
        return {"sessionId": None}
    return {"sessionId": session_id}

@app.post("/collab/join")
async def collab_join(request: Request):
    decoded = await verify_token(request)
    uid = decoded["uid"]
    body = await request.json()
    session_id = body.get("sessionId")
    if not session_id:
        raise HTTPException(400, "sessionId required")

    raw = await redis_sessions.get(f"session:{session_id}:meta")
    if not raw:
        raise HTTPException(404, "Session not found")
    meta = json.loads(raw)
    if uid not in [meta["user1_id"], meta["user2_id"]]:
        raise HTTPException(403, "Not a member of this session")

    ticket = str(uuid.uuid4())
    await redis_sessions.set(
        f"ticket:{ticket}",
        json.dumps({"uid": uid, "sessionId": session_id}),
        ex=60  # 60-second one-time use
    )
    return {"ticket": ticket}

@app.post("/collab/end-session/{session_id}")
async def end_session_for_user(session_id: str, request: Request):
    decoded = await verify_token(request)
    uid = decoded["uid"]
    raw = await redis_sessions.get(f"session:{session_id}:meta")
    if not raw:
        raise HTTPException(404, "Session not found")
    meta = json.loads(raw)
    if uid not in [meta["user1_id"], meta["user2_id"]]:
        raise HTTPException(403, "Not a member of this session")
    # Clear active session for this user so ActiveSessionRedirect won't redirect back
    await redis_sessions.delete(f"active_session:{uid}")
    return {"detail": "Active session cleared"}

@app.get("/internal/validate")
async def internal_validate(request: Request):
    ticket = request.query_params.get("ticket")
    if not ticket:
        return Response(status_code=401)

    val = await redis_sessions.getdel(f"ticket:{ticket}")
    if not val:
        return Response(status_code=401)

    data = json.loads(val)
    return Response(status_code=200, headers={
        "X-User-Id": data["uid"],
        "X-Session-Id": data["sessionId"]
    })

@app.post("/internal/collab/user-ended/{session_id}")
async def user_ended(session_id: str, request: Request):
    body = await request.json()
    user_id = body["userId"]
    final_code = body.get("finalCode", "")

    raw = await redis_sessions.get(f"session:{session_id}:meta")
    if not raw:
        return {"detail": "Session not found"}
    meta = json.loads(raw)

    history_payload = {
        **meta,
        "sessionId": session_id,
        "finalCode": final_code,
        "endedAt": time.time(),
        "submittedBy": user_id
    }
    await http_client.post("http://history-service:6770/history", json=history_payload)

    # Clear active session tracking for this user
    await redis_sessions.delete(f"active_session:{user_id}")

    # Flag this user's history as saved so cleanup doesn't duplicate it
    await redis_sessions.set(f"session:{session_id}:saved:{user_id}", "1", ex=7200)

    return {"detail": f"History saved for {user_id}"}

@app.post("/internal/collab/session-ended/{session_id}")
async def session_ended(session_id: str):
    raw = await redis_sessions.get(f"session:{session_id}:meta")
    if not raw:
        return {"detail": "Already cleaned up"}
    meta = json.loads(raw)
    final_code = await redis_sessions.get(f"session:{session_id}:finalCode") or ""

    # Save history for any user who hasn't already saved via end-session
    for uid_key in ["user1_id", "user2_id"]:
        uid = meta[uid_key]
        already_saved = await redis_sessions.get(f"session:{session_id}:saved:{uid}")
        if not already_saved:
            history_payload = {
                **meta,
                "sessionId": session_id,
                "finalCode": final_code,
                "endedAt": time.time(),
                "submittedBy": uid
            }
            await http_client.post("http://history-service:6770/history", json=history_payload)

    await redis_sessions.delete(
        f"session:{session_id}:meta",
        f"session:{session_id}:finalCode",
        f"session:{session_id}:ydoc",
        f"session:{session_id}:chat",
        f"session:{session_id}:saved:{meta['user1_id']}",
        f"session:{session_id}:saved:{meta['user2_id']}",
        f"active_session:{meta['user1_id']}",
        f"active_session:{meta['user2_id']}"
    )
    return {"detail": "Session ended and history saved"}

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
        
    target_base_url = SERVICES[service_prefix]
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

    return Response(
        content=target_response.content,
        status_code=target_response.status_code,
        headers=dict(target_response.headers)
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=1234, reload=True)