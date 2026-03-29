import asyncio
import json
import time
from app import database

async def match_worker():
    """Consumes messages from the queue, processes matches, and handles timeouts."""
    print("Matching Background Worker started...")
    while True:
        try:
            # Safety check: ensure Redis is connected before sweeping
            if not database.redis_match:
                await asyncio.sleep(1)
                continue
            
            # Check for any incoming messages
            result = await database.redis_match.brpop("incoming_match_queue", timeout=1)

            if result:
                _, message_data = result
                ticket = json.loads(message_data)
                
                uid = ticket["user_id"]
                ticket_id = ticket["ticket_id"]
                combinations = ticket["combinations"]
                join_timestamp = ticket["join_timestamp"]
                
                # Verify user hasn't cancelled while waiting in the incoming queue
                if not await database.redis_match.exists(f"active_user:{uid}"):
                    continue 
                
                match_found = False
                
                # Matching algorithm
                for topic, diff in combinations:
                    bucket_key = f"pool:{topic}:{diff}"
                    
                    while True:
                        popped_val = await database.redis_match.spop(bucket_key)
                        if not popped_val:
                            break

                        matched_uid, matched_timestamp, matched_ticket_id = popped_val.split(":")
                        current_active_timestamp = await database.redis_match.get(f"active_user:{matched_uid}")
                        
                        if current_active_timestamp == matched_timestamp:
                            # MATCH FOUND!
                            match_found = True
                            
                            # Clean up active statuses
                            await database.redis_match.delete(f"active_user:{matched_uid}")
                            await database.redis_match.delete(f"active_user:{uid}")
                            await database.redis_match.zrem("timeout_tracker", matched_uid)
                            await database.redis_match.zrem("timeout_tracker", uid)

                            # Create Success Payloads
                            payload_self = json.dumps({"status": "success", "peer_id": matched_uid, "topic": topic, "difficulty": diff})
                            payload_peer = json.dumps({"status": "success", "peer_id": uid, "topic": topic, "difficulty": diff})

                            # Write to Storage
                            await database.redis_match.setex(f"match_result:{ticket_id}", 300, payload_self)
                            await database.redis_match.setex(f"match_result:{matched_ticket_id}", 300, payload_peer)
                            
                            print(f"Match! user {uid} & user {matched_uid} on {topic}/{diff}")
                            break 
                    
                    if match_found:
                        break
                        
                # If no match found, place them in the buckets to wait for someone else
                if not match_found:
                    async with database.redis_match.pipeline() as pipe:
                        for topic, diff in combinations:
                            pipe.sadd(f"pool:{topic}:{diff}", f"{uid}:{join_timestamp}:{ticket_id}")
                            pipe.expire(f"pool:{topic}:{diff}", 65) 
                        await pipe.execute()

            # Remove timed out users from queue
            now = int(time.time())
            timed_out_users = await database.redis_match.zrangebyscore("timeout_tracker", 0, now)

            for timed_out_uid in timed_out_users:
                timed_out_ticket_id = await database.redis_match.get(f"user_ticket:{timed_out_uid}")
                
                async with database.redis_match.pipeline() as pipe:
                    pipe.delete(f"active_user:{timed_out_uid}")
                    pipe.zrem("timeout_tracker", timed_out_uid)
                    pipe.delete(f"user_ticket:{timed_out_uid}")
                    
                    if timed_out_ticket_id:
                        timeout_payload = json.dumps({"status": "timeout", "message": "No match found within 60 seconds."})
                        pipe.setex(f"match_result:{timed_out_ticket_id}", 300, timeout_payload)
                        
                    await pipe.execute()
                print(f"Timeout processed for {timed_out_uid}.")
            
            '''now = int(time.time())
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
                
                print(f"Sent timeout event for {uid}. User is no longer active in queue.")'''       
        except Exception as e:
            print(f"Worker error: {str(e)}")
        await asyncio.sleep(1) # Check every second