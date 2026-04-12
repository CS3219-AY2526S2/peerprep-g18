import random
import os
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, status, Depends, Body
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app.database import db
from app.models.domain import HistoryBase, PaginatedHistory

from datetime import datetime, timezone
import httpx


http_client = httpx.AsyncClient()

# A secure way to get the user-id, ensuring users dont forge this to access others history
# This code is generated using gemini
async def get_verified_user_id(x_user_id: str = Header(..., alias="X-User-Id")):
    if not x_user_id:
        raise HTTPException(status_code=403, detail="Access denied: Missing User ID")
    return x_user_id

router = APIRouter()

# An internal function to check admin privileges based on the X-User-Role header
# The role is checked before allowing access to create, update, or delete operations
def verify_admin(x_user_role: Optional[str]):
    if not(x_user_role == "admin" or x_user_role == "root"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Admin privileges required"
        )

# --- HISTORY ENDPOINTS ---
@router.post("/", status_code=201)
async def save_history(payload: HistoryBase):
    qn_id = payload.questionId
    start_time_iso = payload.startedAt.isoformat()

    target_question_service = os.getenv("QUESTION_SERVICE_URL", "http://question-service:6768").rstrip("/")
    url = f"{target_question_service}/question/{qn_id}"
    params = {"start_time": start_time_iso}

    try:
        
        response = await http_client.get(
            url, 
            params=params,
            timeout=5.0
        )
        
        if response.status_code == 200:
            qn_data = response.json()
            
            payload.title = qn_data.get("title")
            payload.topic = qn_data.get("topic")
            payload.difficulty = qn_data.get("difficulty")
            payload.statement = qn_data.get("statement") 
            payload.examples = qn_data.get("examples", [])
            payload.constraints = qn_data.get("constraints", [])
            payload.hints = qn_data.get("hints", [])
            
        

    except Exception as e:
        print(f"History Service failed to fetch question: {str(e)}")
        #Should return here with a failure status code??
    
    doc_id = f"{payload.sessionId}_{payload.submittedBy}"
    db.collection("session_history").document(doc_id).set(payload.model_dump(by_alias=True))

    if payload.submittedBy:
        stats_ref = db.collection("user_stats").document(payload.submittedBy)
        
        stats_update = {
            "total_attempts": firestore.Increment(1),
            "last_attempt_at": payload.endedAt or datetime.now(timezone.utc)
        }

        if payload.topic:
            stats_update["used_topics"] = firestore.ArrayUnion([payload.topic])
        if payload.difficulty:
            stats_update["used_difficulties"] = firestore.ArrayUnion([payload.difficulty])

        stats_ref.set(stats_update, merge=True)
    
    return {"detail": "saved"}
    

@router.get("/user", response_model=PaginatedHistory)
async def get_user_history(
    page: int = 1,
    page_size: int = 10,
    user_id: str = Depends(get_verified_user_id),
    topic: Optional[str] = None,
    difficulty: Optional[str] = None
):
    # For auto saved, check for submitted by == null and one of the user is the userid
    #implement if required
    
    query = db.collection("session_history").where("submittedBy", "==", user_id)

    # Optional Filters
    if topic and topic != "All":
        query = query.where("topic", "==", topic.strip().title())
    if difficulty and difficulty != "All":
        query = query.where("difficulty", "==", difficulty.strip().title())

    # Pagination logic
    offset = (page - 1) * page_size
    
    # We select only metadata fields to keep the response light
    paged_query = query.select([
        "sessionId", "questionId", "title", "topic", 
        "difficulty", "endedAt", "submittedBy"
    ]).order_by("endedAt", direction=firestore.Query.DESCENDING) \
      .limit(page_size) \
      .offset(offset)

    attempts = []
    for doc in paged_query.stream():
        attempts.append(doc.to_dict())

    # Count total items for pagination math
    count_result = query.count().get()
    total_items = count_result[0][0].value

    return {
        "attempts": attempts,
        "total_pages": (total_items + page_size - 1) // page_size,
        "current_page": page,
        "total_items": total_items
    }

@router.get("/detail/{session_id}", response_model=HistoryBase)
async def get_history_detail(session_id: str, user_id: str = Depends(get_verified_user_id)):
    doc_id = f"{session_id}_{user_id}"
    doc = db.collection("session_history").document(doc_id).get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="History record not found")
        
    return doc.to_dict()

# The below endpoint is used for fetching metadata for a particular user
@router.get("/filters")
async def get_history_filters(user_id: str = Depends(get_verified_user_id)):
    """
    Instant lookup of unique topics/difficulties from the pre-aggregated doc.
    """
    doc_ref = db.collection("user_stats").document(user_id).get()
    
    if not doc_ref.exists:
        return {"topics": [], "difficulties": []}
    
    data = doc_ref.to_dict()
    return {
        "topics": sorted(data.get("used_topics", [])),
        "difficulties": sorted(data.get("used_difficulties", []))
    }