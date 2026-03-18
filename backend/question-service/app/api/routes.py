import random
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, status
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app.database import db
from app.models.domain import Question, QuestionCreate, QuestionUpdate

router = APIRouter()

# An internal function to check admin privileges based on the X-User-Role header
# The role is checked before allowing access to create, update, or delete operations
def verify_admin(x_user_role: Optional[str]):
    if not(x_user_role == "admin" or x_user_role == "root"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Admin privileges required"
        )


# Get a random question ID based on a given topic and difficulty level
@router.get("/", response_model=dict)
async def read_questions(
    topic: str, 
    difficulty: str
):
    topic = topic.strip().title()
    difficulty = difficulty.strip().title()
    
    questions_ref = db.collection("questions")
    query = questions_ref.where(
        filter=FieldFilter("topic", "==", topic)
    ).where(
        filter=FieldFilter("difficulty", "==", difficulty)
    )

    # fetch only the document IDs
    docs = query.select([]).stream()
    doc_ids = [doc.id for doc in docs]

    if not doc_ids:
        raise HTTPException(
            status_code=404, 
            detail=f"No questions found for {topic} with {difficulty} difficulty"
        )

    randomQuestion_id = random.choice(doc_ids)

    return {"question_id": randomQuestion_id}

    

# @router.get("/brew", status_code=418)
# async def brew():
#     return {"detail": "I'm a teapot! The requested entity body is short and stout. Tip me over and pour me out!"}

# Get specific question by ID
# This endpoint is expected to be used by question-history service to fetch question details for a given question_id.
@router.get("/{question_id}", response_model=Question)
async def read_question(question_id: str):
    questions_ref = db.collection("questions")

    # Fetch the question
    doc_ref = questions_ref.document(question_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(
            status_code=404, 
            detail=f"Question not found with ID: {question_id}"
        )

    question_data = doc.to_dict()
    
    # Add the document ID to the returned data for consistency with the Question model
    question_data["question_id"] = doc.id

    return question_data


# --- ADMIN ENDPOINTS ---

# To add a new question to the database.
@router.post("/", response_model=Question, status_code=status.HTTP_201_CREATED)
async def create_question(
    question: QuestionCreate, 
    x_user_role: Optional[str] = Header(None)
):
    if x_user_role:
        x_user_role = x_user_role.strip().lower()
    verify_admin(x_user_role)

    questions_ref = db.collection("questions")
    doc_ref = questions_ref.order_by("question_id", direction=firestore.Query.DESCENDING).limit(1)
    doc = doc_ref.get()
    question_id = int(doc[0].to_dict().get("question_id"))+1 if doc else 1

    question_dict = question.model_dump()
    question_dict["topic"] = question_dict["topic"].strip().title()
    question_dict["difficulty"] = question_dict["difficulty"].strip().title()

    

    new_question = {**question_dict, "question_id": str(question_id)}

    # Save to Firestore
    questions_ref.document(str(question_id)).set(new_question, merge=True)
    
    return new_question

# To update an existing question.
@router.put("/{question_id}", response_model=Question)
async def update_question(
    question_id: str, 
    question_update: QuestionUpdate, 
    x_user_role: Optional[str] = Header(None)
):
    if x_user_role:
        x_user_role = x_user_role.strip().lower()
    verify_admin(x_user_role)

    doc_ref = db.collection("questions").document(question_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"Question with ID {question_id} not found"
        )

    update_data = question_update.model_dump(exclude_unset=True)

    # Normalize topic and difficulty if they are being updated
    if "topic" in update_data:
        update_data["topic"] = update_data["topic"].strip().title()
    if "difficulty" in update_data:
        update_data["difficulty"] = update_data["difficulty"].strip().title()

    doc_ref.update(update_data)

    updated_doc = doc_ref.get().to_dict()
    updated_doc["question_id"] = doc_ref.id
    return updated_doc


# To delete a question from the database.
@router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_question(
    question_id: str, 
    x_user_role: Optional[str] = Header(None)
):
    if x_user_role:
        x_user_role = x_user_role.strip().lower()
    verify_admin(x_user_role)

    doc_ref = db.collection("questions").document(question_id)
    doc = doc_ref.get()

    if not doc.exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail=f"Question with ID {question_id} not found"
        )
    doc_ref.delete()

    return None

