# AI Assistance Disclosure:
# Tool: Gemini 3 Flash
# Scope: Assisted with the foundational boilerplate code and the core logic for the database connection.
# Author review: I adapted the repository structure and database integration patterns from the Question Service to maintain consistency. I  configured the schemas and validated that the connection logic functions correctly.

from fastapi import FastAPI
from app.api.routes import router as history_router

app = FastAPI(title="PeerPrep Question History Service", redirect_slashes=False)

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