import os
from google import genai
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

# Configure Gemini
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("WARNING: GEMINI_API_KEY is not set.")
    client = None
else:
    client = genai.Client(api_key=api_key)

# Model name for 2026 context
model_name = "gemini-3.1-flash-lite-preview"

class GenerationRequest(BaseModel):
    prompt: str
    context: Optional[str] = ""

@app.post("/generate")
async def generate_response(request: GenerationRequest):
    if not api_key or client is None:
        raise HTTPException(status_code=500, detail="Gemini API Key not configured on server.")

    try:
        # Generic construction for maximum portability
        full_input = f"{request.context}\n\n{request.prompt}" if request.context else request.prompt
        
        response = client.models.generate_content(
            model=model_name,
            contents=full_input
        )
        return {"response": response.text}
    except Exception as e:
        print(f"Gemini API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

from mangum import Mangum
handler = Mangum(app, lifespan="off")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6771)
