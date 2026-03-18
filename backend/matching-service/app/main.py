import os
import asyncio
from fastapi import FastAPI
import redis.asyncio as redis

from app import database
from app.worker import match_worker
from app.routers import match

app = FastAPI(title="PeerPrep Matching Service")

worker_task = None

app.include_router(match.router)

@app.on_event("startup")
async def startup_event():
    global worker_task
    
    # Initialize the Redis db
    match_host = os.getenv("REDIS_MATCH_HOST", "redis-matching")
    database.redis_match = redis.Redis(host=match_host, port=6379, decode_responses=True)

    event_bus_host = os.getenv("REDIS_EVENT_BUS_HOST", "redis-event-bus")
    database.redis_pubsub = redis.Redis(host=event_bus_host, port=6379, decode_responses=True)

    print("Connected to all Redis databases!")
    
    # Start the background worker
    worker_task = asyncio.create_task(match_worker())

@app.on_event("shutdown")
async def shutdown_event():
    global worker_task
    if worker_task:
        worker_task.cancel()
    if database.redis_match:
        await database.redis_match.close()
    if database.redis_pubsub:
        await database.redis_pubsub.close()

@app.get("/health")
async def health_check():
    try:
        ping_match = await database.redis_match.ping()
        ping_pubsub = await database.redis_pubsub.ping()
        return {"status": "healthy", "match_db": ping_match, "event_bus": ping_pubsub}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}