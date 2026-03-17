from pydantic import BaseModel, Field
from typing import List

class FindPairRequest(BaseModel):
    topic_options: List[str] = Field(..., description="List of topics (e.g., ['Arrays', 'Strings'])", min_items=1)
    difficulty_options: List[str] = Field(..., description="List of difficulties (e.g., ['Easy', 'Medium'])", min_items=1)

class MatchResponse(BaseModel):
    message: str