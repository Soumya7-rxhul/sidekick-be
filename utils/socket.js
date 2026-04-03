const { ChatMessage } = require('../models/index');
const jwt = require('jsonwebtoken');

const connectedUsers = new Map(); // userId -> socketId

const initSocket = (io) => {
  // Auth middleware for socket
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.userId}`);
    connectedUsers.set(socket.userId, socket.id);

    // Join a chat room
    socket.on('join_room', (roomId) => {
      socket.join(roomId);
      socket.currentRoom = roomId;
    });

    // Send message
    socket.on('send_message', async ({ roomId, content }) => {
      try {
        const msg = await ChatMessage.create({
          roomId,
          sender: socket.userId,
          content
        });
        await msg.populate('sender', 'name profilePhoto');

        io.to(roomId).emit('new_message', {
          _id: msg._id,
          roomId,
          content,
          sender: msg.sender,
          createdAt: msg.createdAt
        });
      } catch (err) {
        socket.emit('error', { message: 'Message failed' });
      }
    });

    // Typing indicator
    socket.on('typing', ({ roomId, isTyping }) => {
      socket.to(roomId).emit('user_typing', { userId: socket.userId, isTyping });
    });

    socket.on('disconnect', () => {
      connectedUsers.delete(socket.userId);
      console.log(`🔌 Disconnected: ${socket.userId}`);
    });
  });
};

module.exports = { initSocket };
