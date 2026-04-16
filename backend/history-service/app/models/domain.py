from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Any, Optional, List
from datetime import datetime, timezone

class HistoryBase(BaseModel):
    sessionId: str
    user1Id: str = Field(..., alias="user1_id")
    user2Id: str = Field(..., alias="user2_id")
    questionId: int 
    
    submittedBy: Optional[str] = None
    
    title: Optional[str] = Field(None, min_length=3, max_length=150)
    topic: Optional[str] = None
    difficulty: Optional[str] = None 
    statement: Optional[str] = None
    examples: List[str] = []
    constraints: List[str] = []
    hints: List[str] = []

    # The user's actual work. NOT the initial template!
    codeSubmitted: Optional[str] = Field(None, alias="finalCode")

    startedAt: datetime #This one is required
    endedAt: Optional[datetime] = None

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    @field_validator('title', 'topic', 'difficulty', mode='after')
    @classmethod
    def format_to_title_case(cls, v: Optional[str]) -> Optional[str]:
        if v:
            return v.strip().title()
        return v

    @field_validator('startedAt', 'endedAt', mode='before')
    @classmethod
    def transform_unix(cls, v: Any):
        if isinstance(v, (int, float)):
            return datetime.fromtimestamp(v / 1000 if v > 1e12 else v, tz=timezone.utc)
        return v

    @field_validator('questionId', mode='before')
    @classmethod
    def ensure_int(cls, v: Any):
        try:
            return int(v)
        except (ValueError, TypeError):
            raise ValueError("questionId must be a valid number")

class HistoryMetadata(BaseModel):
    sessionId: str
    questionId: int
    title: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    endedAt: Optional[datetime] = None
    submittedBy: Optional[str] = None

    @field_validator('title', 'topic', 'difficulty', mode='after')
    @classmethod
    def format_to_title_case(cls, v: Optional[str]) -> Optional[str]:
        return v.strip().title() if v else v

class PaginatedHistory(BaseModel):
    attempts: List[HistoryMetadata]
    total_pages: int
    current_page: int
    total_items: int