from fastapi import FastAPI
from app.api.routes import router as question_router

app = FastAPI(title="PeerPrep Question Service")

# Standard health check
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Include routes with the /question prefix
app.include_router(question_router, prefix="/question", tags=["Questions"])