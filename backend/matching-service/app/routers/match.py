import json
import itertools
import time
import redis.exceptions
from fastapi import APIRouter, HTTPException, Header
from app.schemas import FindPairRequest, MatchResponse
from app import database

router = APIRouter()

#def generate_queue_name(topic: str, difficulty: str) -> str:
#    return f"queue:{topic.lower().replace(' ', '_')}:{difficulty.lower()}"
@router.post("/find-pair", response_model=MatchResponse, status_code=202)
async def join_queue(request: FindPairRequest, x_user_id: str = Header(...)):

    uid = x_user_id
    try:
        if await database.redis_match.exists(f"active_user:{uid}"):
            raise HTTPException(status_code=400, detail="Already in queue")
        
        # Get every combination of (topic, difficulty)
        combinations = list(itertools.product(request.topic_options, request.difficulty_options))
        

        for topic, diff in combinations:
            bucket_key = f"pool:{topic}:{diff}"
            
            while True:
                # SPOP removes and returns a random value from the bucket
                popped_val = await database.redis_match.spop(bucket_key)
                
                # If bucket is empty, break and check the next combination
                if not popped_val:
                    break

                # popped_val is in the format "userid:timestamp"
                matched_uid, matched_timestamp = popped_val.split(":")
                
                # Get the matched user's current queue timestamp. This prevents matching with an older request made by the user
                current_active_timestamp = await database.redis_match.get(f"active_user:{matched_uid}")
                
                if current_active_timestamp == matched_timestamp:
                    
                    # Revoke active status for matched user so they can't be matched again
                    await database.redis_match.delete(f"active_user:{matched_uid}")
                    await database.redis_match.zrem("timeout_tracker", matched_uid)

                    # Broadcast to Event Bus
                    match_payload = json.dumps({
                        "event": "match",
                        "user1_id": uid,
                        "user2_id": matched_uid,
                        "topic": topic,
                        "difficulty": diff
                    })
                    await database.redis_pubsub.publish(f"match_events:{uid}", match_payload)
                    await database.redis_pubsub.publish(f"match_events:{matched_uid}", match_payload)
                    
                    print(f"Match! user {uid} & user {matched_uid} on topic:{topic} and difficulty:{diff}")
                    return {"message": "Match found"}
                
                # If the user was not active, they have already been matched in another bucket or timed out, can be removed from this bucket safely

        # If match is not found, add user to queue
        join_timestamp = str(time.time()) # Current timestamp, when user joins queue
        async with database.redis_match.pipeline() as pipe:
            # Mark user as actively waiting for 60 seconds
            pipe.setex(f"active_user:{uid}", 60, join_timestamp)
            
            # Track for the Timeout Sweeper worker
            expire_at = int(time.time()) + 60
            pipe.zadd("timeout_tracker", {uid: expire_at})
            
            # Add them to their matching buckets
            for topic, diff in combinations:
                bucket_key = f"pool:{topic}:{diff}"
                pipe.sadd(bucket_key, f"{uid}:{join_timestamp}") # Add uid with timestamp to bucket
                # The whole bucket dies in 65 seconds (user will either be matched, exited or timed out by then)
                pipe.expire(bucket_key, 65) 
                
            await pipe.execute()

        return {"message": "Added to waiting pools"}
    except HTTPException:
        raise
    except redis.exceptions.RedisError as e:
        print(f"Redis Error in find-pair: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error: Database unreachable.")
    except Exception as e:
        print(f"Unexpected Error in find-pair: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@router.delete("/cancel-pair")
async def cancel_match(x_user_id: str = Header(...)):
    uid = x_user_id

    try:
        if not await database.redis_match.exists(f"active_user:{uid}"):
            raise HTTPException(status_code=404, detail="Not in queue")

        # Remove the user's active status so they cannot be matched
        async with database.redis_match.pipeline() as pipe:
            pipe.delete(f"active_user:{uid}")
            pipe.zrem("timeout_tracker", uid)
            await pipe.execute()
            
        return {"message": "Successfully cancelled match request"}
    except HTTPException:
        raise
    except redis.exceptions.RedisError as e:
        print(f"Redis Error in cancel-pair: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error: Database unreachable.")
    except Exception as e:
        print(f"Unexpected Error in cancel-pair: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")