// ══════════════════════════════════════════════════════════
// MassApply AI Server
// Run with: npx nodemon server.js
// ══════════════════════════════════════════════════════════

const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { AIService } = require("./engine/ai-service");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3000;

// ─── Port conflict handler ───
httpServer.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const usedPort = err.port || PORT;
    console.error(`\n⚠️  Port ${usedPort} is already in use.`);
    console.error(`   Trying port ${usedPort + 1} instead...\n`);
    setTimeout(() => {
      httpServer.close();
      httpServer.listen(usedPort + 1, printBanner);
    }, 500);
  } else {
    console.error("❌ Server error:", err.message);
    process.exit(1);
  }
});

// ─── Graceful shutdown ───
function shutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  httpServer.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "MassApply AI Server is running" });
});

// ─── AI Batch Answering Endpoint ───
app.post("/api/answer", async (req, res) => {
  const { questions, jobContext, userProfile, apiKeys, pageUrl } = req.body;

  if (!questions || questions.length === 0) {
    return res
      .status(400)
      .json({ error: "No questions provided", answers: [] });
  }

  if (!apiKeys || apiKeys.trim() === "") {
    return res.status(400).json({
      error:
        "No API key configured. Please add your Gemini API key in Settings.",
      answers: questions.map((q) => ({
        label: q.label,
        answer: "",
        error: "No API key",
      })),
    });
  }

  try {
    console.log(`\n🤖 Processing ${questions.length} question(s) for AI...`);
    console.log(
      `📋 Job: ${jobContext?.title || "Unknown"} at ${jobContext?.company || "Unknown"}`,
    );
    console.log(`🌐 Website: ${pageUrl || "Unknown"}`);

    const aiService = new AIService(apiKeys);
    aiService.initialize();

    const answers = await aiService.answerQuestions(
      questions,
      jobContext,
      userProfile,
      pageUrl,
    );

    console.log(
      `✅ AI answered ${answers.filter((a) => a.answer).length}/${questions.length} questions`,
    );

    res.json({ success: true, answers });
  } catch (error) {
    console.error("❌ AI batch error:", error.message);
    res.status(500).json({
      error: error.message,
      answers: questions.map((q) => ({
        label: q.label,
        answer: "",
        error: error.message,
      })),
    });
  }
});

// ─── Socket.IO for real-time chat (optional feature) ───
io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  const chatHistory = [];

  socket.on("send_message", async (data) => {
    const msg = typeof data === "string" ? data : data.message;
    const apiKeys = typeof data === "string" ? "" : data.apiKeys || "";

    console.log("📩 Chat message:", msg.substring(0, 100));
    chatHistory.push({ role: "user", content: msg });

    if (!apiKeys) {
      socket.emit(
        "bot_reply",
        "❌ Error: No API key configured. Set it in Settings.",
      );
      return;
    }

    try {
      const aiService = new AIService(apiKeys);
      aiService.initialize();

      const prompt =
        chatHistory
          .map(
            (h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`,
          )
          .join("\n") + "\nAssistant:";

      const { client } = aiService._getNextHealthyClient();
      const model = client.getGenerativeModel({ model: "gemini-1.5-flash" });
      const chat = model.startChat({ generationConfig: { temperature: 0.1 } });
      const result = await chat.sendMessage([{ text: prompt }]);
      const reply = result.response.text();

      chatHistory.push({ role: "bot", content: reply });
      socket.emit("bot_reply", reply);
      console.log("🤖 Reply sent:", reply.substring(0, 80) + "...");
    } catch (e) {
      console.error("❌ Chat error:", e.message);
      socket.emit("bot_reply", "❌ Error: " + e.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// ─── Start server ───
function printBanner() {
  const activePort = httpServer.address()?.port || PORT;
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║        ✅  SERVER IS ACTIVE & RUNNING            ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  🚀 MassApply AI Server Started                  ║`);
  console.log(`║  📡 HTTP  : http://localhost:${activePort}             ║`);
  console.log(`║  ⚡ Socket: ws://localhost:${activePort}               ║`);
  console.log(`║  🔑 PID   : ${process.pid}                              ║`);
  console.log("╚══════════════════════════════════════════════════╝\n");
}

httpServer.listen(PORT, printBanner);

module.exports = app;
