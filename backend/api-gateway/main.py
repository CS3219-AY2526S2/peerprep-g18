# AI Assistance Disclosure:
# Tool: Gemini 3.1 Pro
# Scope: Generated API Gateway to centralize Firebase Auth, handle CORS, and reverse-proxy requests to underlying microservices.
# Author review: I validated the proxy logic, tested header injection, and configured the routing table.

import os
from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
import httpx
import firebase_admin
from firebase_admin import credentials, auth

cred = credentials.Certificate("firebase-service-account.json")
firebase_admin.initialize_app(cred)

app = FastAPI(title="PeerPrep API Gateway")

http_client = httpx.AsyncClient()

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up the httpx client when the application shuts down."""
    await http_client.aclose()

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
    # "matching": "http://matching-service:6769",
    "collab": "http://collab-service:4000",
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