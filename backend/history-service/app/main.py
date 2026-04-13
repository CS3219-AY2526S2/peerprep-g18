from fastapi import FastAPI
from app.api.routes import router as history_router

app = FastAPI(title="PeerPrep Question History Service")

# Standard health check
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Include routes with the /history prefix
app.include_router(history_router, prefix="/history", tags=["History"])

from mangum import Mangum
# lifespan="off": prevents Mangum from triggering startup/shutdown events on each Lambda
# invocation, which would otherwise add latency on every warm-start request.
handler = Mangum(app, lifespan="off")