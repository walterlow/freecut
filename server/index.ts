import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import renderRouter from './routes/render.js';
import { renderService } from './services/render-service.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: {
    origin: 'http://localhost:5173', // Vite dev server
    methods: ['GET', 'POST', 'DELETE'],
  },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api', renderRouter);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('[Server] Client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('[Server] Client disconnected:', socket.id);
  });
});

// Set Socket.IO instance for render service
renderService.setSocketIO(io);

// Start server
async function startServer() {
  try {
    // Pre-bundle Remotion project on startup
    console.log('[Server] Bundling Remotion project...');
    await renderService.bundleProject();
    console.log('[Server] Remotion project bundled successfully');

    // Start listening
    httpServer.listen(PORT, () => {
      console.log(`[Server] Running on http://localhost:${PORT}`);
      console.log(`[Server] WebSocket ready on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Server] Shutting down gracefully...');
  httpServer.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[Server] Shutting down gracefully...');
  httpServer.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

// Start the server
startServer();
