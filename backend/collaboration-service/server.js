const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const Y = require('yjs');
const axios = require('axios');

const MAX_GEMINI_PROMPT_LENGTH = 300;
const MAX_GEMINI_USAGE = 3;
const MATCHING_SESSION_DURATION = 7200; // 2 hours in seconds
const REDUCE_USAGE_ON_FAIL = true;      // Allow retry if AI service fails

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Redis client for ticket validation + session persistence
const redisClient = createClient({
  socket: { host: process.env.REDIS_SESSIONS_HOST || 'redis-sessions', port: 6379 }
});
redisClient.on('error', (err) => console.error('Redis error:', err));

// Redis clients dedicated to Socket.IO adapter (pub/sub)
const pubClient = createClient({
  socket: { host: process.env.REDIS_PUBSUB_HOST || 'redis-pubsub', port: 6379 }
});
const subClient = pubClient.duplicate();
pubClient.on('error', (err) => console.error('Redis pubsub pub error:', err));
subClient.on('error', (err) => console.error('Redis pubsub sub error:', err));

// In-memory session state
const sessions = new Map();

// Ticket validation middleware
async function ticketMiddleware(socket, next) {
  const ticket = socket.handshake.query.ticket;
  if (!ticket) return next(new Error('No ticket provided'));

  try {
    const val = await redisClient.getDel(`ticket:${ticket}`);
    if (!val) return next(new Error('Invalid or expired ticket'));

    const data = JSON.parse(val);
    socket.userId = data.uid;
    socket.sessionId = data.sessionId;
    next();
  } catch (err) {
    console.error('Ticket validation error:', err);
    next(new Error('Ticket validation failed'));
  }
}

// Namespaces
const editorNs = io.of('/editor');
const chatNs = io.of('/chat');
editorNs.use(ticketMiddleware);
chatNs.use(ticketMiddleware);

// Helper: get or create session with Yjs doc
async function getOrCreateSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  const ydoc = new Y.Doc();

  // Load persisted Yjs updates from Redis
  const updates = await redisClient.lRange(
    `session:${sessionId}:ydoc`, 0, -1
  );
  for (const update of updates) {
    Y.applyUpdate(ydoc, Buffer.from(update, 'base64'));
  }

  const session = {
    ydoc,
    connectedEditors: new Set(),
    endedUsers: new Set(),            // users who explicitly ended via end-session
    userDisconnectTimers: new Map(),  // userId -> timeout (30s per-user disconnect)
    activeSocketIds: new Map(),       // userId -> latest socket.id
    disconnectTimer: null
  };
  sessions.set(sessionId, session);
  return session;
}

