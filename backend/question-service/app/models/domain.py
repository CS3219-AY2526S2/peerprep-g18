from pydantic import BaseModel, Field, field_validator
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

    @field_validator('question_id', mode='before')
    @classmethod
    def transform_id_to_string(cls, v):
        return str(v)

class QuestionMetadata(BaseModel):
    question_id: str
    title: str
    topic: str
    difficulty: str

    class Config:
        coerce_numbers_to_str = True

class PaginatedQuestions(BaseModel):
    questions: List[QuestionMetadata]
    total_pages: int
    current_page: int
    total_items: int