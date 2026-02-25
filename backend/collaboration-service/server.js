const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Join isolated session room
  socket.on('join-session', ({ sessionId, username }) => {
    socket.join(sessionId);
    console.log(`${username} joined session ${sessionId}`);
  });

  // 2. Real-time code synchronization
  socket.on('code-change', ({ sessionId, code }) => {
    // Broadcast to the partner
    socket.to(sessionId).emit('code-update', code);
  });

  // 3. Real-time chat & basic sanitization
  socket.on('send-message', ({ sessionId, message }) => {
    const sanitizedText = message.text.replace(/[<>]/g, '');
    const safeMessage = {
      sender: message.sender,
      text: sanitizedText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    // Send to partner
    socket.to(sessionId).emit('receive-message', safeMessage);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Collaboration Service running on port ${PORT}`);
});