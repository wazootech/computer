import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

const deepseek = createOpenAICompatible({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
  name: "deepseek",
});

export default defineAgent({
  model: deepseek("deepseek-v4-flash"),
});
