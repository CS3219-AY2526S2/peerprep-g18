from pydantic import BaseModel, Field

class MatchRequest(BaseModel):
    topic: str = Field(..., description="Question topic (e.g., Arrays, Strings)")
    difficulty: str = Field(..., description="Difficulty level (Easy, Medium, Hard)")

class MatchResponse(BaseModel):
    message: str
    queue_name: str
    user_id: str