const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createClient } = require('redis');
const Y = require('yjs');
const axios = require('axios');

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
redisClient.connect().then(() => console.log('Connected to redis-sessions'));

// In-memory session state
const sessions = new Map();
// sessions.get(sessionId) = {
//   ydoc: Y.Doc,
//   connectedEditors: Set<string>,   // userIds
//   disconnectTimer: Timeout | null
// }

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
    userDisconnectTimers: new Map(),  // userId -> timeout (30s per-user disconnect)
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

  console.log(`[editor] ${userId} connected (${socket.id})`);

  const session = await getOrCreateSession(sessionId);

  // Clear any disconnect timers for this user (they reconnected in time)
  if (session.userDisconnectTimers.has(userId)) {
    clearTimeout(session.userDisconnectTimers.get(userId));
    session.userDisconnectTimers.delete(userId);
  }
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }

  session.connectedEditors.add(userId);
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

  socket.on('end-session', async () => {
    console.log(`[editor] ${userId} ended session ${sessionId}`);

    // Snapshot the code at the moment this user leaves
    const finalCode = session.ydoc.getText('code').toString();

    // Save this user's history
    try {
      await handleUserEnded(sessionId, userId, finalCode);
    } catch (err) {
      console.error(`[end-session] Failed to save history for ${userId}: ${err.message}`);
    }

    // Notify remaining users — they get a prompt to continue or leave
    socket.to(sessionId).emit('partner-ended', { userId });
  });

  socket.on('disconnect', () => {
    console.log(`[editor] ${userId} disconnected (${socket.id})`);
    session.connectedEditors.delete(userId);

    // Notify partner about temporary disconnect
    editorNs.to(sessionId).emit('user-left', {
      userId,
      message: 'Your partner has disconnected.'
    });

    // Start 30s timer for this user — if they don't reconnect, treat as end-session
    const userTimer = setTimeout(async () => {
      session.userDisconnectTimers.delete(userId);
      console.log(`[disconnect-timeout] ${userId} did not reconnect, treating as end-session`);

      // Snapshot and save this user's history
      const finalCode = session.ydoc.getText('code').toString();
      try {
        await handleUserEnded(sessionId, userId, finalCode);
      } catch (err) {
        console.error(`[disconnect-timeout] Failed to save history for ${userId}: ${err.message}`);
      }

      // Notify remaining users with the same prompt as end-session
      editorNs.to(sessionId).emit('partner-ended', { userId });

      // If no one is left, start full session cleanup
      if (session.connectedEditors.size === 0) {
        session.disconnectTimer = setTimeout(async () => {
          try {
            await handleSessionEnded(sessionId);
          } catch (err) {
            console.error(`[cleanup] Failed to clean up session: ${err.message}`);
          }
          sessions.delete(sessionId);
          console.log(`[cleanup] Session ${sessionId} cleaned up`);
        }, 5000);
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
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    await redisClient.rPush(
      `session:${sessionId}:chat`,
      JSON.stringify(message)
    );
    await redisClient.lTrim(`session:${sessionId}:chat`, -500, -1);

    chatNs.to(sessionId).emit('receive-message', message);
  });
});

// ==========================================
// SESSION LIFECYCLE HELPERS (previously in api-gateway)
// ==========================================

async function handleUserEnded(sessionId, userId, finalCode) {
  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) return;
  const meta = JSON.parse(raw);
  const payload = {
    ...meta,
    sessionId,
    finalCode,
    endedAt: Date.now() / 1000,
    submittedBy: userId
  };
  await axios.post('http://history-service:6770/history', payload);
  await redisClient.del(`active_session:${userId}`);
  await redisClient.set(`session:${sessionId}:saved:${userId}`, '1', { EX: 7200 });
}

async function handleSessionEnded(sessionId) {
  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) return; // already cleaned up
  const meta = JSON.parse(raw);
  const finalCode = (await redisClient.get(`session:${sessionId}:finalCode`)) || '';
  for (const key of ['user1_id', 'user2_id']) {
    const uid = meta[key];
    const saved = await redisClient.get(`session:${sessionId}:saved:${uid}`);
    if (!saved) {
      const payload = {
        ...meta,
        sessionId,
        finalCode,
        endedAt: Date.now() / 1000,
        submittedBy: uid
      };
      await axios.post('http://history-service:6770/history', payload);
    }
  }
  await redisClient.del(
    `session:${sessionId}:meta`,
    `session:${sessionId}:finalCode`,
    `session:${sessionId}:ydoc`,
    `session:${sessionId}:chat`,
    `session:${sessionId}:saved:${meta.user1_id}`,
    `session:${sessionId}:saved:${meta.user2_id}`,
    `active_session:${meta.user1_id}`,
    `active_session:${meta.user2_id}`
  );
}

// ==========================================
// COLLAB REST ENDPOINTS (previously in api-gateway)
// ==========================================

app.get('/collab/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ detail: 'Missing X-User-Id header' });

  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) return res.status(404).json({ detail: 'Session not found' });

  const meta = JSON.parse(raw);
  if (![meta.user1_id, meta.user2_id].includes(uid)) {
    return res.status(403).json({ detail: 'Not a member of this session' });
  }
  res.json({ ...meta, sessionId });
});

app.get('/collab/active-session', async (req, res) => {
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

app.post('/collab/join', async (req, res) => {
  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ detail: 'Missing X-User-Id header' });

  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ detail: 'sessionId required' });

  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) return res.status(404).json({ detail: 'Session not found' });

  const meta = JSON.parse(raw);
  if (![meta.user1_id, meta.user2_id].includes(uid)) {
    return res.status(403).json({ detail: 'Not a member of this session' });
  }

  const ticket = require('crypto').randomUUID();
  await redisClient.set(`ticket:${ticket}`, JSON.stringify({ uid, sessionId }), { EX: 60 });
  res.json({ ticket });
});

app.post('/collab/end-session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const uid = req.headers['x-user-id'];
  if (!uid) return res.status(401).json({ detail: 'Missing X-User-Id header' });

  const raw = await redisClient.get(`session:${sessionId}:meta`);
  if (!raw) return res.status(404).json({ detail: 'Session not found' });

  const meta = JSON.parse(raw);
  if (![meta.user1_id, meta.user2_id].includes(uid)) {
    return res.status(403).json({ detail: 'Not a member of this session' });
  }
  await redisClient.del(`active_session:${uid}`);
  res.json({ detail: 'Active session cleared' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Collaboration Service running on port ${PORT}`);
});
