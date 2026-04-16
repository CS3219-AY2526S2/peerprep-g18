# AI Assistance Disclosure:
# Tool: Gemini 3 Flash
# Scope: Generated the boilerplate repository skeleton, the foundational logic for the Firestore database connection, and the implementation of the pagination logic for question retrieval.
# Author review: I integrated the generated boilerplate and pagination into the service architecture. I validated the Firestore connection and refined the pagination parameters to ensure they align with the overall project requirements.

from fastapi import FastAPI
from app.api.routes import router as question_router

app = FastAPI(title="PeerPrep Question Service", redirect_slashes=False)

# Standard health check
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Include routes with the /question prefix
app.include_router(question_router, prefix="/question", tags=["Questions"])

from mangum import Mangum
handler = Mangum(app, lifespan="off")