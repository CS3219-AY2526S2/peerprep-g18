from pydantic import BaseModel, Field
from typing import List, Optional

class FindPairRequest(BaseModel):
    topic_options: List[str] = Field(..., description="List of topics (e.g., ['Arrays', 'Strings'])", min_items=1)
    difficulty_options: List[str] = Field(..., description="List of difficulties (e.g., ['Easy', 'Medium'])", min_items=1)

class MatchResponse(BaseModel):
    status: str
    ticket_id: str
    poll_url: str
    message: str

class MatchStatusResponse(BaseModel):
    status: str
    message: Optional[str] = None
    peer_id: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[str] = None