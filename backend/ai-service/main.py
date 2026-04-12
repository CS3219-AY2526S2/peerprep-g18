import os
import json
import boto3
from google import genai
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

def load_secrets():
    """Load Backend Env secrets from AWS Secrets Manager."""
    if os.getenv("GEMINI_API_KEY"):
        return

    region_name = os.getenv("AWS_REGION", "ap-southeast-1")
    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    try:
        resp = client.get_secret_value(SecretId="peerprep/backend-env")
        env_vars = json.loads(resp['SecretString'])
        for key, value in env_vars.items():
            if not os.getenv(key):
                os.environ[key] = str(value)
        print("Backend environment variables loaded from Secrets Manager.")
    except Exception as e:
        print(f"Note: Could not load peerprep/backend-env from Secrets Manager: {e}")

load_secrets()

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
