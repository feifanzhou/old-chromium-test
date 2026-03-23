const express = require("express");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.static("public"));

app.get("/api/title", async (req, res) => {
  const requestedUrl = typeof req.query.url === "string" ? req.query.url : "";
  if (!requestedUrl) {
    res.status(400).json({ error: "Missing url query parameter" });
    return;
  }

  try {
    const response = await fetch(requestedUrl);
    if (!response.ok) {
      res.status(502).json({ error: `Upstream request failed with status ${response.status}` });
      return;
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    const title = titleMatch ? titleMatch[1].trim() : "Title not found";
    res.json({ title });
  } catch (error) {
    res.status(500).json({ error: `Failed to fetch page title: ${String(error)}` });
  }
});

app.get("/*splat", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
