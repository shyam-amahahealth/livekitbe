import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import {
  RoomServiceClient,
  AccessToken,
  EgressClient,
} from "livekit-server-sdk";

dotenv.config();

/* ──────────────────────────────
   Basic setup
────────────────────────────── */
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;
const LIVEKIT_HOST = process.env.LIVEKIT_HOST;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

console.log("🔧 LiveKit Config");
console.log("HOST:", LIVEKIT_HOST);
console.log("KEY:", LIVEKIT_API_KEY);
console.log("SECRET SET:", !!LIVEKIT_API_SECRET);

/* ──────────────────────────────
   LiveKit client
────────────────────────────── */
const roomService = new RoomServiceClient(
  LIVEKIT_HOST,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

const egressClient = new EgressClient(
  LIVEKIT_HOST,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/* ──────────────────────────────
   In-memory room host tracking
────────────────────────────── */
const roomHosts = {};

/* ──────────────────────────────
   Routes
────────────────────────────── */

// Health check
app.get("/", (req, res) => {
  console.log("➡️  GET /");
  res.send("LiveKit backend running");
});

/* ────────────────
   Create room
──────────────── */
app.post("/room", async (req, res) => {
  const { name } = req.body;
  console.log("➡️  POST /room", name);

  if (!name) return res.status(400).json({ error: "room name required" });

  try {
    const room = await roomService.createRoom({ name });
    console.log("✅ Room created:", room.name);
    res.json(room);
  } catch (err) {
    console.error("❌ createRoom failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ────────────────
   Token
──────────────── */
app.post("/token", async (req, res) => {
  const { room, identity } = req.body;
  console.log("➡️  POST /token", room, identity);

  if (!room || !identity) {
    return res.status(400).json({ error: "room and identity required" });
  }

  let role = "participant";

  if (!roomHosts[room]) {
    roomHosts[room] = identity;
    role = "host";
    console.log("👑 Host assigned:", identity);
  } else if (roomHosts[room] === identity) {
    role = "host";
  }

  try {
    const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
    });
    accessToken.addGrant({ roomJoin: true, room });
    accessToken.metadata = JSON.stringify({ role });
    const jwt = await accessToken.toJwt();
    console.log("🎟️ Token issued:", identity, role, jwt);
    res.json({ token: jwt, role });
  } catch (err) {
    console.error("❌ token error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ────────────────
   Start egress (CHUNKED RECORDING)
──────────────── */
app.post("/start-egress", async (req, res) => {
  const { room, filename } = req.body;

  console.log("➡️  POST /start-egress", room, filename);

  if (!room || !filename) {
    return res.status(400).json({
      error: "room and filename required",
    });
  }

  try {
    console.log("🎥 Starting room composite egress (video chunks, mp4)...");

    const info = await egressClient.startRoomCompositeEgress(
      room,
      {
        segments: {
          filenamePrefix: `/out/${filename}`,
          segmentDuration: 10, // 10 seconds per chunk
        },
      },
      {
        layout: "grid",
      }
    );
    console.log("✅ Egress started:", info.egressId);

    res.json({
      egressId: info.egressId,
      status: info.status,
    });
  } catch (err) {
    console.error("❌ start-egress failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to check if a room exists
app.post("/room-exists", async (req, res) => {
  const { room } = req.body;
  if (!room) return res.json({ exists: false });
  try {
    const rooms = await roomService.listRooms([room]);
    res.json({ exists: rooms.length > 0 });
  } catch (err) {
    console.error("room-exists error:", err);
    res.json({ exists: false });
  }
});

/* ────────────────
   Stop egress
──────────────── */
app.post("/stop-egress", async (req, res) => {
  const { egressId } = req.body;

  console.log("➡️  POST /stop-egress", egressId);

  if (!egressId) {
    return res.status(400).json({ error: "egressId required" });
  }

  try {
    const info = await egressClient.stopEgress(egressId);
    console.log("🛑 Egress stopped:", egressId);
    res.json(info);
  } catch (err) {
    console.error("❌ stop-egress failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ────────────────
   End room
──────────────── */
app.post("/end-room", async (req, res) => {
  const { room, identity } = req.body;
  console.log("➡️  POST /end-room", room, identity);

  if (!room) {
    return res.status(400).json({ error: "room required" });
  }

  try {
    await roomService.deleteRoom(room);

    if (roomHosts[room]) delete roomHosts[room];

    res.json({ status: "room-ended" });
  } catch (err) {
    console.error("❌ end-room failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────
   Start server
────────────────────────────── */
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
