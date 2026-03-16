import asyncio
import json
from app import database

async def match_worker():
    """Background task that sweeps queues and publishes match data to the API Gateway."""
    print("Event-driven background worker started...")
    while True:
        try:
            # Safety check: ensure Redis is connected before sweeping
            if not database.redis_match or not database.redis_pubsub:
                await asyncio.sleep(1)
                continue

            cursor = 0
            while True:
                cursor, keys = await database.redis_match.scan(cursor=cursor, match="queue:*")
                for key in keys:
                    users = await database.redis_match.lrange(key, 0, -1)
                    for uid in users:
                        # If timeout
                        if not await database.redis_match.exists(f"active_user:{uid}"):
                            await database.redis_match.lrem(key, 0, uid)
                            # Timeout Event
                            timeout_payload = json.dumps({
                                "event": "timeout",
                                "user_id": uid
                            })
                            await database.redis_pubsub.publish(f"match_events:{uid}", timeout_payload)
                            print(f"Sent timeout event for {uid}")

                    while await database.redis_match.llen(key) >= 2:
                        user1 = await database.redis_match.lpop(key)
                        user2 = await database.redis_match.lpop(key)
                        
                        if user1 and user2:
                            _, topic, difficulty = key.split(":")
                            
                            # Cleanup active status so users can queue again in the future
                            await database.redis_match.delete(f"active_user:{user1}")
                            await database.redis_match.delete(f"active_user:{user2}")
                            
                            # Create payload 
                            match_payload = {
                                "user1": user1,
                                "user2": user2,
                                "topic": topic,
                                "difficulty": difficulty
                            }
                            json_data = json.dumps(match_payload)
                            
                            # Broadcast to Event Bus
                            await database.redis_pubsub.publish(f"match_events:{user1}", json_data)
                            await database.redis_pubsub.publish(f"match_events:{user2}", json_data)
                            
                            print(f"Match Broadcasted! {user1} & {user2} for {topic} ({difficulty})")
                if int(cursor) == 0:
                        break
                            
        except Exception as e:
            print(f"Worker error: {str(e)}")
        
        await asyncio.sleep(1)