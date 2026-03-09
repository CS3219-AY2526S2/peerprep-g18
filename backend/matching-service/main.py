from fastapi import FastAPI
import redis.asyncio as redis

app = FastAPI(title="PeerPrep Matching Service")

# Global variable for the Redis connection pool
redis_client = None

@app.on_event("startup")
async def startup_event():
    global redis_client
    # Connect to the Redis container using the hostname 'redis' defined in docker-compose.yml
    redis_client = redis.Redis(host='redis', port=6379, decode_responses=True)
    print("Connected to Redis!")

@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()

@app.get("/health")
async def health_check():
    # Ping Redis to ensure the connection is alive
    try:
        ping = await redis_client.ping()
        return {"status": "healthy", "redis_connected": ping}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}