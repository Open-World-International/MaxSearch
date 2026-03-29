import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // AI Clients
  const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

  // API Routes
  app.post("/api/ai/chatgpt", async (req, res) => {
    const { message, apiKey } = req.body;
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) return res.status(400).json({ error: "OpenAI API key not provided" });
    
    try {
      const openai = new OpenAI({ apiKey: key });
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: message }],
      });
      res.json({ text: response.choices[0].message.content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/ai/claude", async (req, res) => {
    const { message, apiKey } = req.body;
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(400).json({ error: "Anthropic API key not provided" });

    try {
      const anthropic = new Anthropic({ apiKey: key });
      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 1024,
        messages: [{ role: "user", content: message }],
      });
      // @ts-ignore
      res.json({ text: response.content[0].text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Proxy for "browsing" to avoid CORS
  app.all("/api/proxy", async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).json({ error: "URL is required" });
    
    let targetUrl = url as string;
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = `https://${targetUrl}`;
    }

    try {
      const response = await axios({
        method: req.method as any,
        url: targetUrl,
        data: req.body,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': req.headers['accept'],
          'Accept-Language': req.headers['accept-language'],
          'Referer': new URL(targetUrl).origin,
        },
        responseType: 'arraybuffer',
        validateStatus: () => true, // Allow all status codes
        timeout: 15000
      });
      
      // Forward essential headers
      const headersToForward = ['content-type', 'cache-control', 'content-language', 'content-encoding'];
      headersToForward.forEach(header => {
        if (response.headers[header]) {
          res.setHeader(header, response.headers[header]);
        }
      });

      let data = response.data;
      const contentType = response.headers['content-type'] || '';

      if (contentType.includes('text/html')) {
        let html = Buffer.from(data).toString('utf-8');
        if (html.toLowerCase().includes('<head>')) {
          // Inject <base> tag and a script to help with relative links and dynamic requests
          const injection = `
            <head>
            <base href="${targetUrl}">
            <script>
              // Help resolve some dynamic requests by routing them back through our proxy
              const originalFetch = window.fetch;
              window.fetch = function() {
                let [resource, config] = arguments;
                if (typeof resource === 'string' && (resource.startsWith('/') || !resource.startsWith('http'))) {
                  const url = new URL(resource, "${targetUrl}");
                  resource = "/api/proxy?url=" + encodeURIComponent(url.href);
                }
                return originalFetch.call(this, resource, config);
              };

              const originalOpen = XMLHttpRequest.prototype.open;
              XMLHttpRequest.prototype.open = function(method, url) {
                if (typeof url === 'string' && (url.startsWith('/') || !url.startsWith('http'))) {
                  const absoluteUrl = new URL(url, "${targetUrl}");
                  url = "/api/proxy?url=" + encodeURIComponent(absoluteUrl.href);
                }
                return originalOpen.apply(this, arguments);
              };
            </script>
          `;
          html = html.replace(/<head>/i, injection);
        }
        res.send(html);
      } else {
        res.send(data);
      }
    } catch (error: any) {
      console.error('Proxy error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MaxSearch Server running on http://localhost:${PORT}`);
  });
}

startServer();