// ==========================================
// /editor namespace
// ==========================================
editorNs.on('connection', async (socket) => {
  const { userId, sessionId } = socket;
  if (!userId || !sessionId) return socket.disconnect(true);

  const [ended, userEnded] = await Promise.all([
    redisClient.get(`session:${sessionId}:ended`),
    redisClient.get(`session:${sessionId}:user_ended:${userId}`)
  ]);
  if (ended || userEnded) {
    console.log(`[connect] Rejecting ${userId} — ${userEnded ? 'user already left' : 'session already ended'} (session=${sessionId})`);
    socket.emit('session-ended', { message: 'This session has already ended.' });
    return socket.disconnect(true);
  }

  const session = await getOrCreateSession(sessionId);

  // Check before setting — if an entry exists, this user was here before
  const isReconnect = session.activeSocketIds.has(userId);

  // Register this as the latest socket for the user (in-memory for same-instance, Redis for cross-instance)
  session.activeSocketIds.set(userId, socket.id);
  await redisClient.set(`session:${sessionId}:activesocket:${userId}`, socket.id);

  // Clear any disconnect timers for this user (they reconnected in time)
  if (session.userDisconnectTimers.has(userId)) {
    clearTimeout(session.userDisconnectTimers.get(userId));
    session.userDisconnectTimers.delete(userId);
    console.log(`[cancelTimer] Cleared user disconnect timer for ${userId} (reconnected, session=${sessionId})`);
  }
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
    console.log(`[cancelTimer] Cleared session cleanup timer (reconnect by ${userId}, session=${sessionId})`);
  }

  session.connectedEditors.add(userId);
  await redisClient.sAdd(`session:${sessionId}:connectedEditors`, userId);
  console.log(`[connect] ${userId} ${isReconnect ? 'reconnected' : 'connected'} (socket=${socket.id}, session=${sessionId}, editors=${[...session.connectedEditors]})`);
  socket.join(sessionId);

  // Send full document state to this client
  const state = Y.encodeStateAsUpdate(session.ydoc);
  socket.emit('yjs-sync', Buffer.from(state));

  // Notify existing users about the new joiner
  socket.to(sessionId).emit('user-joined', { userId });

  // Notify the new joiner about users already in the session
  for (const existingUserId of session.connectedEditors) {
    if (existingUserId !== userId) {
      socket.emit('user-joined', { userId: existingUserId });
    }
  }

  // Handle Yjs updates from this client
  socket.on('yjs-update', async (data) => {
    const update = new Uint8Array(data);
    Y.applyUpdate(session.ydoc, update);

    // Persist binary update as base64
    await redisClient.rPush(
      `session:${sessionId}:ydoc`,
      Buffer.from(update).toString('base64')
    );

    // Persist plaintext snapshot for history service
    await redisClient.set(
      `session:${sessionId}:finalCode`,
      session.ydoc.getText('code').toString()
    );

    // Broadcast to partner
    socket.to(sessionId).emit('yjs-update', data);
  });

  socket.on('end-session', async (ack) => {
    console.log(`[end-session] ${userId} explicitly ended session (socket=${socket.id}, session=${sessionId}, editors=${[...session.connectedEditors]})`);

    // Mark this user as explicitly ended so the disconnect timer won't double-save
    session.endedUsers.add(userId);

    // Snapshot the code at the moment this user leaves
    const finalCode = session.ydoc.getText('code').toString();

    // Save this user's history
    try {
      await handleUserEnded(sessionId, userId, finalCode);
    } catch (err) {
      console.error(`[end-session] Failed to save history for ${userId}: ${err.message}`);
    }

    // Permanently block this user from rejoining via /collab/join
    await redisClient.set(`session:${sessionId}:user_ended:${userId}`, '1', { EX: 7200 });

    // Notify remaining users — they get a prompt to continue or leave
    socket.to(sessionId).emit('partner-ended', { userId });

    // Acknowledge so the client knows it's safe to disconnect
    if (typeof ack === 'function') ack();
  });

  socket.on('disconnect', async () => {
    session.connectedEditors.delete(userId);
    await redisClient.sRem(`session:${sessionId}:connectedEditors`, userId);

    // If the user already explicitly ended, skip the disconnect timer entirely —
    // history is already saved and partner was already notified.
    if (session.endedUsers.has(userId)) {
      console.log(`[disconnect] ${userId} socket closed after explicit end-session, skipping timer (socket=${socket.id}, session=${sessionId})`);

      // Use Redis sCard — connectedEditors across ALL instances, not just this one
      const remainingCount = await redisClient.sCard(`session:${sessionId}:connectedEditors`);
      if (remainingCount === 0) {
        if (session.disconnectTimer) {
          clearTimeout(session.disconnectTimer);
        }
        console.log(`[setTimer] Started 5s session cleanup timer (session=${sessionId})`);
        session.disconnectTimer = setTimeout(async () => {
          console.log(`[cleanup] Session cleanup timer fired, cleaning up (session=${sessionId})`);
          try {
            await handleSessionEnded(sessionId);
          } catch (err) {
            console.error(`[cleanup] Failed to clean up session ${sessionId}: ${err.message}`);
          }
          sessions.delete(sessionId);
          console.log(`[cleanup] Session ${sessionId} removed from memory`);
        }, 5000);
      }
      return;
    }

    // Both users are now gone — end the session immediately for everyone
    if (session.connectedEditors.size === 0) {
      for (const [, timer] of session.userDisconnectTimers) {
        clearTimeout(timer);
      }
      session.userDisconnectTimers.clear();

      const finalCode = session.ydoc.getText('code').toString();
      const usersToEnd = [...session.activeSocketIds.keys()].filter(
        uid => !session.endedUsers.has(uid)
      );
      console.log(`[disconnect] Both users gone, ending session immediately for [${usersToEnd}] (session=${sessionId})`);
      // Mark session as ended immediately so /collab/join rejects new entries
      redisClient.set(`session:${sessionId}:ended`, '1', { EX: 300 })
        .catch(err => console.error(`[disconnect] Failed to set ended flag: ${err.message}`));
      Promise.all(usersToEnd.map(uid => handleUserEnded(sessionId, uid, finalCode)))
        .catch(err => console.error(`[disconnect] Failed to save history: ${err.message}`));

      if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
      session.disconnectTimer = setTimeout(async () => {
        console.log(`[cleanup] Session cleanup timer fired, cleaning up (session=${sessionId})`);
        try {
          await handleSessionEnded(sessionId);
        } catch (err) {
          console.error(`[cleanup] Failed to clean up session ${sessionId}: ${err.message}`);
        }
        sessions.delete(sessionId);
        console.log(`[cleanup] Session ${sessionId} removed from memory`);
      }, 5000);
      return;
    }

    console.log(`[disconnect] ${userId} socket closed (socket=${socket.id}, session=${sessionId}, editorsLeft=${[...session.connectedEditors]})`);

    // Notify partner about unexpected disconnect
    editorNs.to(sessionId).emit('user-left', {
      userId,
      message: 'Your partner has disconnected.'
    });

    // Capture which socket triggered this disconnect
    const disconnectingSocketId = socket.id;

    // Snapshot code at disconnect time — not after 30s when partner may have kept editing
    const finalCode = session.ydoc.getText('code').toString();

    // Start 30s timer for this user — if they don't reconnect, treat as end-session
    console.log(`[setTimer] Started 30s disconnect timer for ${userId} (disconnectSocket=${disconnectingSocketId}, session=${sessionId})`);

    const userTimer = setTimeout(async () => {
      session.userDisconnectTimers.delete(userId);
      // Read from Redis so cross-instance reconnects are visible (Instance 2 overwrites this key on reconnect)
      const currentSocketId = await redisClient.get(`session:${sessionId}:activesocket:${userId}`);

      // If the user reconnected (on any instance), their active socket ID will differ from the one that disconnected
      if (currentSocketId !== disconnectingSocketId) {
        console.log(`[timerFired] ${userId} reconnected via new socket (old=${disconnectingSocketId}, new=${currentSocketId}), skipping (session=${sessionId})`);
        return;
      }

      // Check if the REST end-session endpoint already ran (frontend race: disconnect fires
      // before the server processes the end-session socket event)
      const activeSessionVal = await redisClient.get(`active_session:${userId}`);
      const restEndedEarly = activeSessionVal === null || activeSessionVal !== sessionId;
      try {
        await handleUserEnded(sessionId, userId, finalCode);
      } catch (err) {
        console.error(`[timerFired] Failed to save history for ${userId}: ${err.message}`);
      }

      if (restEndedEarly) {
        console.log(`[timerFired] ${userId} ended via REST before socket event arrived, history saved (session=${sessionId})`);
      } else {
        console.log(`[timerFired] ${userId} did not reconnect after 30s, treating as end-session (session=${sessionId})`);
        editorNs.to(sessionId).emit('partner-ended', { userId });
      }

      // Permanently block this user from rejoining via /collab/join
      await redisClient.set(`session:${sessionId}:user_ended:${userId}`, '1', { EX: 7200 });

      // Check if session needs cleanup
      if (session.connectedEditors.size === 0) {
      // Use Redis sCard — connectedEditors across ALL instances, not just this one
      const remainingCount = await redisClient.sCard(`session:${sessionId}:connectedEditors`);
        if (remainingCount === 0) {
          if (session.disconnectTimer) {
            clearTimeout(session.disconnectTimer);
            console.log(`[cancelTimer] Cleared previous session cleanup timer before setting new one (session=${sessionId})`);
          }
          console.log(`[setTimer] Started 5s session cleanup timer (session=${sessionId})`);
          session.disconnectTimer = setTimeout(async () => {
            console.log(`[cleanup] Session cleanup timer fired, cleaning up (session=${sessionId})`);
            try {
              await handleSessionEnded(sessionId);
            } catch (err) {
              console.error(`[cleanup] Failed to clean up session ${sessionId}: ${err.message}`);
            }
            sessions.delete(sessionId);
            console.log(`[cleanup] Session ${sessionId} removed from memory`);
          }, 5000);
        }
      }
    }, 30000);

    session.userDisconnectTimers.set(userId, userTimer);
  });
});

