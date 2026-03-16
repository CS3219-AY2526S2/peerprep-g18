from fastapi import APIRouter, HTTPException, Header
from app.schemas import MatchRequest, MatchResponse
from app import database

router = APIRouter()

def generate_queue_name(topic: str, difficulty: str) -> str:
    return f"queue:{topic.lower().replace(' ', '_')}:{difficulty.lower()}"

@router.post("/match", response_model=MatchResponse)
async def join_queue(request: MatchRequest, x_user_id: str = Header(...)):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Missing X-User-Id header")
    
    active_status_key = f"active_user:{x_user_id}"
    is_already_active = await database.redis_match.exists(active_status_key)
    
    if is_already_active:
        raise HTTPException(status_code=400, detail="You are already in a match queue.")
    
    queue_name = generate_queue_name(request.topic, request.difficulty)

    try:
        await database.redis_match.setex(active_status_key, 60, queue_name)
        await database.redis_match.rpush(queue_name, x_user_id)
        await database.redis_match.expire(queue_name, 60) # Expire after 1 minute

        return {
            "message": "Successfully joined the match queue",
            "queue_name": queue_name,
            "user_id": x_user_id
        }
    
    except Exception as e:
        await database.redis_match.delete(active_status_key)
        raise HTTPException(status_code=500, detail=f"Redis Error: {str(e)}")

@router.delete("/match")
async def cancel_match(x_user_id: str = Header(...)):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Missing X-User-Id header")
        
    active_status_key = f"active_user:{x_user_id}"
    
    try:
        queue_name = await database.redis_match.get(active_status_key)
        if not queue_name:
            raise HTTPException(status_code=404, detail="No active match request found.")
            
        await database.redis_match.lrem(queue_name, 0, x_user_id)
        await database.redis_match.delete(active_status_key)
        
        return {"message": "Successfully cancelled match request"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Redis Error: {str(e)}")