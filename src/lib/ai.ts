import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function askGemini(prompt: string, search: boolean = false) {
  const model = ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: search ? [{ googleSearch: {} }] : [],
    },
  });
  const response = await model;
  return response.text;
}

export async function askChatGPT(message: string, apiKey?: string) {
  const response = await fetch("/api/ai/chatgpt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, apiKey }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}

export async function askClaude(message: string, apiKey?: string) {
  const response = await fetch("/api/ai/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, apiKey }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}
