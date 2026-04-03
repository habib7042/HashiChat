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
let pool: pg.Pool | null = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

// Initialize Database Table
async function initDb() {
  if (!pool) {
    console.warn("DATABASE_URL not found. Database features will be disabled.");
    return;
  }
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        name TEXT PRIMARY KEY,
        pin TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        text TEXT,
        image_url TEXT,
        sender TEXT NOT NULL,
        room TEXT NOT NULL REFERENCES rooms(name) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        seen_at TIMESTAMP DEFAULT NULL
      );
      CREATE TABLE IF NOT EXISTS reactions (
        id SERIAL PRIMARY KEY,
        message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL,
        username TEXT NOT NULL,
        UNIQUE(message_id, emoji, username)
      );
    `);
    client.release();
    console.log("Connected to Neon (PostgreSQL) and initialized tables.");
  } catch (err) {
    console.error("Database initialization error:", err);
    pool = null; // Disable DB features if connection fails
  }
}

initDb();

// Track room owners (first person to join)
const roomOwners = new Map<string, string>();

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ["polling", "websocket"],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e7 // 10MB for images
  });

  const PORT = 3000;

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "ok", 
      socketConnected: io.engine.clientsCount,
      databaseConnected: !!pool 
    });
  });

  // Socket.io logic
  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Send active rooms on connection
    const emitActiveRooms = async () => {
      if (!pool) return;
      try {
        const result = await pool.query("SELECT name, pin IS NOT NULL as has_pin FROM rooms ORDER BY created_at DESC");
        socket.emit("active-rooms", result.rows);
      } catch (err) {
        console.error("Error fetching active rooms:", err);
      }
    };
    emitActiveRooms();

    socket.on("join-room", async (data: { room: string; pin?: string }) => {
      const { room, pin } = data;
      try {
        if (pool) {
          // Check if room exists and PIN matches
          const roomResult = await pool.query("SELECT * FROM rooms WHERE name = $1", [room]);
          if (roomResult.rowCount! > 0) {
            const dbRoom = roomResult.rows[0];
            if (dbRoom.pin && dbRoom.pin !== pin) {
              socket.emit("error", { message: "Incorrect PIN for this room." });
              return;
            }
          } else {
            // Create new room
            await pool.query("INSERT INTO rooms (name, pin) VALUES ($1, $2)", [room, pin || null]);
            io.emit("room-created", { name: room, has_pin: !!pin });
          }
        }

        socket.join(room);
        console.log(`User ${socket.id} joined room: ${room}`);

        // Assign room owner if it doesn't exist
        if (!roomOwners.has(room)) {
          roomOwners.set(room, socket.id);
          socket.emit("admin-status", true);
        } else {
          socket.emit("admin-status", false);
        }

        if (!pool) {
          socket.emit("message-history", []);
          return;
        }

        // Fetch message history with reactions
        const result = await pool.query(
          `SELECT m.*, 
            COALESCE(json_agg(json_build_object('emoji', r.emoji, 'username', r.username)) FILTER (WHERE r.id IS NOT NULL), '[]') as reactions
           FROM messages m
           LEFT JOIN reactions r ON m.id = r.message_id
           WHERE m.room = $1
           GROUP BY m.id
           ORDER BY m.timestamp ASC
           LIMIT 50`,
          [room]
        );
        socket.emit("message-history", result.rows);

        // Mark existing messages as seen if they haven't been yet
        await pool.query(
          "UPDATE messages SET seen_at = CURRENT_TIMESTAMP WHERE room = $1 AND seen_at IS NULL",
          [room]
        );
      } catch (err) {
        console.error("Error in join-room:", err);
        socket.emit("error", { message: "Failed to join room or fetch history" });
      }
    });

    socket.on("send-message", async (data) => {
      try {
        if (!pool) {
          // Fallback if DB is not connected
          io.to(data.room).emit("receive-message", {
            id: Date.now(),
            text: data.text,
            image_url: data.image_url,
            sender: data.sender,
            room: data.room,
            timestamp: new Date().toISOString(),
            reactions: []
          });
          return;
        }

        // Determine if message is seen immediately (other users in room)
        const isSeen = io.sockets.adapter.rooms.get(data.room)?.size! > 1;
        const seenAt = isSeen ? new Date() : null;

        const result = await pool.query(
          "INSERT INTO messages (text, image_url, sender, room, seen_at) VALUES ($1, $2, $3, $4, $5) RETURNING *, '[]'::json as reactions",
          [data.text || null, data.image_url || null, data.sender, data.room, seenAt]
        );
        
        // Broadcast the saved message
        io.to(data.room).emit("receive-message", result.rows[0]);
      } catch (err) {
        console.error("Error saving message:", err);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("add-reaction", async (data) => {
      try {
        if (!pool) {
          io.to(data.room).emit("receive-reaction", data);
          return;
        }

        // Insert reaction, ignore if already exists (unique constraint)
        await pool.query(
          "INSERT INTO reactions (message_id, emoji, username) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [data.messageId, data.emoji, data.username]
        );

        io.to(data.room).emit("receive-reaction", data);
      } catch (err) {
        console.error("Error adding reaction:", err);
      }
    });

    socket.on("remove-reaction", async (data) => {
      try {
        if (!pool) {
          io.to(data.room).emit("receive-remove-reaction", data);
          return;
        }

        await pool.query(
          "DELETE FROM reactions WHERE message_id = $1 AND emoji = $2 AND username = $3",
          [data.messageId, data.emoji, data.username]
        );

        io.to(data.room).emit("receive-remove-reaction", data);
      } catch (err) {
        console.error("Error removing reaction:", err);
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

    socket.on("clear-chat", async (data) => {
      try {
        // Verify admin status
        if (roomOwners.get(data.room) !== socket.id) {
          socket.emit("error", { message: "Only room administrators can clear chat history." });
          return;
        }

        if (pool) {
          await pool.query("DELETE FROM messages WHERE room = $1", [data.room]);
        }

        io.to(data.room).emit("chat-cleared");
        console.log(`Chat cleared for room: ${data.room}`);
      } catch (err) {
        console.error("Error clearing chat:", err);
        socket.emit("error", { message: "Failed to clear chat history." });
      }
    });

    socket.on("disconnecting", () => {
      // Handle room ownership transfer if owner leaves
      for (const room of socket.rooms) {
        if (roomOwners.get(room) === socket.id) {
          roomOwners.delete(room);
          // Find next available user in room
          const clients = io.sockets.adapter.rooms.get(room);
          if (clients && clients.size > 1) {
            const nextOwnerId = Array.from(clients).find(id => id !== socket.id);
            if (nextOwnerId) {
              roomOwners.set(room, nextOwnerId);
              io.to(nextOwnerId).emit("admin-status", true);
            }
          }
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Periodic cleanup: Remove messages seen more than 2 minutes ago
  setInterval(async () => {
    if (!pool) return;
    try {
      // Find IDs of messages to be deleted
      const toDelete = await pool.query(
        "SELECT id, room FROM messages WHERE seen_at IS NOT NULL AND seen_at <= (CURRENT_TIMESTAMP - INTERVAL '2 minutes')"
      );
      
      if (toDelete.rowCount! > 0) {
        const ids = toDelete.rows.map(r => r.id as number);
        const rooms = [...new Set(toDelete.rows.map(r => r.room as string))];

        await pool.query("DELETE FROM messages WHERE id = ANY($1)", [ids]);
        
        // Notify rooms about deleted messages
        rooms.forEach((room: string) => {
          io.to(room).emit("messages-deleted", ids);
        });

        console.log(`Cleaned up ${toDelete.rowCount} expired messages from Neon.`);
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
