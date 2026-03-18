import asyncio
import json
import time
from app import database

async def match_worker():
    """Sweeper that handles 60-second timeouts."""
    print("Timeout Sweeper Worker started...")
    while True:
        try:
            # Safety check: ensure Redis is connected before sweeping
            if not database.redis_match or not database.redis_pubsub:
                await asyncio.sleep(1)
                continue

            now = int(time.time())
            # Users with timeout_tracket set 
            timed_out_users = await database.redis_match.zrangebyscore("timeout_tracker", 0, now)

            for uid in timed_out_users:
                # Remove active status and timeout tracker
                async with database.redis_match.pipeline() as pipe:
                    pipe.delete(f"active_user:{uid}")
                    pipe.zrem("timeout_tracker", uid)
                    await pipe.execute()

                timeout_payload = json.dumps({
                    "event": "timeout",
                    "user_id": uid
                })
                await database.redis_pubsub.publish(f"match_events:{uid}", timeout_payload) # Timeout event
                
                print(f"Sent timeout event for {uid}. User is no longer active in queue.")       
        except Exception as e:
            print(f"Worker error: {str(e)}")
        await asyncio.sleep(1) # Check every second