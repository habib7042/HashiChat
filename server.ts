import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Neon (PostgreSQL) Connection
const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Neon
  },
});

// Initialize Database Table
async function initDb() {
  if (!DATABASE_URL) {
    console.warn("DATABASE_URL not found. Database features will be disabled.");
    return;
  }
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT NOT NULL,
        sender TEXT NOT NULL,
        room TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        seen_at TIMESTAMP DEFAULT NULL
      );
    `);
    client.release();
    console.log("Connected to Neon (PostgreSQL) and initialized table.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

initDb();

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", socketConnected: io.engine.clientsCount });
  });

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join-room", async (room) => {
      socket.join(room);
      console.log(`User ${socket.id} joined room: ${room}`);

      if (!DATABASE_URL) return;

      // Fetch message history for the room
      try {
        const result = await pool.query(
          "SELECT * FROM messages WHERE room = $1 ORDER BY timestamp ASC LIMIT 50",
          [room]
        );
        socket.emit("message-history", result.rows);

        // Mark existing messages as seen if they haven't been yet
        await pool.query(
          "UPDATE messages SET seen_at = CURRENT_TIMESTAMP WHERE room = $1 AND seen_at IS NULL",
          [room]
        );
      } catch (err) {
        console.error("Error fetching history:", err);
      }
    });

    socket.on("send-message", async (data) => {
      if (!DATABASE_URL) {
        // Fallback if DB is not connected
        io.to(data.room).emit("receive-message", {
          id: Date.now(),
          text: data.text,
          sender: data.sender,
          room: data.room,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      try {
        // Determine if message is seen immediately (other users in room)
        const isSeen = io.sockets.adapter.rooms.get(data.room)?.size! > 1;
        const seenAt = isSeen ? new Date() : null;

        const result = await pool.query(
          "INSERT INTO messages (text, sender, room, seen_at) VALUES ($1, $2, $3, $4) RETURNING *",
          [data.text, data.sender, data.room, seenAt]
        );
        
        // Broadcast the saved message
        io.to(data.room).emit("receive-message", result.rows[0]);
      } catch (err) {
        console.error("Error saving message:", err);
      }
    });

    socket.on("typing", (data) => {
      socket.to(data.room).emit("user-typing", {
        username: data.username,
        isTyping: true
      });
    });

    socket.on("stop-typing", (data) => {
      socket.to(data.room).emit("user-typing", {
        username: data.username,
        isTyping: false
      });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Periodic cleanup: Remove messages seen more than 2 minutes ago
  setInterval(async () => {
    if (!DATABASE_URL) return;
    try {
      const result = await pool.query(
        "DELETE FROM messages WHERE seen_at IS NOT NULL AND seen_at <= (CURRENT_TIMESTAMP - INTERVAL '2 minutes')"
      );
      if (result.rowCount! > 0) {
        console.log(`Cleaned up ${result.rowCount} expired messages from Neon.`);
      }
    } catch (err) {
      console.error("Cleanup error:", err);
    }
  }, 30000); // Run every 30 seconds

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