// ==========================================
// /chat namespace
// ==========================================
chatNs.on('connection', async (socket) => {
  const { userId, sessionId } = socket;
  if (!userId || !sessionId) return socket.disconnect(true);

  console.log(`[chat] ${userId} connected (${socket.id})`);
  socket.join(sessionId);

  // Load last 50 messages
  const rawMessages = await redisClient.lRange(
    `session:${sessionId}:chat`, -50, -1
  );
  const messages = rawMessages.map((m) => JSON.parse(m));
  socket.emit('chat-history', messages);

  socket.on('send-message', async ({ text }) => {
    const sanitizedText = text.replace(/[<>]/g, '');
    const message = {
      sender: userId,
      text: sanitizedText,
      time: new Date().toISOString()
    };

    await redisClient.rPush(
      `session:${sessionId}:chat`,
      JSON.stringify(message)
    );
    await redisClient.lTrim(`session:${sessionId}:chat`, -500, -1);

    chatNs.to(sessionId).emit('receive-message', message);

    // --- GEMINI INTEGRATION (Non-blocking Background Task) ---
    if (sanitizedText.trim().toLowerCase().startsWith('@gemini')) {
      const geminiPrompt = sanitizedText.trim().substring(7).trim();
      if (!geminiPrompt) return;

      // 1. Check Prompt Length
      if (geminiPrompt.length > MAX_GEMINI_PROMPT_LENGTH) {
        const errorMsg = {
          sender: 'Gemini',
          text: `Prompt too long. Max ${MAX_GEMINI_PROMPT_LENGTH} characters allowed for Gemini.`,
          time: new Date().toISOString()
        };
        await redisClient.rPush(`session:${sessionId}:chat`, JSON.stringify(errorMsg));
        chatNs.to(sessionId).emit('receive-message', errorMsg);
        return;
      }

      // 2. Check Usage Limit (Immediate feedback)
      const usageKey = `session:${sessionId}:gemini_usage`;
      redisClient.incr(usageKey).then(async (currentUsage) => {
        if (currentUsage === 1) await redisClient.expire(usageKey, MATCHING_SESSION_DURATION);

        if (currentUsage > MAX_GEMINI_USAGE) {
          const limitMsg = {
            sender: 'Gemini',
            text: `Sorry, this session has reached the limit of ${MAX_GEMINI_USAGE} Gemini requests.`,
            time: new Date().toISOString()
          };
          await redisClient.rPush(`session:${sessionId}:chat`, JSON.stringify(limitMsg));
          chatNs.to(sessionId).emit('receive-message', limitMsg);
          return;
        }

        // 3. Trigger Background Processing
        processGeminiCommand(sessionId, geminiPrompt, usageKey);
      }).catch(err => console.error('[Gemini] Usage check error:', err));
    }
  });
});

