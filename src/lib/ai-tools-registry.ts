export interface KnownAITool {
  toolName: string;
  vendor: string;
  domains: string[];
  clientNamePatterns: string[];
}

export const KNOWN_AI_TOOLS: KnownAITool[] = [
  {
    toolName: "ChatGPT",
    vendor: "OpenAI",
    domains: ["chat.openai.com", "platform.openai.com", "openai.com"],
    clientNamePatterns: ["openai", "chatgpt"],
  },
  {
    toolName: "Claude",
    vendor: "Anthropic",
    domains: ["claude.ai", "console.anthropic.com", "anthropic.com"],
    clientNamePatterns: ["anthropic", "claude.ai"],
  },
  {
    toolName: "Gemini",
    vendor: "Google",
    domains: ["gemini.google.com", "aistudio.google.com"],
    clientNamePatterns: ["gemini", "google ai studio"],
  },
  {
    toolName: "GitHub Copilot",
    vendor: "GitHub / Microsoft",
    domains: ["copilot.github.com", "github.com/features/copilot"],
    clientNamePatterns: ["copilot", "github copilot"],
  },
  {
    toolName: "Midjourney",
    vendor: "Midjourney Inc",
    domains: ["midjourney.com", "www.midjourney.com"],
    clientNamePatterns: ["midjourney"],
  },
  {
    toolName: "Perplexity",
    vendor: "Perplexity AI",
    domains: ["perplexity.ai", "www.perplexity.ai"],
    clientNamePatterns: ["perplexity"],
  },
  {
    toolName: "Cursor",
    vendor: "Anysphere",
    domains: ["cursor.com", "www.cursor.com"],
    clientNamePatterns: ["cursor"],
  },
  {
    toolName: "Jasper AI",
    vendor: "Jasper",
    domains: ["jasper.ai", "www.jasper.ai"],
    clientNamePatterns: ["jasper"],
  },
  {
    toolName: "Notion AI",
    vendor: "Notion",
    domains: ["notion.so", "www.notion.so"],
    clientNamePatterns: ["notion"],
  },
  {
    toolName: "Grammarly AI",
    vendor: "Grammarly",
    domains: ["grammarly.com", "app.grammarly.com"],
    clientNamePatterns: ["grammarly"],
  },
  {
    toolName: "Copy.ai",
    vendor: "Copy.ai",
    domains: ["copy.ai", "www.copy.ai"],
    clientNamePatterns: ["copy.ai"],
  },
  {
    toolName: "Runway",
    vendor: "Runway",
    domains: ["runwayml.com", "app.runwayml.com"],
    clientNamePatterns: ["runway"],
  },
  {
    toolName: "ElevenLabs",
    vendor: "ElevenLabs",
    domains: ["elevenlabs.io", "www.elevenlabs.io"],
    clientNamePatterns: ["elevenlabs", "eleven labs"],
  },
  {
    toolName: "Hugging Face",
    vendor: "Hugging Face",
    domains: ["huggingface.co", "www.huggingface.co"],
    clientNamePatterns: ["hugging face", "huggingface"],
  },
  {
    toolName: "Writesonic",
    vendor: "Writesonic",
    domains: ["writesonic.com", "app.writesonic.com"],
    clientNamePatterns: ["writesonic"],
  },
  {
    toolName: "Replit AI",
    vendor: "Replit",
    domains: ["replit.com", "www.replit.com"],
    clientNamePatterns: ["replit"],
  },
  {
    toolName: "v0",
    vendor: "Vercel",
    domains: ["v0.dev"],
    clientNamePatterns: ["v0.dev", "v0 by vercel"],
  },
  {
    toolName: "Bolt",
    vendor: "StackBlitz",
    domains: ["bolt.new"],
    clientNamePatterns: ["bolt.new", "stackblitz bolt"],
  },
];

/**
 * Match a client name or scopes against known AI tools.
 * Returns the first matching tool or null.
 */
export function matchAITool(
  clientName: string,
  scopes?: string[]
): KnownAITool | null {
  const lowerName = clientName.toLowerCase();

  // Check client name patterns
  for (const tool of KNOWN_AI_TOOLS) {
    for (const pattern of tool.clientNamePatterns) {
      if (lowerName.includes(pattern.toLowerCase())) {
        return tool;
      }
    }
  }

  // Check scopes for domain matches
  if (scopes) {
    const scopeStr = scopes.join(" ").toLowerCase();
    for (const tool of KNOWN_AI_TOOLS) {
      for (const domain of tool.domains) {
        if (scopeStr.includes(domain.toLowerCase())) {
          return tool;
        }
      }
    }
  }

  return null;
}
