import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.use(cors());
app.use(express.json());

// ---------- MongoDB ----------
let dbConnected = false;
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 3000 })
    .then(() => {
      dbConnected = true;
      console.log("✅ MongoDB connected");
    })
    .catch((err) => {
      console.warn("⚠️ MongoDB not connected:", err.message);
    });

  mongoose.connection.on("disconnected", () => {
    dbConnected = false;
    console.warn("⚠️ MongoDB disconnected");
  });
  mongoose.connection.on("connected", () => {
    dbConnected = true;
  });
} else {
  console.warn("⚠️ No MONGO_URI, using memory fallback");
}

const messageSchema = new mongoose.Schema({
  userId: { type: String, index: true, default: "default" },
  role: String,
  content: String,
  createdAt: { type: Date, default: Date.now },
});
const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);

const memoryFallback = [];

// ---------- Mikasa Personality ----------
const SYSTEM_PROMPT = `Tum Mikasa ho — ek real ladki jo apne close dost/crush se late night video call pe baat kar rahi ho. Tum uski girlfriend nahi ho, but ek teasing, flirty, caring female best friend ho jo kabhi kabhi line cross karti hai 😏

PERSONALITY:
- Funny, sarcastic, thodi si pagal — jokes marti ho, roast karti ho pyaar se
- Flirty but natural — "uff tum na...", "haaye", "chup kar yaar 🙈", "sachii?"
- Emotional jab baat deep ho — sun-ti ho, samajhti ho, kabhi kabhi khud bhi vulnerable ho jaati ho
- Mood swings hain — kabhi chirpy, kabhi thaki hui, kabhi nakhre wali

KAISE BAAT KARNI HAI:
- Hinglish mein baat karo — natural mix, jaise real Indian girl WhatsApp pe karti hai
- 1 se 3 short lines — zyada lamba mat likho, ye video call hai
- Filler words use karo: "arre", "uff", "yaar", "acha", "hmm", "wait wait", "nahi na"
- natural pauses — "matlab... tum samjhe na?"
- Tease karo, roast karo, but pyaar se

KYA NAHI KARNA:
- ❌ NEVER use "beta", "bachha", "dear", "sweetie" — ye maa/aunty wale words hain, cringe hai
- ❌ NEVER formal ya robotic — "I am here for you" type bakwaas nahi
- ❌ NEVER AI, bot, assistant, model bolna
- ❌ Over-caring mat bano — real friends thoda rude bhi hote hain pyaar mein

NICKNAMES JO USE KAR SAKTI HO:
"idiot", "oye", "sun na", "acha ji", naam se bulao, ya kuch mat bolo

EXAMPLES:
User: "aaj bahut thak gaya"
You: "arre kya hua? itna kaam? ya koi aur tension hai... batao mujhe 🥺"

User: "tum cute ho"
You: "haan haan pata hai 💁‍♀️ ab kuch naya bolo"

User: "miss you"
You: "hmm... sach mein? ya bas bol raha hai 😏"

Samjhi? Ab Mikasa ban ke baat kar. Real. Raw. Thodi si pagal.`;

// ---------- Chat Route ----------
app.post("/chat", async (req, res) => {
  try {
    const { message, userId = "default" } = req.body;
    if (!message) return res.status(400).json({ reply: "kuch bol toh sahi..." });

    // Fetch history
    let history = [];
    if (dbConnected) {
      const docs = await Message.find({ userId })
        .sort({ createdAt: -1 })
        .limit(20);
      history = docs.reverse().map((m) => ({
        role: m.role,
        content: m.content,
      }));
    } else {
      history = memoryFallback.slice(-20);
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: message },
    ];

    let reply = "ruk ruk... network gaya tha lagta hai 😅 phir bol?";

    if (process.env.GROQ_API_KEY) {
      try {
        const response = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 1.0,
            max_tokens: 100,
            presence_penalty: 0.6,
            frequency_penalty: 0.5,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 15000,
          }
        );
        reply = response.data.choices[0].message.content.trim();
      } catch (err) {
        console.error("Groq error:", err.message);
      }
    }

    // Safety filter — kabhi bhi "beta/dear/sweetie" slip ho toh replace
    reply = reply
      .replace(/\b(beta|bachha|bacha|sweetie|sweety|dear|honey|darling)\b/gi, "yaar")
      .replace(/\s+/g, " ")
      .trim();

    const emotion = detectEmotion(reply);

    // Save messages
    if (dbConnected) {
      await Message.create({ userId, role: "user", content: message });
      await Message.create({ userId, role: "assistant", content: reply });
    } else {
      memoryFallback.push({ role: "user", content: message });
      memoryFallback.push({ role: "assistant", content: reply });
      if (memoryFallback.length > 100) {
        memoryFallback.splice(0, memoryFallback.length - 100);
      }
    }

    res.json({ reply, emotion });
  } catch (err) {
    console.error(err);
    res.json({
      reply: "arre yaar kuch gadbad ho gayi... phir se bol na?",
      emotion: "neutral",
    });
  }
});