/**
 * Background task to gather context and call the AI service.
 */
async function processGeminiCommand(sessionId, prompt, usageKey) {
  try {
    // 1. Gather Context
    const session = sessions.get(sessionId);
    const currentCode = session ? session.ydoc.getText('code').toString() : '';
    
    let questionStatement = 'Not found';
    const metaRaw = await redisClient.get(`session:${sessionId}:meta`);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      try {
        const targetQuestionService = (process.env.QUESTION_SERVICE_URL || 'http://question-service:6768').replace(/\/$/, '');
        const qRes = await axios.get(`${targetQuestionService}/question/${meta.questionId}`);
        questionStatement = qRes.data.statement;
      } catch (qErr) {
        console.error('[Gemini] Failed to fetch question statement:', qErr.message);
      }
    }

    const contextString = `
[SYSTEM INSTRUCTION]
Act as a helpful and concise (imagine you are responding a direct message) technical interview peer. 
Help the user with their question while considering the code they've written and the problem statement. 
Keep the response professional and encouraging. Avoid giving the direct solution, but feel free to provide hints, suggestions, or ask guiding questions.
Try to keep your response within 3-4 sentences to avoid overwhelming the user if possible.
If the user prompts you with questions outside of the context, feel free to reply that it is outside of your domain.

[PROBLEM STATEMENT]
${questionStatement}

[CURRENT COLLABORATIVE CODE]
\`\`\`python
${currentCode}
\`\`\`

[USER PROMPT]
`.trim();

    // 2. Call AI Service
    try {
      const targetAiService = (process.env.AI_SERVICE_URL || 'http://ai-service:6771').replace(/\/$/, '');
      const aiRes = await axios.post(`${targetAiService}/generate`, {
        prompt: prompt,
        context: contextString
      }, { timeout: 15000 });

      const aiMessage = {
        sender: 'Gemini',
        text: aiRes.data.response,
        time: new Date().toISOString()
      };

      await redisClient.rPush(`session:${sessionId}:chat`, JSON.stringify(aiMessage));
      chatNs.to(sessionId).emit('receive-message', aiMessage);
    } catch (aiErr) {
      console.error('[Gemini] AI Service call failed:', aiErr.message);
      const errorMsg = {
        sender: 'Gemini',
        text: 'Gemini is currently having trouble responding. Please try again later.',
        time: new Date().toISOString()
      };
      await redisClient.rPush(`session:${sessionId}:chat`, JSON.stringify(errorMsg));
      chatNs.to(sessionId).emit('receive-message', errorMsg);
      
      if (REDUCE_USAGE_ON_FAIL) {
        await redisClient.decr(usageKey);
      }
    }
  } catch (err) {
    console.error('[Gemini] Background task error:', err);
  }
}

