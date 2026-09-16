/**
 * Known AI tools registry.
 *
 * Every entry is keyed on the bare hostnames the tool actually resolves — API
 * hosts, auth hosts, app hosts, CDN hosts — because `matchDomain` compares
 * hostnames and DNS/proxy logs record hostnames. A URL path can never match
 * and must not appear here. Where two products genuinely share a host
 * (OpenAI Codex rides on chatgpt.com, HuggingChat on huggingface.co) the
 * general product owns the host and the specific one is reached by name.
 *
 * Categories are a closed set (`AI_TOOL_CATEGORY_IDS`) so the UI can filter
 * and roll up on them and the PATCH route can validate edits.
 */

export const AI_TOOL_CATEGORY_IDS = [
  "chat_assistant",
  "coding_assistant",
  "agent_platform",
  "image_generation",
  "video_generation",
  "audio_voice",
  "writing",
  "meeting_notes",
  "search",
  "ml_platform",
  "data_analysis",
  "productivity",
  "translation",
  "customer_support",
  "browser_extension",
  "other",
] as const;

export type AIToolCategory = (typeof AI_TOOL_CATEGORY_IDS)[number];

export const AI_TOOL_CATEGORY_LABELS: Record<AIToolCategory, string> = {
  chat_assistant: "Chat Assistant",
  coding_assistant: "Coding Assistant",
  agent_platform: "Agent Platform",
  image_generation: "Image Generation",
  video_generation: "Video Generation",
  audio_voice: "Audio & Voice",
  writing: "Writing",
  meeting_notes: "Meeting Notes",
  search: "Search & Research",
  ml_platform: "ML Platform",
  data_analysis: "Data Analysis",
  productivity: "Productivity",
  translation: "Translation",
  customer_support: "Customer Support",
  browser_extension: "Browser Extension",
  other: "Other",
};

/** Ordered list of categories with display labels, for selects and legends. */
export const AI_TOOL_CATEGORIES: ReadonlyArray<{ id: AIToolCategory; label: string }> =
  AI_TOOL_CATEGORY_IDS.map((id) => ({ id, label: AI_TOOL_CATEGORY_LABELS[id] }));

export function isAIToolCategory(value: unknown): value is AIToolCategory {
  return (
    typeof value === "string" &&
    (AI_TOOL_CATEGORY_IDS as readonly string[]).includes(value)
  );
}

export function categoryLabel(category: string | null | undefined): string {
  return isAIToolCategory(category) ? AI_TOOL_CATEGORY_LABELS[category] : "Uncategorized";
}

/**
 * Coarse governance hints a reviewer should know before approving a tool.
 * Deliberately not a risk score — they flag things worth checking, e.g. that
 * the consumer tier trains on prompts, or that data is processed in China.
 */
export type AIToolRiskHint =
  | "trains_on_data"
  | "consumer_grade"
  | "china_hosted"
  | "no_enterprise_tier";

export interface KnownAITool {
  toolName: string;
  vendor: string;
  category: AIToolCategory;
  domains: string[];
  clientNamePatterns: string[];
  publisherPatterns?: string[];
  appIdPatterns?: string[];
  riskHints?: AIToolRiskHint[];
}

