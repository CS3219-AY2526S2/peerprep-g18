import os
import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

# Configure Gemini
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("WARNING: GEMINI_API_KEY is not set.")
else:
    genai.configure(api_key=api_key)

model = genai.GenerativeModel("gemini-3.1-flash-lite-preview")

class GenerationRequest(BaseModel):
    prompt: str
    context: Optional[str] = ""

@app.post("/generate")
async def generate_response(request: GenerationRequest):
    if not api_key:
        raise HTTPException(status_code=500, detail="Gemini API Key not configured on server.")

    try:
        # Generic construction for maximum portability
        full_input = f"{request.context}\n\n{request.prompt}" if request.context else request.prompt
        
        response = model.generate_content(full_input)
        return {"response": response.text}
    except Exception as e:
        print(f"Gemini API Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6771)