// ==========================================
// SESSION LIFECYCLE HELPERS (previously in api-gateway)
// ==========================================

/**
 * Utility: fetch question template and compare with finalCode.
 * Returns true if the code is DIFFERENT from the template (should save),
 * or if there's an error fetching the template (default to save).
 */
async function hasMeaningfulCode(questionId, finalCode) {
  try {
    const targetQuestionService = (process.env.QUESTION_SERVICE_URL || 'http://question-service:6768').replace(/\/$/, '');
    const qRes = await axios.get(`${targetQuestionService}/question/${questionId}`);
    const template = qRes.data.template || '';
    
    // Normalize both for a fairer comparison (trim)
    const normalizedFinal = finalCode.trim();
    const normalizedTemplate = template.trim();
    
    return normalizedFinal !== normalizedTemplate;
  } catch (err) {
    console.error(`[history] Failed to fetch template for ${questionId}: ${err.message}`);
    // If the service is down or question is missing, we save history as a precaution.
    return true;
  }
}

async function handleUserEnded(sessionId, userId, finalCode) {
  // Idempotent: skip if history was already saved for this user+session
  const alreadySaved = await redisClient.get(`session:${sessionId}:saved:${userId}`);
  if (alreadySaved) {
    console.log(`[history] Skipping duplicate save for ${userId} (session=${sessionId}, already saved)`);
    return;
  }

  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) {
    console.log(`[history] Skipping save for ${userId} (session=${sessionId}, meta not found — already cleaned up)`);
    return;
  }
  const meta = JSON.parse(raw);

  // NEW: Check if code is unchanged from template
  const meaningful = await hasMeaningfulCode(meta.questionId, finalCode);
  if (!meaningful) {
    console.log(`[history] Skipping save for ${userId} (session=${sessionId}, code matches template)`);
    // Still clear active session and mark as saved to avoid cleanup loops
    await redisClient.set(`session:${sessionId}:saved:${userId}`, '1', { EX: MATCHING_SESSION_DURATION });
    const currentActiveSession = await redisClient.get(`active_session:${userId}`);
    if (currentActiveSession === sessionId) {
      await redisClient.del(`active_session:${userId}`);
    }
    return;
  }

  const payload = {
    ...meta,
    sessionId,
    finalCode,
    endedAt: Date.now() / 1000,
    submittedBy: userId
  };
  console.log(`[history] Saving history for ${userId} (session=${sessionId}, question=${meta.questionId})`);
  const targetHistoryService = (process.env.HISTORY_SERVICE_URL || 'http://history-service:6770').replace(/\/$/, '');
  await axios.post(`${targetHistoryService}/history`, payload);
  console.log(`[history] History saved successfully for ${userId} (session=${sessionId})`);

  // Only clear the active session pointer if it still refers to this session —
  // the user may have already joined a new session by the time this runs.
  const currentActiveSession = await redisClient.get(`active_session:${userId}`);
  if (currentActiveSession === sessionId) {
    await redisClient.del(`active_session:${userId}`);
    console.log(`[history] Cleared active_session for ${userId} (session=${sessionId})`);
  } else {
    console.log(`[history] active_session for ${userId} already cleared (session=${sessionId})`);
  }
  await redisClient.set(`session:${sessionId}:saved:${userId}`, '1', { EX: MATCHING_SESSION_DURATION });
}