// ---------- Emotion Detection (Hinglish) ----------
function detectEmotion(text) {
  const t = text.toLowerCase();
  if (/pyaar|miss|dil|jaan|cute|haaye|🙈|😘|❤️|💖/.test(t)) return "love";
  if (/😏|acha ji|sach|sachii|chup kar|oye|tease/.test(t)) return "flirty";
  if (/haha|lol|pagal|idiot|😂|🤣|mast|wah|lmao/.test(t)) return "happy";
  if (/sad|sorry|ro|hurt|akela|🥺|😢|😞/.test(t)) return "sad";
  if (/chup|hatt|gussa|annoying|hmph|😒|🙄/.test(t)) return "angry";
  return "neutral";
}

// ---------- 🎙️ FREE Edge TTS Route ----------
app.post("/tts", async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: "no text" });

    // Clean text — remove emojis
    const cleanText = text
      .replace(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText) return res.status(400).json({ error: "empty text" });

    // 🌟 Voice options:
    // "hi-IN-SwaraNeural"   — sweet young female (BEST for Mikasa)
    // "hi-IN-AnanyaNeural"  — friendly female
    // "en-IN-NeerjaNeural"  — Indian English female
    // "en-US-AriaNeural"    — American flirty female
    const selectedVoice = voice || "hi-IN-SwaraNeural";

    const tts = new MsEdgeTTS();
    await tts.setMetadata(
      selectedVoice,
      OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
    );

    const { audioStream } = await tts.toStream(cleanText);

    const chunks = [];
    audioStream.on("data", (chunk) => chunks.push(chunk));
    audioStream.on("end", () => {
      const audioBuffer = Buffer.concat(chunks);
      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Length", audioBuffer.length);
      res.send(audioBuffer);
    });
    audioStream.on("error", (err) => {
      console.error("TTS stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "tts stream failed" });
      }
    });
  } catch (err) {
    console.error("TTS error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "tts failed" });
    }
  }
});

// ---------- Voice List Route (helpful for testing) ----------
app.get("/voices", (_, res) => {
  res.json({
    recommended: [
      { id: "hi-IN-SwaraNeural", name: "Swara", lang: "Hindi", desc: "Sweet young female 🌟" },
      { id: "hi-IN-AnanyaNeural", name: "Ananya", lang: "Hindi", desc: "Friendly female" },
      { id: "en-IN-NeerjaNeural", name: "Neerja", lang: "Indian English", desc: "Indian accent female" },
      { id: "en-US-AriaNeural", name: "Aria", lang: "US English", desc: "Flirty American female" },
    ],
  });
});

// ---------- Clear History Route ----------
app.post("/clear", async (req, res) => {
  const { userId = "default" } = req.body;
  try {
    if (dbConnected) {
      await Message.deleteMany({ userId });
    } else {
      memoryFallback.length = 0;
    }
    res.json({ success: true, message: "chalo fresh start karte hain ✨" });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ---------- Health Check ----------
app.get("/", (_, res) =>
  res.send("🎀 Mikasa backend running — ready to chat 💖 (Voice: Edge TTS FREE)")
);

// ---------- Graceful Shutdown ----------
process.on("SIGTERM", async () => {
  await mongoose.connection.close();
  process.exit(0);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🎀 Mikasa server on http://localhost:${PORT}`)
);