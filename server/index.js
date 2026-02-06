require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 4000;

app.use(cors({ origin: "http://localhost:3000" }));
app.use(express.json({ limit: "1mb" }));

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

if (!apiKey) {
  console.warn("Missing OPENAI_API_KEY. /api/summary will return 503.");
}

const client = apiKey ? new OpenAI({ apiKey }) : null;
const summaryCache = new Map();

const buildCacheKey = (title, content) => {
  const base = `${title || ""}\n${content || ""}`.trim();
  return base.slice(0, 2000);
};

app.post("/api/summary", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({ error: "Missing OpenAI API key" });
    }

    const { title, content } = req.body || {};
    if (!title && !content) {
      return res.status(400).json({ error: "Missing content" });
    }

    const text = `${title ? `Title: ${title}` : ""}\n\n${content || ""}`.trim();
    const trimmed = text.slice(0, 4000);
    const cacheKey = buildCacheKey(title, content);

    if (summaryCache.has(cacheKey)) {
      return res.json(summaryCache.get(cacheKey));
    }

    const response = await client.chat.completions.create({
      model,
      temperature: 0.4,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content:
            "You are a news summarizer. Return JSON with keys summary and keyPoints. " +
            "summary must be 2-3 original sentences in English that do not copy or closely paraphrase the source. " +
            "keyPoints must be an array of 3-5 short bullets."
        },
        {
          role: "user",
          content: `Summarize this news brief in original wording:\n\n${trimmed}`
        }
      ]
    });

    const raw = response?.choices?.[0]?.message?.content || "{}";
    let parsed = { summary: "", keyPoints: [] };
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parsed = { summary: raw, keyPoints: [] };
    }

    const payload = {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : []
    };

    summaryCache.set(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("Summary error:", err?.response?.data || err?.message || err);
    return res.status(500).json({
      error: "Failed to summarize",
      detail: err?.message || "Unknown error"
    });
  }
});

app.listen(port, () => {
  console.log(`News summary server running on http://localhost:${port}`);
});
