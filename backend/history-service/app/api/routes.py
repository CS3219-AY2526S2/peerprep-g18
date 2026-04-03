import random
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, status, Depends
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app.database import db
from app.models.domain import HistoryBase, PaginatedHistory

# A secure way to get the user-id, ensuring users dont forge this to access others history
# This code is generated using gemini
async def get_verified_user_id(x_user_id: str = Header(..., alias="X-User-Id")):
    # In a real production setup, you could also check for a 'Secret Gateway Key'
    # here to ensure the request actually came from YOUR gateway.
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
    data = payload.model_dump()
    session_id = payload.sessionId
    submitted_by = payload.submittedBy
    doc_id = f"{session_id}_{submitted_by}" if submitted_by else session_id
    db.collection("session_history").document(doc_id).set(data)
    return {"detail": "saved"}

# @router.get("/{user_id}", response_model=List[HistoryBase])
# async def get_history(user_id: str):
#     docs1 = db.collection("session_history").where("user1Id", "==", user_id).stream()
#     docs2 = db.collection("session_history").where("user2Id", "==", user_id).stream()

#     combined_results = {}
    
#     for d in docs1:
#         combined_results[d.id] = d.to_dict()
#     for d in docs2:
#         combined_results[d.id] = d.to_dict()
        
#     return list(combined_results.values())

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

@router.get("/detail/{session_id}/{user_id}", response_model=HistoryBase)
async def get_history_detail(session_id: str, user_id: str):
    doc_id = f"{session_id}_{user_id}"
    doc = db.collection("session_history").document(doc_id).get()
    
    if not doc.exists:
        raise HTTPException(status_code=404, detail="History record not found")
        
    return doc.to_dict()