async function handleSessionEnded(sessionId) {
  console.log(`[session-cleanup] Starting full cleanup (session=${sessionId})`);
  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) {
    console.log(`[session-cleanup] Meta not found, already cleaned up (session=${sessionId})`);
    return;
  }
  const meta = JSON.parse(raw);
  const finalCode = (await redisClient.get(`session:${sessionId}:finalCode`)) || '';

  // NEW: Check if code is unchanged from template
  const meaningful = await hasMeaningfulCode(meta.questionId, finalCode);

  for (const key of ['user1_id', 'user2_id']) {
    const uid = meta[key];
    const saved = await redisClient.get(`session:${sessionId}:saved:${uid}`);
    if (!saved) {
      if (!meaningful) {
        console.log(`[session-cleanup] Skipping catch-up save for ${uid} (session=${sessionId}, code matches template)`);
        continue;
      }
      console.log(`[session-cleanup] Catch-up save for ${uid} who never explicitly ended (session=${sessionId})`);
      const payload = {
        ...meta,
        sessionId,
        finalCode,
        endedAt: Date.now() / 1000,
        submittedBy: uid
      };
      const targetHistoryService = (process.env.HISTORY_SERVICE_URL || 'http://history-service:6770').replace(/\/$/, '');
      await axios.post(`${targetHistoryService}/history`, payload);
      console.log(`[session-cleanup] Catch-up history saved for ${uid} (session=${sessionId})`);
    } else {
      console.log(`[session-cleanup] ${uid} already saved, skipping (session=${sessionId})`);
    }
  }

  // Clean up session-scoped keys
  await redisClient.del(
    `session:${sessionId}:meta`,
    `session:${sessionId}:finalCode`,
    `session:${sessionId}:ydoc`,
    `session:${sessionId}:chat`,
    `session:${sessionId}:connectedEditors`,
    `session:${sessionId}:saved:${meta.user1_id}`,
    `session:${sessionId}:saved:${meta.user2_id}`,
    `session:${sessionId}:activesocket:${meta.user1_id}`,
    `session:${sessionId}:activesocket:${meta.user2_id}`
  );
  console.log(`[session-cleanup] Redis session keys deleted (session=${sessionId})`);

  // Only clear active_session pointers if they still refer to this session —
  // either user may have already joined a new session by now.
  for (const uid of [meta.user1_id, meta.user2_id]) {
    const current = await redisClient.get(`active_session:${uid}`);
    if (current === sessionId) {
      await redisClient.del(`active_session:${uid}`);
      console.log(`[session-cleanup] Cleared active_session for ${uid} (session=${sessionId})`);
    } else {
      console.log(`[session-cleanup] active_session for ${uid} already cleared (session=${sessionId})`);
    }
  }
}

