# AI Assistance Disclosure:
# Tool: Gemini 3.1 Pro 
# Scope: Integrated Matching Service alongside the plan for MatchToCollab.puml
# Author review: I validated correctness, tested the endpoints via smoke-tests, and ensured the business logic aligns with the project backlog. 

import os
import asyncio
from fastapi import FastAPI
import redis.asyncio as redis

from app import database
from app.worker import match_worker
from app.routers import match

app = FastAPI(title="PeerPrep Matching Service")

worker_task = None

app.include_router(match.router, prefix="/matching")

@app.on_event("startup")
async def startup_event():
    global worker_task
    
    # Initialize the Redis matching db
    match_host = os.getenv("REDIS_MATCH_HOST", "redis-matching")
    database.redis_match = redis.Redis(host=match_host, port=6379, decode_responses=True)

    print("Connected to Redis Matching database!")
    
    # Start the background worker
    worker_task = asyncio.create_task(match_worker())

@app.on_event("shutdown")
async def shutdown_event():
    global worker_task
    if worker_task:
        worker_task.cancel()
    if database.redis_match:
        await database.redis_match.close()

@app.get("/health")
async def health_check():
    try:
        ping_match = await database.redis_match.ping()
        return {"status": "healthy", "match_db": ping_match}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}