import express from 'express';
import cors from 'cors';
import renderRouter from './routes/render.js';
import { renderService } from './services/render-service.js';

const app = express();

// Environment configuration
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// Parse CORS origins (comma-separated for multiple origins)
const corsOrigins = CORS_ORIGIN.split(',').map(o => o.trim());

console.log(`[Server] Environment: ${NODE_ENV}`);
console.log(`[Server] CORS origins: ${corsOrigins.join(', ')}`);

// Middleware
app.use(cors({
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check with detailed status
app.get('/health', (req, res) => {
  const bundleReady = renderService.isBundleReady();
  res.json({
    status: bundleReady ? 'ok' : 'initializing',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    bundleReady,
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api', renderRouter);

// Server instance for graceful shutdown
let server: ReturnType<typeof app.listen>;

// Start server
async function startServer() {
  try {
    // Pre-bundle Remotion project on startup
    console.log('[Server] Bundling Remotion project...');
    await renderService.bundleProject();
    console.log('[Server] Remotion project bundled successfully');

    // Listen on 0.0.0.0 for container/cloud deployment
    const HOST = process.env.HOST || '0.0.0.0';
    server = app.listen(Number(PORT), HOST, () => {
      console.log(`[Server] Running on http://${HOST}:${PORT}`);
      console.log(`[Server] SSE streaming enabled`);
      console.log(`[Server] Health check: http://${HOST}:${PORT}/health`);
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[Server] Shutting down gracefully...');
  server?.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('[Server] Shutting down gracefully...');
  server?.close(() => {
    console.log('[Server] Server closed');
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - just log for now
});

// Start the server
startServer();