// ==========================================
// COLLAB REST ENDPOINTS (previously in api-gateway)
// ==========================================

app.get('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ detail: 'Missing X-User-Id header' });

  const [raw, ended, userEnded] = await Promise.all([
    redisClient.get(`session:${sessionId}:meta`),
    redisClient.get(`session:${sessionId}:ended`),
    redisClient.get(`session:${sessionId}:user_ended:${uid}`)
  ]);
  if (!raw) return res.status(404).json({ detail: 'Session not found' });
  if (ended || userEnded) return res.status(410).json({ detail: 'Session has already ended' });

  const meta = JSON.parse(raw);
  if (![meta.user1_id, meta.user2_id].includes(uid)) {
    return res.status(403).json({ detail: 'Not a member of this session' });
  }
  res.json({ ...meta, sessionId });
});

app.get('/active-session', async (req, res) => {
  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ detail: 'Missing X-User-Id header' });

  const sessionId = await redisClient.get(`active_session:${uid}`);
  if (!sessionId) return res.json({ sessionId: null });

  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) {
    await redisClient.del(`active_session:${uid}`);
    return res.json({ sessionId: null });
  }
  res.json({ sessionId });
});

app.post('/join', async (req, res) => {
  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ detail: 'Missing X-User-Id header' });

  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ detail: 'sessionId required' });

  const [raw, ended, userEnded] = await Promise.all([
    redisClient.get(`session:${sessionId}:meta`),
    redisClient.get(`session:${sessionId}:ended`),
    redisClient.get(`session:${sessionId}:user_ended:${uid}`)
  ]);
  if (!raw) return res.status(404).json({ detail: 'Session not found' });
  if (ended) return res.status(410).json({ detail: 'Session has already ended' });
  if (userEnded) return res.status(410).json({ detail: 'You have already left this session' });

  const meta = JSON.parse(raw);
  if (![meta.user1_id, meta.user2_id].includes(uid)) {
    return res.status(403).json({ detail: 'Not a member of this session' });
  }

  const ticket = require('crypto').randomUUID();
  await redisClient.set(`ticket:${ticket}`, JSON.stringify({ uid, sessionId }), { EX: 60 });
  res.json({ ticket });
});

app.post('/end-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ detail: 'Missing X-User-Id header' });

  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) return res.status(404).json({ detail: 'Session not found' });

  const meta = JSON.parse(raw);
  if (![meta.user1_id, meta.user2_id].includes(uid)) {
    return res.status(403).json({ detail: 'Not a member of this session' });
  }
  const currentActive = await redisClient.get(`active_session:${uid}`);
  if (currentActive === sessionId) {
    await redisClient.del(`active_session:${uid}`);
  }
  res.json({ detail: 'Active session cleared' });
});

if (require.main === module) {
  Promise.all([
    redisClient.connect().then(() => console.log('Connected to redis-sessions')),
    pubClient.connect(),
    subClient.connect(),
  ]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
    console.log('Socket.IO Redis adapter attached');

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      console.log(`Collaboration Service running on port ${PORT}`);
    });

    process.on('SIGTERM', () => {
      console.log('SIGTERM received, closing connections...');
      io.close(() => {
        console.log('All Socket.IO connections closed');
        process.exit(0);
      });
    });
  });
}

module.exports = { app, server, io, redisClient, pubClient, subClient };
