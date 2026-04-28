export interface KnownAITool {
  toolName: string;
  vendor: string;
  domains: string[];
  clientNamePatterns: string[];
  publisherPatterns?: string[];
  appIdPatterns?: string[];
}

export const KNOWN_AI_TOOLS: KnownAITool[] = [
  {
    toolName: "ChatGPT",
    vendor: "OpenAI",
    domains: ["chat.openai.com", "platform.openai.com", "openai.com"],
    clientNamePatterns: ["openai", "chatgpt", "chat gpt", "openai api"],
    publisherPatterns: ["openai"],
  },
  {
    toolName: "Claude",
    vendor: "Anthropic",
    domains: ["claude.ai", "console.anthropic.com", "anthropic.com"],
    clientNamePatterns: ["anthropic", "claude.ai", "claude"],
    publisherPatterns: ["anthropic"],
  },
  {
    toolName: "Gemini",
    vendor: "Google",
    domains: ["gemini.google.com", "aistudio.google.com"],
    clientNamePatterns: ["gemini", "google ai studio", "bard", "google gemini"],
    publisherPatterns: ["google"],
  },
  {
    toolName: "GitHub Copilot",
    vendor: "GitHub / Microsoft",
    domains: ["copilot.github.com", "github.com/features/copilot"],
    clientNamePatterns: ["copilot", "github copilot", "copilot for github"],
    publisherPatterns: ["github", "microsoft"],
  },
  {
    toolName: "Microsoft Copilot",
    vendor: "Microsoft",
    domains: ["copilot.microsoft.com", "m365copilot.com"],
    clientNamePatterns: [
      "microsoft copilot",
      "copilot for microsoft 365",
      "m365 copilot",
      "copilot.microsoft.com",
    ],
    publisherPatterns: ["microsoft"],
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
    clientNamePatterns: ["perplexity", "perplexity ai"],
    publisherPatterns: ["perplexity"],
  },
  {
    toolName: "Cursor",
    vendor: "Anysphere",
    domains: ["cursor.com", "www.cursor.com"],
    clientNamePatterns: ["cursor", "cursor ai"],
    publisherPatterns: ["anysphere", "cursor"],
  },
  {
    toolName: "Jasper AI",
    vendor: "Jasper",
    domains: ["jasper.ai", "www.jasper.ai"],
    clientNamePatterns: ["jasper", "jasper ai"],
    publisherPatterns: ["jasper"],
  },
  {
    toolName: "Notion AI",
    vendor: "Notion",
    domains: ["notion.so", "www.notion.so"],
    clientNamePatterns: ["notion", "notion ai"],
    publisherPatterns: ["notion"],
  },
  {
    toolName: "Grammarly AI",
    vendor: "Grammarly",
    domains: ["grammarly.com", "app.grammarly.com"],
    clientNamePatterns: ["grammarly", "grammarly ai", "grammarlygo"],
    publisherPatterns: ["grammarly"],
  },
  {
    toolName: "Copy.ai",
    vendor: "Copy.ai",
    domains: ["copy.ai", "www.copy.ai"],
    clientNamePatterns: ["copy.ai", "copy ai"],
    publisherPatterns: ["copy.ai", "copy ai"],
  },
  {
    toolName: "Runway",
    vendor: "Runway",
    domains: ["runwayml.com", "app.runwayml.com"],
    clientNamePatterns: ["runway", "runwayml"],
    publisherPatterns: ["runway"],
  },
  {
    toolName: "ElevenLabs",
    vendor: "ElevenLabs",
    domains: ["elevenlabs.io", "www.elevenlabs.io"],
    clientNamePatterns: ["elevenlabs", "eleven labs"],
    publisherPatterns: ["elevenlabs", "eleven labs"],
  },
  {
    toolName: "Hugging Face",
    vendor: "Hugging Face",
    domains: ["huggingface.co", "www.huggingface.co"],
    clientNamePatterns: ["hugging face", "huggingface"],
    publisherPatterns: ["hugging face", "huggingface"],
  },
  {
    toolName: "Writesonic",
    vendor: "Writesonic",
    domains: ["writesonic.com", "app.writesonic.com"],
    clientNamePatterns: ["writesonic", "chatsonic"],
    publisherPatterns: ["writesonic"],
  },
  {
    toolName: "Replit AI",
    vendor: "Replit",
    domains: ["replit.com", "www.replit.com"],
    clientNamePatterns: ["replit", "replit ai", "ghostwriter"],
    publisherPatterns: ["replit"],
  },
  {
    toolName: "v0",
    vendor: "Vercel",
    domains: ["v0.dev"],
    clientNamePatterns: ["v0.dev", "v0 by vercel"],
    publisherPatterns: ["vercel"],
  },
  {
    toolName: "Bolt",
    vendor: "StackBlitz",
    domains: ["bolt.new"],
    clientNamePatterns: ["bolt.new", "stackblitz bolt"],
    publisherPatterns: ["stackblitz"],
  },
  {
    toolName: "Poe",
    vendor: "Quora",
    domains: ["poe.com", "www.poe.com"],
    clientNamePatterns: ["poe", "poe by quora"],
    publisherPatterns: ["quora"],
  },
  {
    toolName: "Glean",
    vendor: "Glean",
    domains: ["glean.com", "app.glean.com"],
    clientNamePatterns: ["glean", "glean ai"],
    publisherPatterns: ["glean"],
  },
  {
    toolName: "Mistral",
    vendor: "Mistral AI",
    domains: ["mistral.ai", "console.mistral.ai"],
    clientNamePatterns: ["mistral", "mistral ai", "le chat"],
    publisherPatterns: ["mistral"],
  },
  {
    toolName: "Otter AI",
    vendor: "Otter.ai",
    domains: ["otter.ai"],
    clientNamePatterns: ["otter", "otter.ai", "otter ai"],
    publisherPatterns: ["otter"],
  },
];

