from pydantic import BaseModel, Field
from typing import Optional, List

class QuestionBase(BaseModel):
    title: str = Field(..., min_length=3, max_length=150)
    topic: str
    difficulty: str 
    statement: str
    template: str
    examples: List[str] = []
    constraints: List[str] = []
    hints: List[str] = []

class QuestionCreate(QuestionBase):
    pass

class QuestionUpdate(BaseModel):
    # Everything is optional for the admin update logic
    title: Optional[str] = None
    topic: Optional[str] = None
    difficulty: Optional[str] = None
    statement: Optional[str] = None
    template: Optional[str] = None
    examples: Optional[List[str]] = None
    constraints: Optional[List[str]] = None
    hints: Optional[List[str]] = None

class Question(QuestionBase):
    question_id: str

    class Config:
        from_attributes = True