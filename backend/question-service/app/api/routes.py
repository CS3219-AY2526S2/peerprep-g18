import random
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, status
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app.database import db
from app.models.domain import PaginatedQuestions, Question, QuestionCreate, QuestionUpdate

router = APIRouter()

# An internal function to check admin privileges based on the X-User-Role header
# The role is checked before allowing access to create, update, or delete operations
def verify_admin(x_user_role: Optional[str]):
    if not(x_user_role == "admin" or x_user_role == "root"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Admin privileges required"
        )

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

    counter_ref = db.collection("metadata").document("question_counter")
    questions_ref = db.collection("questions")

    # transaction logic - prevents race condition
    @firestore.transactional
    def get_next_id_and_increment(transaction):
        snapshot = counter_ref.get(transaction=transaction)    
        # If the counter doc doesn't exist, start at 1 - Not a likely case
        if not snapshot.exists:
            new_id = 1
        else:
            new_id = snapshot.get("current_id") + 1  
        # Update the counter in the database
        transaction.update(counter_ref, {"current_id": new_id})
        return new_id

    # Execute the transaction to get the unique ID
    transaction = db.transaction()
    question_id = get_next_id_and_increment(transaction)

    question_dict = question.model_dump()
    question_dict["topic"] = question_dict["topic"].strip().title()
    question_dict["difficulty"] = question_dict["difficulty"].strip().title()

    

    new_question = {**question_dict, "question_id": question_id}

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

# Endpoint to fetch all unique topics for filtering options in the frontend
@router.get("/topics", response_model=list[str])
def get_topics():
    docs = db.collection("questions").select(["topic"]).stream()
    unique_topics = set()
    for doc in docs:
        topic = doc.to_dict().get("topic")
        if topic:
            unique_topics.add(topic)
            
    return sorted(list(unique_topics))

# Endpoint to fetch all unique difficulties for filtering options in the frontend
@router.get("/difficulties", response_model=list[str])
def get_difficulties():
    docs = db.collection("questions").select(["difficulty"]).stream()
    unique_diffs = set()
    for doc in docs:
        diff = doc.to_dict().get("difficulty")
        if diff:
            unique_diffs.add(diff)            
    # Custom sort order
    order = {"Easy": 0, "Medium": 1, "Hard": 2}
    return sorted(list(unique_diffs), key=lambda x: order.get(x, 99))

@router.get("/all", response_model=PaginatedQuestions)
async def get_all_questions(
    page: int = 1,
    page_size: int = 10,
    qid: Optional[str] = None,
    topic: Optional[str] = None,
    difficulty: Optional[str] = None
):
    query = db.collection("questions")

    if qid:
        doc = query.document(str(qid)).get()
        if doc.exists:
            q_data = doc.to_dict()
            # Filter the keys to match your metadata select
            filtered_data = {
                "question_id": str(q_data.get("question_id", qid)),
                "title": q_data.get("title", ""),
                "topic": q_data.get("topic", ""),
                "difficulty": q_data.get("difficulty", "")
            }
            return {
                "questions": [filtered_data],
                "total_pages": 1,
                "current_page": 1,
                "total_items": 1
            }
        else:
            # This is just a way of saying such a question doesnt exits
            return {"questions": [], "total_pages": 0, "current_page": 1, "total_items": 0}
    
    if topic and topic != "All":
        topic = topic.strip().title()
        query = query.where(filter=FieldFilter("topic", "==", topic))
    if difficulty and difficulty != "All":
        difficulty = difficulty.strip().title()
        query = query.where(filter=FieldFilter("difficulty", "==", difficulty))

    offset = (page - 1) * page_size
    
    paged_query = query.select(["question_id", "title", "topic", "difficulty"]) \
                       .order_by("question_id") \
                       .limit(page_size) \
                       .offset(offset)

    questions = []
    for doc in paged_query.stream():
        data = doc.to_dict()
        data["question_id"] = str(data.get("question_id", ""))
        questions.append(data)

    count_query = query.count()
    count_result = count_query.get()
    total_items = count_result[0][0].value

    return {
        "questions": questions,
        "total_pages": (total_items + page_size - 1) // page_size,
        "current_page": page,
        "total_items": total_items
    }


# --- USER ENDPOINTS ---

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
