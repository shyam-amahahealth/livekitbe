import dotenv from "dotenv";
import express from "express";
import { RoomServiceClient, AccessToken } from "livekit-server-sdk";

dotenv.config();

const app = express();
app.use(express.json());

// LiveKit config (must be defined before use)
const livekitHost = process.env.LIVEKIT_HOST;
const livekitApiKey = process.env.LIVEKIT_API_KEY;
const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
const PORT = process.env.PORT || 5001;

const roomService = new RoomServiceClient(
  livekitHost,
  livekitApiKey,
  livekitApiSecret
);

app.get("/", (req, res) => {
  res.send("LiveKit backend is running");
});

// Endpoint to create a room
app.post("/room", async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Room name is required" });
  }
  try {
    const room = await roomService.createRoom({ name });
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// In-memory map to track room hosts (for demo; use persistent store in production)
const roomHosts = {};

// Helper to wait for room deletion
async function waitForRoomDeletion(room, maxTries = 10, delayMs = 500) {
  for (let i = 0; i < maxTries; i++) {
    const rooms = await roomService.listRooms([room]);
    if (rooms.length === 0) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}
// Endpoint for host to end the room (disconnect all)
app.post("/end-room", async (req, res) => {
  const { room, identity } = req.body;
  if (!room || !identity) {
    return res.status(400).json({ error: "room and identity required" });
  }
  // Only host can end the room
  if (roomHosts[room] !== identity) {
    return res.status(403).json({ error: "Only host can end the room" });
  }
  try {
    // End the room via LiveKit API
    await roomService.deleteRoom(room);
    // Remove host info
    delete roomHosts[room];
    // Wait for room to be deleted in LiveKit
    await waitForRoomDeletion(room);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to generate a LiveKit token with role
app.post("/token", async (req, res) => {
  const { room, identity } = req.body;
  console.log("--- /token request received ---");
  console.log("Room:", room);
  console.log("Identity:", identity);
  if (!room || !identity) {
    console.log("Missing room or identity");
    return res.status(400).json({ error: "room and identity are required" });
  }
  let role = "participant";
  try {
    // Check if room exists and if host is set
    if (!roomHosts[room]) {
      // First user to request token for this room is host
      roomHosts[room] = identity;
      role = "host";
    } else if (roomHosts[room] === identity) {
      role = "host";
    }
    const at = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity,
    });
    at.addGrant({ roomJoin: true, room });
    // Add custom claim for role
    at.metadata = JSON.stringify({ role });
    const token = at.toJwt();
    console.log("Generated token for", identity, "role:", role);
    res.json({ token, role });
  } catch (err) {
    console.error("Token generation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to check if a room exists (for polling by clients)
app.post("/room-exists", async (req, res) => {
  const { room } = req.body;
  if (!room) return res.json({ exists: false });
  try {
    const rooms = await roomService.listRooms([room]);
    res.json({ exists: rooms.length > 0 });
  } catch (err) {
    res.json({ exists: false });
  }
});

app.listen(PORT, () => {
  console.log(`LiveKit backend listening on port ${PORT}`);
  console.log("LIVEKIT_HOST:", livekitHost);
  console.log("LIVEKIT_API_KEY:", livekitApiKey);
  // Do not log secret in production!
});