export type AIToolMatchResult = {
  tool: KnownAITool;
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: string[];
};

/**
 * Match a client name or scopes against known AI tools.
 * Returns the first matching tool or null.
 */
export function matchAITool(
  clientName: string,
  scopes?: string[]
): KnownAITool | null {
  return resolveAIToolMatch({ clientName, scopes })?.tool ?? null;
}

/**
 * Match a domain (e.g. "chat.openai.com") against known AI tools.
 * Supports both exact matches and subdomain matching.
 */
export function matchDomain(domain: string): KnownAITool | null {
  const lowerDomain = domain.toLowerCase().replace(/^www\./, "");

  for (const tool of KNOWN_AI_TOOLS) {
    for (const knownDomain of tool.domains) {
      const lower = knownDomain.toLowerCase();
      if (lowerDomain === lower || lowerDomain.endsWith("." + lower)) {
        return tool;
      }
    }
  }

  return null;
}

/**
 * Get all known AI tool domains as a flat set (for fast lookup).
 */
export function getAllKnownDomains(): Set<string> {
  const domains = new Set<string>();
  for (const tool of KNOWN_AI_TOOLS) {
    for (const d of tool.domains) {
      domains.add(d.toLowerCase());
    }
  }
  return domains;
}

export function resolveAIToolMatch(input: {
  clientName?: string | null;
  scopes?: string[];
  publisherName?: string | null;
  domains?: string[];
  appIds?: string[];
  additionalText?: string[];
}): AIToolMatchResult | null {
  const haystacks = [
    input.clientName ?? "",
    input.publisherName ?? "",
    ...(input.additionalText ?? []),
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  const scopeStr = (input.scopes ?? []).join(" ").toLowerCase();
  const lowerDomains = (input.domains ?? []).map((domain) =>
    domain.toLowerCase().replace(/^www\./, "")
  );
  const lowerAppIds = (input.appIds ?? []).map((appId) => appId.toLowerCase());

  let best: AIToolMatchResult | null = null;

  for (const tool of KNOWN_AI_TOOLS) {
    let score = 0;
    const reasons: string[] = [];

    for (const pattern of tool.clientNamePatterns) {
      if (haystacks.some((haystack) => haystack.includes(pattern.toLowerCase()))) {
        score += 6;
        reasons.push(`name matched "${pattern}"`);
        break;
      }
    }

    for (const publisherPattern of tool.publisherPatterns ?? []) {
      if (haystacks.some((haystack) => haystack.includes(publisherPattern.toLowerCase()))) {
        score += 4;
        reasons.push(`publisher matched "${publisherPattern}"`);
        break;
      }
    }

    for (const domain of tool.domains) {
      const lowerDomain = domain.toLowerCase().replace(/^www\./, "");
      if (
        lowerDomains.some(
          (candidate) =>
            candidate === lowerDomain || candidate.endsWith(`.${lowerDomain}`)
        )
      ) {
        score += 8;
        reasons.push(`domain matched "${lowerDomain}"`);
        break;
      }
      if (scopeStr.includes(lowerDomain)) {
        score += 3;
        reasons.push(`scope referenced "${lowerDomain}"`);
        break;
      }
    }

    for (const appIdPattern of tool.appIdPatterns ?? []) {
      if (lowerAppIds.some((appId) => appId.includes(appIdPattern.toLowerCase()))) {
        score += 5;
        reasons.push(`app id matched "${appIdPattern}"`);
        break;
      }
    }

    if (score === 0) continue;

    const confidence =
      score >= 10 ? "high" : score >= 6 ? "medium" : "low";
    const candidate: AIToolMatchResult = {
      tool,
      confidence,
      score,
      reasons,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}