export const KNOWN_AI_TOOLS: KnownAITool[] = [
  // ---------------------------------------------------------------------------
  // Chat assistants
  // ---------------------------------------------------------------------------
  {
    toolName: "ChatGPT",
    vendor: "OpenAI",
    category: "chat_assistant",
    domains: [
      "chatgpt.com",
      "chat.openai.com",
      "platform.openai.com",
      "api.openai.com",
      "auth.openai.com",
      "openai.com",
      "oaistatic.com",
      "oaiusercontent.com",
    ],
    clientNamePatterns: ["openai", "chatgpt", "chat gpt", "openai api"],
    publisherPatterns: ["openai"],
    appIdPatterns: ["com.openai.chat", "com.openai"],
  },
  {
    toolName: "Claude",
    vendor: "Anthropic",
    category: "chat_assistant",
    domains: ["claude.ai", "claude.com", "api.anthropic.com", "console.anthropic.com", "anthropic.com"],
    clientNamePatterns: ["anthropic", "claude.ai", "claude", "claude code", "claude desktop"],
    publisherPatterns: ["anthropic"],
    appIdPatterns: ["com.anthropic"],
  },
  {
    toolName: "Gemini",
    vendor: "Google",
    category: "chat_assistant",
    domains: [
      "gemini.google.com",
      "aistudio.google.com",
      "generativelanguage.googleapis.com",
      "bard.google.com",
    ],
    clientNamePatterns: ["gemini", "google ai studio", "bard", "google gemini"],
    publisherPatterns: ["google"],
    appIdPatterns: ["com.google.gemini", "apps.bard"],
  },
  {
    toolName: "Microsoft Copilot",
    vendor: "Microsoft",
    category: "chat_assistant",
    domains: ["copilot.microsoft.com", "m365copilot.com", "copilot.cloud.microsoft", "sydney.bing.com"],
    clientNamePatterns: [
      "microsoft copilot",
      "copilot for microsoft 365",
      "microsoft 365 copilot",
      "365 copilot",
      "m365 copilot",
      "copilot.microsoft.com",
    ],
    publisherPatterns: ["microsoft"],
    appIdPatterns: ["com.microsoft.copilot", "com.microsoft.m365copilot"],
  },
  {
    toolName: "Poe",
    vendor: "Quora",
    category: "chat_assistant",
    domains: ["poe.com", "api.poe.com"],
    clientNamePatterns: ["poe", "poe by quora"],
    publisherPatterns: ["quora"],
    appIdPatterns: ["com.quora.app.experts", "com.quora.poe"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Mistral",
    vendor: "Mistral AI",
    category: "chat_assistant",
    domains: ["mistral.ai", "chat.mistral.ai", "console.mistral.ai", "api.mistral.ai"],
    clientNamePatterns: ["mistral", "mistral ai", "le chat"],
    publisherPatterns: ["mistral"],
    appIdPatterns: ["ai.mistral", "chat.mistral"],
  },
  {
    toolName: "DeepSeek",
    vendor: "DeepSeek",
    category: "chat_assistant",
    domains: ["deepseek.com", "chat.deepseek.com", "api.deepseek.com"],
    clientNamePatterns: ["deepseek", "deep seek"],
    publisherPatterns: ["deepseek"],
    appIdPatterns: ["com.deepseek"],
    riskHints: ["china_hosted", "trains_on_data", "consumer_grade"],
  },
  {
    toolName: "Kimi",
    vendor: "Moonshot AI",
    category: "chat_assistant",
    domains: ["kimi.com", "kimi.moonshot.cn", "moonshot.cn", "moonshot.ai", "api.moonshot.ai"],
    clientNamePatterns: ["kimi", "moonshot ai", "kimi chat"],
    publisherPatterns: ["moonshot"],
    appIdPatterns: ["com.moonshot.kimi"],
    riskHints: ["china_hosted", "consumer_grade"],
  },
  {
    toolName: "Qwen",
    vendor: "Alibaba Cloud",
    category: "chat_assistant",
    domains: ["chat.qwen.ai", "qwen.ai", "tongyi.aliyun.com", "dashscope.aliyuncs.com"],
    clientNamePatterns: ["qwen", "tongyi", "tongyi qianwen"],
    publisherPatterns: ["alibaba"],
    riskHints: ["china_hosted"],
  },
  {
    toolName: "Doubao",
    vendor: "ByteDance",
    category: "chat_assistant",
    domains: ["doubao.com", "ark.cn-beijing.volces.com"],
    clientNamePatterns: ["doubao"],
    publisherPatterns: ["bytedance"],
    riskHints: ["china_hosted", "consumer_grade"],
  },
  {
    toolName: "Yuanbao",
    vendor: "Tencent",
    category: "chat_assistant",
    domains: ["yuanbao.tencent.com", "hunyuan.tencent.com"],
    clientNamePatterns: ["yuanbao", "hunyuan", "tencent yuanbao"],
    publisherPatterns: ["tencent"],
    riskHints: ["china_hosted", "consumer_grade"],
  },
  {
    toolName: "ERNIE Bot",
    vendor: "Baidu",
    category: "chat_assistant",
    domains: ["yiyan.baidu.com", "qianfan.baidubce.com", "ernie.baidu.com"],
    clientNamePatterns: ["ernie bot", "wenxin yiyan", "yiyan", "baidu ernie"],
    publisherPatterns: ["baidu"],
    riskHints: ["china_hosted"],
  },
  {
    toolName: "ChatGLM",
    vendor: "Zhipu AI",
    category: "chat_assistant",
    domains: ["chatglm.cn", "bigmodel.cn", "open.bigmodel.cn", "z.ai"],
    clientNamePatterns: ["chatglm", "zhipu", "z.ai"],
    publisherPatterns: ["zhipu"],
    riskHints: ["china_hosted"],
  },
  {
    toolName: "Character.ai",
    vendor: "Character Technologies",
    category: "chat_assistant",
    domains: ["character.ai", "c.ai", "beta.character.ai"],
    clientNamePatterns: ["character.ai", "character ai"],
    publisherPatterns: ["character technologies"],
    appIdPatterns: ["ai.character"],
    riskHints: ["consumer_grade", "no_enterprise_tier", "trains_on_data"],
  },
  {
    toolName: "Pi",
    vendor: "Inflection AI",
    category: "chat_assistant",
    domains: ["pi.ai", "heypi.com"],
    clientNamePatterns: ["pi.ai", "inflection pi", "heypi"],
    publisherPatterns: ["inflection"],
    appIdPatterns: ["ai.inflection"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "You.com",
    vendor: "You.com",
    category: "chat_assistant",
    domains: ["you.com", "api.you.com"],
    clientNamePatterns: ["you.com", "youchat"],
    publisherPatterns: ["you.com"],
  },
  {
    toolName: "Meta AI",
    vendor: "Meta",
    category: "chat_assistant",
    domains: ["meta.ai"],
    clientNamePatterns: ["meta ai", "meta.ai"],
    publisherPatterns: ["meta platforms"],
    appIdPatterns: ["com.facebook.metaai"],
    riskHints: ["consumer_grade", "trains_on_data"],
  },
  {
    toolName: "Grok",
    vendor: "xAI",
    category: "chat_assistant",
    domains: ["grok.com", "x.ai", "api.x.ai", "grok.x.ai"],
    clientNamePatterns: ["grok", "xai grok"],
    publisherPatterns: ["xai", "x.ai"],
    appIdPatterns: ["ai.x.grok"],
  },
  {
    toolName: "Replika",
    vendor: "Luka",
    category: "chat_assistant",
    domains: ["replika.com", "replika.ai"],
    clientNamePatterns: ["replika"],
    appIdPatterns: ["ai.replika"],
    riskHints: ["consumer_grade", "no_enterprise_tier", "trains_on_data"],
  },
  {
    toolName: "Janitor AI",
    vendor: "Janitor AI",
    category: "chat_assistant",
    domains: ["janitorai.com"],
    clientNamePatterns: ["janitor ai", "janitorai"],
    riskHints: ["consumer_grade", "no_enterprise_tier"],
  },

  // ---------------------------------------------------------------------------
  // Coding assistants
  // ---------------------------------------------------------------------------
  {
    toolName: "GitHub Copilot",
    vendor: "GitHub / Microsoft",
    category: "coding_assistant",
    // The hosts the Copilot IDE extensions actually talk to: the completions
    // proxy, the Copilot API, and the telemetry host. Plain github.com traffic
    // must not be flagged as Copilot.
    domains: [
      "copilot.github.com",
      "githubcopilot.com",
      "copilot-proxy.githubusercontent.com",
      "copilot-telemetry.githubusercontent.com",
    ],
    clientNamePatterns: ["copilot", "github copilot", "copilot for github", "github.copilot"],
    publisherPatterns: ["github", "microsoft"],
  },
  {
    toolName: "Cursor",
    vendor: "Anysphere",
    category: "coding_assistant",
    domains: ["cursor.com", "cursor.sh", "api2.cursor.sh", "repo42.cursor.sh", "cursorapi.com"],
    clientNamePatterns: ["cursor", "cursor ai", "anysphere cursor"],
    publisherPatterns: ["anysphere", "cursor"],
    appIdPatterns: ["com.todesktop.230313mzl4w4u92"],
  },
  {
    toolName: "Windsurf",
    vendor: "Cognition (Codeium)",
    category: "coding_assistant",
    domains: ["windsurf.com", "codeium.com", "server.codeium.com", "inference.codeium.com"],
    clientNamePatterns: ["windsurf", "codeium", "codeium.codeium"],
    publisherPatterns: ["codeium", "exafunction"],
    appIdPatterns: ["com.exafunction.windsurf"],
  },
  {
    toolName: "OpenAI Codex",
    vendor: "OpenAI",
    // Codex CLI and the Codex web app ride on the ChatGPT hosts; at the DNS
    // layer this resolves as ChatGPT (listed first). Reached by name/app id.
    category: "coding_assistant",
    domains: ["chatgpt.com"],
    clientNamePatterns: ["openai codex", "codex cli", "codex"],
    publisherPatterns: ["openai"],
    appIdPatterns: ["com.openai.codex", "openai.chatgpt"],
  },
  {
    toolName: "Gemini Code Assist",
    vendor: "Google",
    category: "coding_assistant",
    domains: ["cloudcode-pa.googleapis.com"],
    clientNamePatterns: ["gemini code assist", "gemini cli", "google cloud code", "google.geminicodeassist"],
    publisherPatterns: ["google"],
    appIdPatterns: ["google.geminicodeassist", "google-gemini.gemini-cli"],
  },
  {
    toolName: "Amazon Q Developer",
    vendor: "Amazon Web Services",
    category: "coding_assistant",
    domains: [
      "q.us-east-1.amazonaws.com",
      "codewhisperer.us-east-1.amazonaws.com",
      "q.eu-central-1.amazonaws.com",
    ],
    clientNamePatterns: ["amazon q", "codewhisperer", "amazon q developer", "kiro"],
    publisherPatterns: ["amazon web services"],
    appIdPatterns: ["amazonwebservices.amazon-q-vscode", "com.amazon.q"],
  },
  {
    toolName: "JetBrains AI",
    vendor: "JetBrains",
    category: "coding_assistant",
    domains: ["api.jetbrains.ai", "jetbrains.ai"],
    clientNamePatterns: ["jetbrains ai", "jetbrains ai assistant", "junie"],
    publisherPatterns: ["jetbrains"],
  },
  {
    toolName: "Tabnine",
    vendor: "Tabnine",
    category: "coding_assistant",
    domains: ["tabnine.com", "api.tabnine.com", "update.tabnine.com"],
    clientNamePatterns: ["tabnine", "tab nine"],
    publisherPatterns: ["tabnine"],
    appIdPatterns: ["tabnine.tabnine-vscode"],
  },
  {
    toolName: "Sourcegraph Cody",
    vendor: "Sourcegraph",
    category: "coding_assistant",
    domains: ["sourcegraph.com", "api.sourcegraph.com"],
    clientNamePatterns: ["sourcegraph cody", "sourcegraph", "cody ai"],
    publisherPatterns: ["sourcegraph"],
    appIdPatterns: ["sourcegraph.cody-ai"],
  },
  {
    toolName: "Devin",
    vendor: "Cognition",
    category: "coding_assistant",
    domains: ["devin.ai", "app.devin.ai", "api.devin.ai", "cognition.ai"],
    clientNamePatterns: ["devin ai", "devin.ai", "cognition devin"],
    publisherPatterns: ["cognition"],
  },
  {
    toolName: "Lovable",
    vendor: "Lovable",
    category: "coding_assistant",
    domains: ["lovable.dev", "lovable.app", "lovableproject.com"],
    clientNamePatterns: ["lovable", "gpt engineer"],
    publisherPatterns: ["lovable"],
  },
  {
    toolName: "Replit AI",
    vendor: "Replit",
    category: "coding_assistant",
    domains: ["replit.com", "replit.dev", "repl.co", "replit.app"],
    clientNamePatterns: ["replit", "replit ai", "ghostwriter", "replit agent"],
    publisherPatterns: ["replit"],
    appIdPatterns: ["com.replit"],
  },
  {
    toolName: "v0",
    vendor: "Vercel",
    category: "coding_assistant",
    domains: ["v0.dev", "v0.app"],
    clientNamePatterns: ["v0.dev", "v0.app", "v0 by vercel"],
    publisherPatterns: ["vercel"],
  },
  {
    toolName: "Bolt",
    vendor: "StackBlitz",
    category: "coding_assistant",
    domains: ["bolt.new"],
    clientNamePatterns: ["bolt.new", "stackblitz bolt"],
    publisherPatterns: ["stackblitz"],
  },
  {
    toolName: "Aider",
    vendor: "Aider",
    category: "coding_assistant",
    domains: ["aider.chat"],
    clientNamePatterns: ["aider chat", "aider.chat", "aider-chat"],
  },
  {
    toolName: "Continue",
    vendor: "Continue",
    category: "coding_assistant",
    domains: ["continue.dev", "api.continue.dev"],
    clientNamePatterns: ["continue.dev", "continue dev"],
    appIdPatterns: ["continue.continue"],
  },
  {
    toolName: "Cline",
    vendor: "Cline",
    category: "coding_assistant",
    domains: ["cline.bot", "app.cline.bot", "api.cline.bot"],
    clientNamePatterns: ["cline bot", "cline.bot"],
    appIdPatterns: ["saoudrizwan.claude-dev"],
  },
  {
    toolName: "Roo Code",
    vendor: "Roo Code",
    category: "coding_assistant",
    domains: ["roocode.com", "app.roocode.com"],
    clientNamePatterns: ["roo code", "roocode", "roo cline"],
    appIdPatterns: ["rooveterinaryinc.roo-cline"],
  },
  {
    toolName: "Augment Code",
    vendor: "Augment",
    category: "coding_assistant",
    domains: ["augmentcode.com", "api.augmentcode.com"],
    clientNamePatterns: ["augment code", "augmentcode"],
    publisherPatterns: ["augment computing"],
    appIdPatterns: ["augment.vscode-augment"],
  },
  {
    toolName: "Supermaven",
    vendor: "Supermaven",
    category: "coding_assistant",
    domains: ["supermaven.com", "api.supermaven.com"],
    clientNamePatterns: ["supermaven"],
    appIdPatterns: ["supermaven.supermaven"],
  },
  {
    toolName: "Zed AI",
    vendor: "Zed Industries",
    category: "coding_assistant",
    domains: ["zed.dev", "collab.zed.dev", "cloud.zed.dev"],
    clientNamePatterns: ["zed editor", "zed.dev", "zed ai"],
    publisherPatterns: ["zed industries"],
    appIdPatterns: ["dev.zed.zed"],
  },
  {
    toolName: "Warp",
    vendor: "Warp",
    category: "coding_assistant",
    domains: ["warp.dev", "app.warp.dev"],
    clientNamePatterns: ["warp terminal", "warp.dev", "warpdotdev"],
    publisherPatterns: ["warpdotdev"],
    appIdPatterns: ["dev.warp"],
  },
  {
    toolName: "Phind",
    vendor: "Phind",
    category: "coding_assistant",
    domains: ["phind.com", "api.phind.com"],
    clientNamePatterns: ["phind"],
  },

  // ---------------------------------------------------------------------------
  // Agent platforms
  // ---------------------------------------------------------------------------
  {
    toolName: "Zapier Agents",
    vendor: "Zapier",
    category: "agent_platform",
    domains: ["agents.zapier.com", "central.zapier.com"],
    clientNamePatterns: ["zapier agents", "zapier central", "zapier ai"],
    publisherPatterns: ["zapier"],
  },
  {
    toolName: "Make AI Agents",
    vendor: "Make (Celonis)",
    category: "agent_platform",
    domains: ["make.com", "eu1.make.com", "us1.make.com"],
    clientNamePatterns: ["make.com", "make ai agents", "integromat"],
    publisherPatterns: ["celonis"],
  },
  {
    toolName: "n8n",
    vendor: "n8n",
    category: "agent_platform",
    domains: ["n8n.io", "n8n.cloud", "api.n8n.io"],
    clientNamePatterns: ["n8n"],
    publisherPatterns: ["n8n"],
  },
  {
    toolName: "Relevance AI",
    vendor: "Relevance AI",
    category: "agent_platform",
    domains: ["relevanceai.com", "app.relevanceai.com", "tryrelevance.com"],
    clientNamePatterns: ["relevance ai", "relevanceai"],
    publisherPatterns: ["relevance ai"],
  },
  {
    toolName: "Lindy",
    vendor: "Lindy",
    category: "agent_platform",
    domains: ["lindy.ai", "app.lindy.ai", "api.lindy.ai"],
    clientNamePatterns: ["lindy", "lindy ai"],
    publisherPatterns: ["lindy"],
  },
  {
    toolName: "Manus",
    vendor: "Butterfly Effect",
    category: "agent_platform",
    domains: ["manus.im", "api.manus.im"],
    clientNamePatterns: ["manus", "manus ai"],
    publisherPatterns: ["butterfly effect"],
  },
  {
    toolName: "Genspark",
    vendor: "Genspark",
    category: "agent_platform",
    domains: ["genspark.ai", "api.genspark.ai"],
    clientNamePatterns: ["genspark"],
  },
  {
    toolName: "Beam AI",
    vendor: "Beam",
    category: "agent_platform",
    domains: ["beam.ai", "app.beam.ai"],
    clientNamePatterns: ["beam ai", "beam.ai"],
  },
  {
    toolName: "Dust",
    vendor: "Dust",
    category: "agent_platform",
    domains: ["dust.tt", "eu.dust.tt"],
    clientNamePatterns: ["dust.tt", "dust ai"],
  },
  {
    toolName: "CrewAI",
    vendor: "CrewAI",
    category: "agent_platform",
    domains: ["crewai.com", "app.crewai.com", "api.crewai.com"],
    clientNamePatterns: ["crewai", "crew ai"],
  },
  {
    toolName: "Botpress",
    vendor: "Botpress",
    category: "agent_platform",
    domains: ["botpress.com", "botpress.cloud", "app.botpress.cloud"],
    clientNamePatterns: ["botpress"],
  },
  {
    toolName: "Voiceflow",
    vendor: "Voiceflow",
    category: "agent_platform",
    domains: ["voiceflow.com", "creator.voiceflow.com", "general-runtime.voiceflow.com"],
    clientNamePatterns: ["voiceflow"],
  },
  {
    toolName: "Dify",
    vendor: "LangGenius",
    category: "agent_platform",
    domains: ["dify.ai", "cloud.dify.ai", "udify.app"],
    clientNamePatterns: ["dify.ai", "dify cloud"],
  },
  {
    toolName: "Coze",
    vendor: "ByteDance",
    category: "agent_platform",
    domains: ["coze.com", "coze.cn", "api.coze.com"],
    clientNamePatterns: ["coze"],
    publisherPatterns: ["bytedance"],
    riskHints: ["china_hosted"],
  },

  // ---------------------------------------------------------------------------
  // Image generation
  // ---------------------------------------------------------------------------
  {
    toolName: "Midjourney",
    vendor: "Midjourney Inc",
    category: "image_generation",
    domains: ["midjourney.com", "cdn.midjourney.com", "alpha.midjourney.com"],
    clientNamePatterns: ["midjourney"],
    appIdPatterns: ["com.midjourney"],
    riskHints: ["consumer_grade", "no_enterprise_tier"],
  },
  {
    toolName: "Stability AI",
    vendor: "Stability AI",
    category: "image_generation",
    domains: ["stability.ai", "api.stability.ai", "platform.stability.ai", "dreamstudio.ai"],
    clientNamePatterns: ["stability ai", "stable diffusion", "dreamstudio", "stability.ai"],
    publisherPatterns: ["stability ai"],
  },
  {
    toolName: "Leonardo AI",
    vendor: "Leonardo.Ai",
    category: "image_generation",
    domains: ["leonardo.ai", "app.leonardo.ai", "cloud.leonardo.ai"],
    clientNamePatterns: ["leonardo ai", "leonardo.ai"],
    appIdPatterns: ["ai.leonardo"],
  },
  {
    toolName: "Ideogram",
    vendor: "Ideogram",
    category: "image_generation",
    domains: ["ideogram.ai", "api.ideogram.ai"],
    clientNamePatterns: ["ideogram"],
  },
  {
    toolName: "Flux",
    vendor: "Black Forest Labs",
    category: "image_generation",
    domains: ["bfl.ai", "api.bfl.ai", "bfl.ml", "api.bfl.ml", "blackforestlabs.ai"],
    clientNamePatterns: ["black forest labs", "flux.1", "flux ai", "bfl.ai"],
    publisherPatterns: ["black forest labs"],
  },
  {
    toolName: "DALL·E",
    vendor: "OpenAI",
    category: "image_generation",
    domains: ["labs.openai.com"],
    clientNamePatterns: ["dall-e", "dalle", "dall·e", "dall e"],
    publisherPatterns: ["openai"],
  },
  {
    toolName: "Adobe Firefly",
    vendor: "Adobe",
    category: "image_generation",
    domains: ["firefly.adobe.com", "firefly-api.adobe.io"],
    clientNamePatterns: ["adobe firefly", "firefly.adobe.com"],
    publisherPatterns: ["adobe"],
  },
  {
    toolName: "Krea",
    vendor: "Krea",
    category: "image_generation",
    domains: ["krea.ai", "api.krea.ai"],
    clientNamePatterns: ["krea ai", "krea.ai"],
  },

  // ---------------------------------------------------------------------------
  // Video generation
  // ---------------------------------------------------------------------------
  {
    toolName: "Runway",
    vendor: "Runway",
    category: "video_generation",
    domains: ["runwayml.com", "app.runwayml.com", "api.runwayml.com", "api.dev.runwayml.com"],
    clientNamePatterns: ["runway", "runwayml"],
    publisherPatterns: ["runway"],
    appIdPatterns: ["com.runwayml"],
  },
  {
    toolName: "Pika",
    vendor: "Pika Labs",
    category: "video_generation",
    domains: ["pika.art", "app.pika.art", "api.pika.art"],
    clientNamePatterns: ["pika labs", "pika.art", "pika ai"],
    publisherPatterns: ["pika labs"],
  },
  {
    toolName: "Luma AI",
    vendor: "Luma AI",
    category: "video_generation",
    domains: ["lumalabs.ai", "api.lumalabs.ai", "dream-machine.lumalabs.ai"],
    clientNamePatterns: ["luma ai", "lumalabs", "luma labs", "dream machine"],
    publisherPatterns: ["luma ai"],
    appIdPatterns: ["ai.lumalabs"],
  },
  {
    toolName: "Kling AI",
    vendor: "Kuaishou",
    category: "video_generation",
    domains: ["klingai.com", "app.klingai.com", "api.klingai.com", "kling.kuaishou.com"],
    clientNamePatterns: ["kling ai", "klingai"],
    publisherPatterns: ["kuaishou"],
    riskHints: ["china_hosted"],
  },
  {
    toolName: "HeyGen",
    vendor: "HeyGen",
    category: "video_generation",
    domains: ["heygen.com", "app.heygen.com", "api.heygen.com"],
    clientNamePatterns: ["heygen", "hey gen"],
    publisherPatterns: ["heygen"],
  },
  {
    toolName: "Synthesia",
    vendor: "Synthesia",
    category: "video_generation",
    domains: ["synthesia.io", "app.synthesia.io", "api.synthesia.io"],
    clientNamePatterns: ["synthesia"],
    publisherPatterns: ["synthesia"],
  },
  {
    toolName: "D-ID",
    vendor: "D-ID",
    category: "video_generation",
    domains: ["d-id.com", "studio.d-id.com", "api.d-id.com"],
    clientNamePatterns: ["d-id", "d-id studio"],
    publisherPatterns: ["d-id"],
  },
  {
    toolName: "Sora",
    vendor: "OpenAI",
    category: "video_generation",
    domains: ["sora.com", "sora.chatgpt.com"],
    clientNamePatterns: ["openai sora", "sora.com", "sora ai"],
    publisherPatterns: ["openai"],
    appIdPatterns: ["com.openai.sora"],
  },
  {
    toolName: "Hailuo AI",
    vendor: "MiniMax",
    category: "video_generation",
    domains: ["hailuoai.com", "hailuoai.video", "minimax.io", "minimaxi.com", "api.minimax.chat"],
    clientNamePatterns: ["hailuo", "minimax"],
    publisherPatterns: ["minimax"],
    riskHints: ["china_hosted"],
  },
  {
    toolName: "InVideo AI",
    vendor: "InVideo",
    category: "video_generation",
    domains: ["invideo.io", "ai.invideo.io"],
    clientNamePatterns: ["invideo"],
  },
  {
    toolName: "Opus Clip",
    vendor: "OpusClip",
    category: "video_generation",
    domains: ["opus.pro", "app.opus.pro"],
    clientNamePatterns: ["opus clip", "opusclip"],
  },

  // ---------------------------------------------------------------------------
  // Audio & voice
  // ---------------------------------------------------------------------------
  {
    toolName: "ElevenLabs",
    vendor: "ElevenLabs",
    category: "audio_voice",
    domains: ["elevenlabs.io", "api.elevenlabs.io", "elevenlabs.com"],
    clientNamePatterns: ["elevenlabs", "eleven labs"],
    publisherPatterns: ["elevenlabs", "eleven labs"],
    appIdPatterns: ["io.elevenlabs", "com.elevenlabs"],
  },
  {
    toolName: "Suno",
    vendor: "Suno",
    category: "audio_voice",
    domains: ["suno.com", "suno.ai", "studio-api.suno.ai", "cdn1.suno.ai"],
    clientNamePatterns: ["suno", "suno ai"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Udio",
    vendor: "Udio",
    category: "audio_voice",
    domains: ["udio.com", "api.udio.com"],
    clientNamePatterns: ["udio.com", "udio ai", "udio music"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Descript",
    vendor: "Descript",
    category: "audio_voice",
    domains: ["descript.com", "web.descript.com", "api.descript.com"],
    clientNamePatterns: ["descript", "overdub"],
    publisherPatterns: ["descript"],
    appIdPatterns: ["com.descript"],
  },
  {
    toolName: "Murf AI",
    vendor: "Murf",
    category: "audio_voice",
    domains: ["murf.ai", "api.murf.ai"],
    clientNamePatterns: ["murf ai", "murf.ai"],
  },
  {
    toolName: "Play.ht",
    vendor: "PlayAI",
    category: "audio_voice",
    domains: ["play.ht", "api.play.ht", "play.ai"],
    clientNamePatterns: ["play.ht", "playht", "play.ai"],
  },
  {
    toolName: "Resemble AI",
    vendor: "Resemble AI",
    category: "audio_voice",
    domains: ["resemble.ai", "app.resemble.ai"],
    clientNamePatterns: ["resemble ai", "resemble.ai"],
  },
  {
    toolName: "Speechify",
    vendor: "Speechify",
    category: "audio_voice",
    domains: ["speechify.com", "api.speechify.com", "audio.speechify.com"],
    clientNamePatterns: ["speechify"],
    appIdPatterns: ["com.cliffweitzman.speechify"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Deepgram",
    vendor: "Deepgram",
    category: "audio_voice",
    domains: ["deepgram.com", "api.deepgram.com"],
    clientNamePatterns: ["deepgram"],
  },
  {
    toolName: "AssemblyAI",
    vendor: "AssemblyAI",
    category: "audio_voice",
    domains: ["assemblyai.com", "api.assemblyai.com"],
    clientNamePatterns: ["assemblyai", "assembly ai"],
  },

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------
  {
    toolName: "Jasper AI",
    vendor: "Jasper",
    category: "writing",
    domains: ["jasper.ai", "app.jasper.ai", "api.jasper.ai"],
    clientNamePatterns: ["jasper", "jasper ai"],
    publisherPatterns: ["jasper"],
  },
  {
    toolName: "Grammarly AI",
    vendor: "Grammarly",
    category: "writing",
    domains: ["grammarly.com", "app.grammarly.com", "grammarly.io"],
    clientNamePatterns: ["grammarly", "grammarly ai", "grammarlygo"],
    publisherPatterns: ["grammarly"],
    appIdPatterns: ["com.grammarly"],
  },
  {
    toolName: "Copy.ai",
    vendor: "Copy.ai",
    category: "writing",
    domains: ["copy.ai", "app.copy.ai", "api.copy.ai"],
    clientNamePatterns: ["copy.ai", "copy ai"],
    publisherPatterns: ["copy.ai", "copy ai"],
  },
  {
    toolName: "Writesonic",
    vendor: "Writesonic",
    category: "writing",
    domains: ["writesonic.com", "app.writesonic.com", "chatsonic.com"],
    clientNamePatterns: ["writesonic", "chatsonic"],
    publisherPatterns: ["writesonic"],
  },
  {
    toolName: "QuillBot",
    vendor: "QuillBot (Learneo)",
    category: "writing",
    domains: ["quillbot.com", "api.quillbot.com"],
    clientNamePatterns: ["quillbot", "quill bot"],
    publisherPatterns: ["quillbot", "learneo"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Wordtune",
    vendor: "AI21 Labs",
    category: "writing",
    domains: ["wordtune.com", "app.wordtune.com", "api.wordtune.com"],
    clientNamePatterns: ["wordtune"],
    publisherPatterns: ["ai21"],
  },
  {
    toolName: "Rytr",
    vendor: "Rytr",
    category: "writing",
    domains: ["rytr.me", "app.rytr.me", "api.rytr.me"],
    clientNamePatterns: ["rytr"],
  },
  {
    toolName: "Sudowrite",
    vendor: "Sudowrite",
    category: "writing",
    domains: ["sudowrite.com", "app.sudowrite.com"],
    clientNamePatterns: ["sudowrite"],
  },
  {
    toolName: "HyperWrite",
    vendor: "OthersideAI",
    category: "writing",
    domains: ["hyperwriteai.com", "app.hyperwriteai.com"],
    clientNamePatterns: ["hyperwrite"],
    publisherPatterns: ["othersideai"],
  },
  {
    toolName: "Anyword",
    vendor: "Anyword",
    category: "writing",
    domains: ["anyword.com", "app.anyword.com"],
    clientNamePatterns: ["anyword"],
  },

  // ---------------------------------------------------------------------------
  // Meeting notes
  // ---------------------------------------------------------------------------
  {
    toolName: "Otter AI",
    vendor: "Otter.ai",
    category: "meeting_notes",
    domains: ["otter.ai", "api.otter.ai"],
    clientNamePatterns: ["otter", "otter.ai", "otter ai"],
    publisherPatterns: ["otter"],
    appIdPatterns: ["com.aisense.otter"],
  },
  {
    toolName: "Fireflies",
    vendor: "Fireflies.ai",
    category: "meeting_notes",
    domains: ["fireflies.ai", "app.fireflies.ai", "api.fireflies.ai"],
    clientNamePatterns: ["fireflies", "fireflies ai", "fireflies.ai"],
    publisherPatterns: ["fireflies"],
  },
  {
    toolName: "Read AI",
    vendor: "Read AI",
    category: "meeting_notes",
    domains: ["read.ai", "app.read.ai", "api.read.ai"],
    clientNamePatterns: ["read ai", "read.ai", "readai"],
    publisherPatterns: ["read ai"],
  },
  {
    toolName: "tl;dv",
    vendor: "tl;dv",
    category: "meeting_notes",
    domains: ["tldv.io", "app.tldv.io", "api.tldv.io"],
    clientNamePatterns: ["tldv", "tl;dv"],
    publisherPatterns: ["tldv"],
  },
  {
    toolName: "Fathom",
    vendor: "Fathom",
    category: "meeting_notes",
    domains: ["fathom.video", "app.fathom.video", "fathom.ai", "api.fathom.ai"],
    clientNamePatterns: ["fathom video", "fathom ai", "fathom.video", "fathom notetaker"],
    publisherPatterns: ["fathom video"],
  },
  {
    toolName: "Gong",
    vendor: "Gong",
    category: "meeting_notes",
    domains: ["gong.io", "app.gong.io", "api.gong.io"],
    clientNamePatterns: ["gong.io", "gong io", "gong ai"],
    publisherPatterns: ["gong.io"],
  },
  {
    toolName: "Avoma",
    vendor: "Avoma",
    category: "meeting_notes",
    domains: ["avoma.com", "app.avoma.com", "api.avoma.com"],
    clientNamePatterns: ["avoma"],
    publisherPatterns: ["avoma"],
  },
  {
    toolName: "Granola",
    vendor: "Granola",
    category: "meeting_notes",
    domains: ["granola.ai", "app.granola.ai", "api.granola.ai"],
    clientNamePatterns: ["granola ai", "granola.ai", "granola notes"],
    appIdPatterns: ["com.granola"],
  },
  {
    toolName: "Krisp",
    vendor: "Krisp",
    category: "meeting_notes",
    domains: ["krisp.ai", "api.krisp.ai"],
    clientNamePatterns: ["krisp"],
    publisherPatterns: ["krisp"],
    appIdPatterns: ["ai.krisp"],
  },
  {
    toolName: "Circleback",
    vendor: "Circleback",
    category: "meeting_notes",
    domains: ["circleback.ai", "app.circleback.ai"],
    clientNamePatterns: ["circleback"],
  },

  // ---------------------------------------------------------------------------
  // Search & research
  // ---------------------------------------------------------------------------
  {
    toolName: "Perplexity",
    vendor: "Perplexity AI",
    category: "search",
    domains: ["perplexity.ai", "api.perplexity.ai", "labs.perplexity.ai", "pplx.ai"],
    clientNamePatterns: ["perplexity", "perplexity ai", "pplx"],
    publisherPatterns: ["perplexity"],
    appIdPatterns: ["ai.perplexity", "perplexity.app"],
  },
  {
    toolName: "Glean",
    vendor: "Glean",
    category: "search",
    domains: ["glean.com", "app.glean.com"],
    clientNamePatterns: ["glean", "glean ai"],
    publisherPatterns: ["glean"],
  },
  {
    toolName: "Consensus",
    vendor: "Consensus",
    category: "search",
    domains: ["consensus.app", "api.consensus.app"],
    clientNamePatterns: ["consensus.app", "consensus ai"],
  },
  {
    toolName: "Elicit",
    vendor: "Elicit",
    category: "search",
    domains: ["elicit.com", "elicit.org", "api.elicit.com"],
    clientNamePatterns: ["elicit.com", "elicit ai", "elicit research"],
  },
  {
    toolName: "Scite",
    vendor: "Scite (Research Solutions)",
    category: "search",
    domains: ["scite.ai", "api.scite.ai"],
    clientNamePatterns: ["scite", "scite.ai"],
  },
  {
    toolName: "Exa",
    vendor: "Exa",
    category: "search",
    domains: ["exa.ai", "api.exa.ai"],
    clientNamePatterns: ["exa.ai", "exa search", "metaphor systems"],
  },
  {
    toolName: "Tavily",
    vendor: "Tavily",
    category: "search",
    domains: ["tavily.com", "api.tavily.com"],
    clientNamePatterns: ["tavily"],
  },

  // ---------------------------------------------------------------------------
  // ML platforms & inference
  // ---------------------------------------------------------------------------
  {
    toolName: "Hugging Face",
    vendor: "Hugging Face",
    category: "ml_platform",
    domains: ["huggingface.co", "hf.co", "hf.space", "api-inference.huggingface.co"],
    clientNamePatterns: ["hugging face", "huggingface", "huggingchat"],
    publisherPatterns: ["hugging face", "huggingface"],
  },
  {
    toolName: "Replicate",
    vendor: "Replicate",
    category: "ml_platform",
    domains: ["replicate.com", "api.replicate.com", "replicate.delivery"],
    clientNamePatterns: ["replicate.com", "replicate ai"],
  },
  {
    toolName: "Together AI",
    vendor: "Together AI",
    category: "ml_platform",
    domains: ["together.ai", "api.together.ai", "together.xyz", "api.together.xyz"],
    clientNamePatterns: ["together ai", "together.ai", "together.xyz"],
  },
  {
    toolName: "Fireworks AI",
    vendor: "Fireworks AI",
    category: "ml_platform",
    domains: ["fireworks.ai", "api.fireworks.ai"],
    clientNamePatterns: ["fireworks ai", "fireworks.ai"],
  },
  {
    toolName: "Groq",
    vendor: "Groq",
    category: "ml_platform",
    domains: ["groq.com", "api.groq.com", "console.groq.com"],
    clientNamePatterns: ["groq", "groqcloud"],
    publisherPatterns: ["groq"],
  },
  {
    toolName: "OpenRouter",
    vendor: "OpenRouter",
    category: "ml_platform",
    domains: ["openrouter.ai"],
    clientNamePatterns: ["openrouter", "open router"],
  },
  {
    toolName: "Anyscale",
    vendor: "Anyscale",
    category: "ml_platform",
    domains: ["anyscale.com", "console.anyscale.com", "api.endpoints.anyscale.com"],
    clientNamePatterns: ["anyscale"],
  },
  {
    toolName: "Modal",
    vendor: "Modal Labs",
    category: "ml_platform",
    domains: ["modal.com", "api.modal.com", "modal.run"],
    clientNamePatterns: ["modal labs", "modal.com"],
    publisherPatterns: ["modal labs"],
  },
  {
    toolName: "Baseten",
    vendor: "Baseten",
    category: "ml_platform",
    domains: ["baseten.co", "app.baseten.co", "api.baseten.co", "model.baseten.co"],
    clientNamePatterns: ["baseten"],
  },
  {
    toolName: "Weights & Biases",
    vendor: "Weights & Biases (CoreWeave)",
    category: "ml_platform",
    domains: ["wandb.ai", "api.wandb.ai", "wandb.com"],
    clientNamePatterns: ["weights & biases", "weights and biases", "wandb"],
    publisherPatterns: ["weights & biases"],
  },
  {
    toolName: "LangSmith",
    vendor: "LangChain",
    category: "ml_platform",
    domains: ["smith.langchain.com", "api.smith.langchain.com", "eu.smith.langchain.com"],
    clientNamePatterns: ["langsmith", "langchain"],
    publisherPatterns: ["langchain"],
  },
  {
    toolName: "Cohere",
    vendor: "Cohere",
    category: "ml_platform",
    domains: ["cohere.com", "api.cohere.com", "cohere.ai", "dashboard.cohere.com"],
    clientNamePatterns: ["cohere"],
    publisherPatterns: ["cohere"],
  },
  {
    toolName: "AI21 Labs",
    vendor: "AI21 Labs",
    category: "ml_platform",
    domains: ["ai21.com", "api.ai21.com", "studio.ai21.com"],
    clientNamePatterns: ["ai21", "ai21 labs", "jamba"],
    publisherPatterns: ["ai21"],
  },
  {
    toolName: "Azure OpenAI",
    vendor: "Microsoft",
    category: "ml_platform",
    domains: ["openai.azure.com"],
    clientNamePatterns: ["azure openai", "azure ai foundry"],
    publisherPatterns: ["microsoft"],
  },
  {
    toolName: "Amazon Bedrock",
    vendor: "Amazon Web Services",
    category: "ml_platform",
    domains: [
      "bedrock-runtime.us-east-1.amazonaws.com",
      "bedrock-runtime.us-west-2.amazonaws.com",
      "bedrock-runtime.eu-west-1.amazonaws.com",
      "bedrock-runtime.eu-central-1.amazonaws.com",
      "bedrock.us-east-1.amazonaws.com",
    ],
    clientNamePatterns: ["amazon bedrock", "aws bedrock", "bedrock runtime"],
    publisherPatterns: ["amazon web services"],
  },
  {
    toolName: "Vertex AI",
    vendor: "Google Cloud",
    category: "ml_platform",
    domains: ["aiplatform.googleapis.com", "us-central1-aiplatform.googleapis.com"],
    clientNamePatterns: ["vertex ai", "vertexai", "google vertex"],
    publisherPatterns: ["google"],
  },
  {
    toolName: "Ollama",
    vendor: "Ollama",
    category: "ml_platform",
    domains: ["ollama.com", "ollama.ai", "registry.ollama.ai"],
    clientNamePatterns: ["ollama"],
    appIdPatterns: ["com.electron.ollama"],
  },
  {
    toolName: "LM Studio",
    vendor: "Element Labs",
    category: "ml_platform",
    domains: ["lmstudio.ai", "installers.lmstudio.ai"],
    clientNamePatterns: ["lm studio", "lmstudio"],
    publisherPatterns: ["element labs"],
    appIdPatterns: ["ai.elementlabs.lmstudio"],
  },
  {
    toolName: "Pinecone",
    vendor: "Pinecone",
    category: "ml_platform",
    domains: ["pinecone.io", "app.pinecone.io", "api.pinecone.io"],
    clientNamePatterns: ["pinecone"],
  },
  {
    toolName: "DataRobot",
    vendor: "DataRobot",
    category: "ml_platform",
    domains: ["datarobot.com", "app.datarobot.com"],
    clientNamePatterns: ["datarobot", "data robot"],
    publisherPatterns: ["datarobot"],
  },

  // ---------------------------------------------------------------------------
  // Data analysis
  // ---------------------------------------------------------------------------
  {
    toolName: "Julius AI",
    vendor: "Julius",
    category: "data_analysis",
    domains: ["julius.ai", "app.julius.ai", "api.julius.ai"],
    clientNamePatterns: ["julius ai", "julius.ai"],
  },
  {
    toolName: "Rows AI",
    vendor: "Rows",
    category: "data_analysis",
    domains: ["rows.com", "api.rows.com"],
    clientNamePatterns: ["rows.com", "rows ai"],
  },
  {
    toolName: "Akkio",
    vendor: "Akkio",
    category: "data_analysis",
    domains: ["akkio.com", "app.akkio.com"],
    clientNamePatterns: ["akkio"],
  },
  {
    toolName: "Hex Magic",
    vendor: "Hex Technologies",
    category: "data_analysis",
    domains: ["hex.tech", "app.hex.tech", "api.hex.tech"],
    clientNamePatterns: ["hex.tech", "hex magic", "hex technologies"],
    publisherPatterns: ["hex technologies"],
  },
  {
    toolName: "ThoughtSpot Sage",
    vendor: "ThoughtSpot",
    category: "data_analysis",
    domains: ["thoughtspot.com", "thoughtspot.cloud"],
    clientNamePatterns: ["thoughtspot", "thoughtspot sage"],
    publisherPatterns: ["thoughtspot"],
  },

  // ---------------------------------------------------------------------------
  // Productivity
  // ---------------------------------------------------------------------------
  {
    toolName: "Notion AI",
    vendor: "Notion",
    category: "productivity",
    domains: ["notion.so", "api.notion.com"],
    clientNamePatterns: ["notion", "notion ai"],
    publisherPatterns: ["notion"],
    appIdPatterns: ["notion.id"],
  },
  {
    toolName: "Gamma",
    vendor: "Gamma",
    category: "productivity",
    domains: ["gamma.app", "api.gamma.app"],
    clientNamePatterns: ["gamma.app", "gamma ai", "gamma presentations"],
  },
  {
    toolName: "Tome",
    vendor: "Tome",
    category: "productivity",
    domains: ["tome.app", "api.tome.app"],
    clientNamePatterns: ["tome.app", "tome ai", "tome app"],
  },
  {
    toolName: "Beautiful.ai",
    vendor: "Beautiful.ai",
    category: "productivity",
    domains: ["beautiful.ai", "api.beautiful.ai"],
    clientNamePatterns: ["beautiful.ai", "beautiful ai"],
  },
  {
    toolName: "Canva Magic Studio",
    vendor: "Canva",
    category: "productivity",
    domains: ["canva.com", "canva.cn"],
    clientNamePatterns: ["canva", "canva magic", "magic studio"],
    publisherPatterns: ["canva"],
    appIdPatterns: ["com.canva"],
  },
  {
    toolName: "Mem",
    vendor: "Mem Labs",
    category: "productivity",
    domains: ["mem.ai", "api.mem.ai"],
    clientNamePatterns: ["mem.ai", "mem ai"],
    publisherPatterns: ["mem labs"],
  },
  {
    toolName: "Taskade",
    vendor: "Taskade",
    category: "productivity",
    domains: ["taskade.com", "api.taskade.com"],
    clientNamePatterns: ["taskade"],
  },
  {
    toolName: "Napkin AI",
    vendor: "Napkin",
    category: "productivity",
    domains: ["napkin.ai", "app.napkin.ai"],
    clientNamePatterns: ["napkin ai", "napkin.ai"],
  },
  {
    toolName: "Uizard",
    vendor: "Uizard (Miro)",
    category: "productivity",
    domains: ["uizard.io", "app.uizard.io"],
    clientNamePatterns: ["uizard"],
  },

  // ---------------------------------------------------------------------------
  // Translation
  // ---------------------------------------------------------------------------
  {
    toolName: "DeepL",
    vendor: "DeepL",
    category: "translation",
    domains: ["deepl.com", "api.deepl.com", "api-free.deepl.com"],
    clientNamePatterns: ["deepl", "deepl translate", "deepl write"],
    publisherPatterns: ["deepl"],
    appIdPatterns: ["com.linguee.deepl"],
  },
  {
    toolName: "Lilt",
    vendor: "Lilt",
    category: "translation",
    domains: ["lilt.com", "app.lilt.com", "api.lilt.com"],
    clientNamePatterns: ["lilt"],
    publisherPatterns: ["lilt"],
  },
  {
    toolName: "Smartling",
    vendor: "Smartling",
    category: "translation",
    domains: ["smartling.com", "api.smartling.com", "dashboard.smartling.com"],
    clientNamePatterns: ["smartling"],
    publisherPatterns: ["smartling"],
  },
  {
    toolName: "Unbabel",
    vendor: "Unbabel",
    category: "translation",
    domains: ["unbabel.com", "api.unbabel.com"],
    clientNamePatterns: ["unbabel"],
  },

  // ---------------------------------------------------------------------------
  // Customer support
  // ---------------------------------------------------------------------------
  {
    toolName: "Intercom Fin",
    vendor: "Intercom",
    // Agent-side hosts only: intercom.io serves the chat widget embedded on
    // countless third-party sites and would flag every visit to one of them.
    category: "customer_support",
    domains: ["app.intercom.com", "fin.ai"],
    clientNamePatterns: ["intercom fin", "fin by intercom", "fin ai agent", "intercom"],
    publisherPatterns: ["intercom"],
  },
  {
    toolName: "Ada",
    vendor: "Ada Support",
    category: "customer_support",
    domains: ["ada.cx", "ada.support", "api.ada.support"],
    clientNamePatterns: ["ada cx", "ada support", "ada.cx"],
    publisherPatterns: ["ada support"],
  },
  {
    toolName: "Forethought",
    vendor: "Forethought",
    category: "customer_support",
    domains: ["forethought.ai", "api.forethought.ai"],
    clientNamePatterns: ["forethought"],
  },
  {
    toolName: "Sierra",
    vendor: "Sierra",
    category: "customer_support",
    domains: ["sierra.ai", "api.sierra.ai"],
    clientNamePatterns: ["sierra ai", "sierra.ai"],
  },
  {
    toolName: "Decagon",
    vendor: "Decagon",
    category: "customer_support",
    domains: ["decagon.ai", "api.decagon.ai"],
    clientNamePatterns: ["decagon"],
  },
  {
    toolName: "Kore.ai",
    vendor: "Kore.ai",
    category: "customer_support",
    domains: ["kore.ai", "platform.kore.ai", "bots.kore.ai"],
    clientNamePatterns: ["kore.ai", "kore ai"],
    publisherPatterns: ["kore.ai"],
  },

  // ---------------------------------------------------------------------------
  // Browser extensions
  // ---------------------------------------------------------------------------
  {
    toolName: "Monica",
    vendor: "Monica",
    category: "browser_extension",
    domains: ["monica.im", "api.monica.im"],
    clientNamePatterns: ["monica ai", "monica.im"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Merlin",
    vendor: "Foyer",
    category: "browser_extension",
    domains: ["getmerlin.in", "app.getmerlin.in"],
    clientNamePatterns: ["merlin ai", "getmerlin"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Sider",
    vendor: "Sider",
    category: "browser_extension",
    domains: ["sider.ai", "api.sider.ai"],
    clientNamePatterns: ["sider ai", "sider.ai"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "HARPA AI",
    vendor: "HARPA",
    category: "browser_extension",
    domains: ["harpa.ai", "api.harpa.ai"],
    clientNamePatterns: ["harpa"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "MaxAI",
    vendor: "MaxAI",
    category: "browser_extension",
    domains: ["maxai.me", "app.maxai.me", "api.maxai.me", "maxai.co"],
    clientNamePatterns: ["maxai", "maxai.me"],
    riskHints: ["consumer_grade"],
  },
  {
    toolName: "Compose AI",
    vendor: "Compose AI",
    category: "browser_extension",
    domains: ["compose.ai", "api.compose.ai"],
    clientNamePatterns: ["compose ai", "compose.ai"],
    riskHints: ["consumer_grade"],
  },

  // ---------------------------------------------------------------------------
  // Other
  // ---------------------------------------------------------------------------
  {
    toolName: "Limitless",
    vendor: "Limitless (formerly Rewind)",
    category: "other",
    domains: ["limitless.ai", "app.limitless.ai", "rewind.ai"],
    clientNamePatterns: ["limitless ai", "rewind ai", "rewind.ai", "limitless.ai"],
    appIdPatterns: ["ai.limitless", "com.memoryvault.rewind"],
    riskHints: ["consumer_grade"],
  },
];

const TOOLS_BY_NAME = new Map<string, KnownAITool>(
  KNOWN_AI_TOOLS.map((tool) => [tool.toolName.toLowerCase(), tool])
);

/** Exact (case-insensitive) lookup of a registry entry by its toolName. */
export function findKnownTool(toolName: string | null | undefined): KnownAITool | null {
  if (!toolName) return null;
  return TOOLS_BY_NAME.get(toolName.trim().toLowerCase()) ?? null;
}

/**
 * Category for a discovered tool: by registry toolName first (scanners store
 * the registry's own name on a hit), then by domain. Null when the discovery
 * came from the heuristic path and matches nothing in the registry.
 */
export function resolveToolCategory(input: {
  toolName?: string | null;
  domain?: string | null;
}): AIToolCategory | null {
  const byName = findKnownTool(input.toolName);
  if (byName) return byName.category;
  if (input.domain) {
    const byDomain = matchDomain(input.domain);
    if (byDomain) return byDomain.category;
  }
  return null;
}

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
 * Supports both exact matches and subdomain matching. When several registry
 * hosts match, the most specific (longest) one wins, so "labs.openai.com"
 * resolves to DALL·E rather than the broader "openai.com" ChatGPT entry.
 */
export function matchDomain(domain: string): KnownAITool | null {
  const lowerDomain = domain.toLowerCase().replace(/^www\./, "");

  let best: { tool: KnownAITool; length: number } | null = null;
  for (const tool of KNOWN_AI_TOOLS) {
    for (const knownDomain of tool.domains) {
      const lower = knownDomain.toLowerCase();
      if (lowerDomain === lower || lowerDomain.endsWith("." + lower)) {
        if (!best || lower.length > best.length) {
          best = { tool, length: lower.length };
        }
      }
    }
  }

  return best?.tool ?? null;
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

// Tokens that mark a domain label as AI-related when they appear as a whole
// label ("ai.acme.com", "acme-ai.com"). Whole-label matching avoids the
// "airfrance.com" problem that naive substring checks have with "ai".
const HEURISTIC_DOMAIN_TOKENS = new Set([
  "ai",
  "gpt",
  "llm",
  "genai",
  "chatgpt",
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "copilot",
  "mistral",
  "perplexity",
  "chatbot",
]);

// Distinctive enough that a bare substring match anywhere in the domain is a
// meaningful signal ("mygptapp.com", "tryperplexity.io"). Deliberately
// excludes short/ambiguous tokens like "ai".
const HEURISTIC_DISTINCTIVE_SUBSTRINGS = [
  "gpt",
  "llm",
  "genai",
  "openai",
  "anthropic",
  "copilot",
  "perplexity",
  "chatbot",
];

/**
 * Heuristic fallback for domains that don't match the known-tools registry.
 * Mirrors the low-confidence candidate path used by the Google Workspace
 * scanner so DNS/proxy ingestion can surface *unknown* AI tools for review
 * instead of silently dropping them. Returns null for domains the registry
 * already covers (callers should prefer matchDomain) and for domains with no
 * AI signal.
 */
export function matchDomainHeuristic(domain: string): AIToolMatchResult | null {
  const lower = domain.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!lower || !lower.includes(".")) return null;
  if (matchDomain(lower)) return null;

  const reasons: string[] = [];

  if (lower.endsWith(".ai")) {
    reasons.push(`.ai top-level domain ("${lower}")`);
  } else {
    const labels = lower.split(/[.\-_]/).filter(Boolean);
    const tokenHit = labels.find((label) => HEURISTIC_DOMAIN_TOKENS.has(label));
    if (tokenHit) {
      reasons.push(`domain label "${tokenHit}" is an AI keyword`);
    } else {
      const substringHit = HEURISTIC_DISTINCTIVE_SUBSTRINGS.find((needle) =>
        lower.includes(needle)
      );
      if (substringHit) {
        reasons.push(`domain contains "${substringHit}"`);
      }
    }
  }

  if (reasons.length === 0) return null;

  return {
    tool: {
      toolName: lower,
      vendor: "Needs Review",
      category: "other",
      domains: [lower],
      clientNamePatterns: [lower],
    },
    confidence: "low",
    score: 3,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Fuzzy name matching
// ---------------------------------------------------------------------------

/** Tokens carrying no identity: stripped before token comparison. */
const NAME_FILLER_TOKENS = new Set(["ai", "inc", "llc", "app", "the"]);

/** Registry tokens must be at least this long to tolerate a one-edit typo. */
const FUZZY_MIN_TOKEN_LENGTH = 5;

/**
 * Plain-English words that are the *sole* normalized token of some registry
 * name (Beautiful.ai -> "beautiful", Continue -> "continue", Meta AI ->
 * "meta"). A whole-word hit on one of these is not evidence of the tool — an
 * app called "Beautiful Weather" is not Beautiful.ai — so a single-token
 * pattern made of one of them may not carry a fuzzy match by itself.
 * Multi-token patterns ("adobe firefly") are unaffected.
 */
const FUZZY_GENERIC_TOKENS = new Set([
  "augment",
  "beautiful",
  "character",
  "compose",
  "consensus",
  "continue",
  "elicit",
  "fathom",
  "firefly",
  "fireworks",
  "gamma",
  "granola",
  "julius",
  "leonardo",
  "merlin",
  "modal",
  "monica",
  "relevance",
  "replicate",
  "resemble",
  "sierra",
  "stability",
  "together",
]);

/**
 * Normalize a product/app name for comparison: lowercase, punctuation to
 * whitespace, filler tokens ("ai", "inc", "llc", "app", "the") removed.
 * Returns the remaining tokens in order.
 */
export function normalizeToolName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token && !NAME_FILLER_TOKENS.has(token));
}

/**
 * Damerau-Levenshtein distance (optimal string alignment): insertions,
 * deletions, substitutions, and transpositions of adjacent characters each
 * cost 1. Small inputs only — registry tokens and app-name tokens.
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  // Rows are (la + 1) x (lb + 1); keep three rows for the transposition term.
  let prevPrev: number[] = [];
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const curr: number[] = new Array<number>(lb + 1);
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, prevPrev[j - 2] + 1); // transposition
      }
      curr[j] = value;
    }
    prevPrev = prev;
    prev = curr;
  }
  return prev[lb];
}

function tokensClose(registryToken: string, candidate: string): boolean {
  if (registryToken === candidate) return true;
  if (
    registryToken.length < FUZZY_MIN_TOKEN_LENGTH ||
    candidate.length < FUZZY_MIN_TOKEN_LENGTH
  ) {
    return false;
  }
  if (Math.abs(registryToken.length - candidate.length) > 1) return false;
  return damerauLevenshtein(registryToken, candidate) <= 1;
}

/**
 * Candidate tokens from an observed name: each normalized token, each pair of
 * adjacent tokens concatenated ("co" + "pilot" -> "copilot", "mid" +
 * "journey" -> "midjourney"), and the whole name concatenated.
 */
function candidateTokens(tokens: string[]): string[] {
  const candidates = new Set<string>(tokens);
  for (let i = 0; i + 1 < tokens.length; i++) {
    candidates.add(tokens[i] + tokens[i + 1]);
  }
  if (tokens.length > 2) candidates.add(tokens.join(""));
  return Array.from(candidates);
}

type NormalizedPattern = { raw: string; tokens: string[] };
const normalizedPatternCache = new WeakMap<KnownAITool, NormalizedPattern[]>();

function normalizedPatterns(tool: KnownAITool): NormalizedPattern[] {
  let cached = normalizedPatternCache.get(tool);
  if (!cached) {
    const seen = new Set<string>();
    cached = [];
    for (const raw of [tool.toolName, ...tool.clientNamePatterns]) {
      const tokens = normalizeToolName(raw);
      if (tokens.length === 0) continue;
      const key = tokens.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      // A lone token needs enough length to be distinctive and must not be a
      // plain word; multi-token patterns are distinctive by combination.
      if (
        tokens.length === 1 &&
        (tokens[0].length < FUZZY_MIN_TOKEN_LENGTH || FUZZY_GENERIC_TOKENS.has(tokens[0]))
      ) {
        continue;
      }
      cached.push({ raw, tokens });
    }
    normalizedPatternCache.set(tool, cached);
  }
  return cached;
}

/**
 * Fuzzy-match an observed name against one tool's normalized patterns. Every
 * token of a pattern must be covered by a candidate token of the observed
 * name — exactly, or within one edit for tokens of five or more characters.
 * Returns the covering observed tokens (for the match reason) or null.
 */
function fuzzyNameMatch(tool: KnownAITool, observedNames: string[]): string | null {
  const candidatesPerName = observedNames
    .map((name) => candidateTokens(normalizeToolName(name)))
    .filter((candidates) => candidates.length > 0);
  if (candidatesPerName.length === 0) return null;

  for (const pattern of normalizedPatterns(tool)) {
    for (const candidates of candidatesPerName) {
      const covering: string[] = [];
      for (const token of pattern.tokens) {
        const hit = candidates.find((candidate) => tokensClose(token, candidate));
        if (!hit) break;
        covering.push(hit);
      }
      if (covering.length === pattern.tokens.length) {
        return covering.join(" ");
      }
    }
  }
  return null;
}

function hasDistinguishingReason(reasons: string[]): boolean {
  return reasons.some((reason) => !reason.startsWith("publisher matched"));
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
  // Fuzzy matching looks at names only — never the publisher — so a fuzzy hit
  // is always a distinguishing signal for the endpoint scanners' guards.
  const fuzzyNames = [input.clientName ?? "", ...(input.additionalText ?? [])].filter(Boolean);
  const scopeStr = (input.scopes ?? []).join(" ").toLowerCase();
  const lowerDomains = (input.domains ?? []).map((domain) =>
    domain.toLowerCase().replace(/^www\./, "")
  );
  const lowerAppIds = (input.appIds ?? []).map((appId) => appId.toLowerCase());

  let best: AIToolMatchResult | null = null;
  // Secondary rank keys for equal scores: a signal beyond the publisher name,
  // then the length of the matched name pattern and domain (more specific
  // wins — "openai codex" over "openai", "sora.chatgpt.com" over "chatgpt.com").
  let bestRank: [number, number, number] = [0, 0, 0];

  for (const tool of KNOWN_AI_TOOLS) {
    let score = 0;
    const reasons: string[] = [];
    let namePatternLength = 0;
    let domainLength = 0;

    for (const pattern of tool.clientNamePatterns) {
      const lowerPattern = pattern.toLowerCase();
      if (haystacks.some((haystack) => haystack.includes(lowerPattern))) {
        if (namePatternLength === 0) {
          score += 6;
          reasons.push(`name matched "${pattern}"`);
        }
        // Keep scanning so the most specific matching pattern sets the rank.
        namePatternLength = Math.max(namePatternLength, lowerPattern.length);
      }
    }

    if (namePatternLength === 0 && fuzzyNames.length > 0) {
      const fuzzyToken = fuzzyNameMatch(tool, fuzzyNames);
      if (fuzzyToken) {
        score += 4;
        reasons.push(`fuzzy_name:${fuzzyToken}`);
        namePatternLength = fuzzyToken.length;
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
        if (domainLength === 0) {
          score += 8;
          reasons.push(`domain matched "${lowerDomain}"`);
        }
        domainLength = Math.max(domainLength, lowerDomain.length);
        continue;
      }
      if (domainLength === 0 && scopeStr.includes(lowerDomain)) {
        score += 3;
        reasons.push(`scope referenced "${lowerDomain}"`);
        // A scope reference is weaker than a domain hit; do not let it set
        // the specificity rank.
        domainLength = -1;
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
    const rank: [number, number, number] = [
      hasDistinguishingReason(reasons) ? 1 : 0,
      namePatternLength,
      Math.max(domainLength, 0),
    ];

    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && compareRank(rank, bestRank) > 0)
    ) {
      best = candidate;
      bestRank = rank;
    }
  }

  return best;
}

function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}
