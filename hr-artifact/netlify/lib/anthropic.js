"use strict";

const { codedError } = require("./coded-error");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const MAX_TOOL_ROUNDS_HINT = 8;

function anthropicKey() {
  return String(process.env.ANTHROPIC_API_KEY || "").trim();
}

function modelForTier(tier) {
  const def = String(process.env.ANTHROPIC_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const complex =
    String(process.env.ANTHROPIC_MODEL_COMPLEX || "").trim() || def;
  return String(tier || "").toLowerCase() === "complex" ? complex : def;
}

function maxTokensForTier(tier) {
  const raw =
    String(tier || "").toLowerCase() === "complex"
      ? process.env.ANTHROPIC_MAX_TOKENS_COMPLEX
      : process.env.ANTHROPIC_MAX_TOKENS;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 256 && n <= 32000) return Math.floor(n);
  return String(tier || "").toLowerCase() === "complex" ? 8192 : 4096;
}

function sampleLimits() {
  return {
    tools: { maxCount: MAX_TOOL_ROUNDS_HINT },
    modelTiers: ["default", "complex"],
    maxOutputTokens: 8192,
  };
}

function stripDataUrl(value) {
  const s = String(value || "");
  const idx = s.indexOf(",");
  return idx >= 0 ? s.slice(idx + 1) : s;
}

function attachmentBlock(att) {
  if (!att || typeof att !== "object") return null;
  if (att.type === "image" || att.type === "document" || att.type === "text" || att.type === "tool_result") {
    return att;
  }
  if (att.kind === "image" && att.data) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: att.mediaType || "image/jpeg",
        data: stripDataUrl(att.data),
      },
    };
  }
  if (att.kind === "document" && att.data) {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: att.mediaType || "application/pdf",
        data: stripDataUrl(att.data),
      },
    };
  }
  if (att.kind === "text" && att.text) {
    return { type: "text", text: String(att.text) };
  }
  return null;
}

function normalizeBlock(block) {
  if (block == null) return null;
  if (typeof block === "string") return { type: "text", text: block };
  if (typeof block !== "object") return { type: "text", text: String(block) };
  if (block.type === "text" && block.text != null) {
    return { type: "text", text: String(block.text) };
  }
  if ((block.type === "image" || block.type === "document") && block.source) {
    const source = { ...block.source };
    if (source.data) source.data = stripDataUrl(source.data);
    return { type: block.type, source };
  }
  if (block.type === "tool_result" || block.type === "tool_use") return block;
  return attachmentBlock(block);
}

function normalizeMessageContent(content, attachments) {
  const extras = Array.isArray(attachments)
    ? attachments.map(attachmentBlock).filter(Boolean)
    : [];
  if (typeof content === "string") {
    const text = content;
    if (!extras.length) return text;
    return extras.concat(text ? [{ type: "text", text }] : []);
  }
  if (Array.isArray(content)) {
    const blocks = content.map(normalizeBlock).filter(Boolean);
    return extras.length ? extras.concat(blocks) : blocks;
  }
  if (content && typeof content === "object") {
    const one = normalizeBlock(content);
    const blocks = one ? [one] : [];
    return extras.length ? extras.concat(blocks) : blocks.length === 1 ? blocks[0] : blocks;
  }
  if (extras.length) return extras;
  return content == null ? "" : String(content);
}

function messagesHaveDocuments(messages) {
  return (messages || []).some((m) => {
    if (!m || !Array.isArray(m.content)) return false;
    return m.content.some((b) => b && b.type === "document");
  });
}

function normalizeMessages(promptOrMessages) {
  if (typeof promptOrMessages === "string") {
    return coalesceMessages([{ role: "user", content: promptOrMessages }]);
  }
  if (promptOrMessages && typeof promptOrMessages === "object" && !Array.isArray(promptOrMessages)) {
    if (promptOrMessages.role && (promptOrMessages.content != null || promptOrMessages.attachments)) {
      return coalesceMessages([
        {
          role: promptOrMessages.role,
          content: normalizeMessageContent(promptOrMessages.content, promptOrMessages.attachments),
        },
      ]);
    }
  }
  if (!Array.isArray(promptOrMessages) || promptOrMessages.length === 0) {
    throw codedError("bad_request", "prompt or messages are required");
  }
  const messages = promptOrMessages.map((m) => {
    if (typeof m === "string") return { role: "user", content: m };
    const role = m && m.role === "assistant" ? "assistant" : "user";
    return { role, content: normalizeMessageContent(m && m.content, m && m.attachments) };
  });
  return coalesceMessages(messages);
}

function coalesceMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!m) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && typeof prev.content === "string" && typeof m.content === "string") {
      prev.content = `${prev.content}\n\n${m.content}`;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  if (!out.length) {
    throw codedError("bad_request", "prompt or messages are required");
  }
  if (out[0].role !== "user") {
    out.unshift({ role: "user", content: "(start)" });
  }
  return out;
}

function toAnthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.slice(0, MAX_TOOL_ROUNDS_HINT).map((tool) => {
    const schema = tool.inputSchema || tool.input_schema || { type: "object", properties: {} };
    return {
      name: String(tool.name || "").trim(),
      description: String(tool.description || "").trim() || String(tool.name || "tool"),
      input_schema:
        schema && typeof schema === "object"
          ? schema
          : { type: "object", properties: {} },
    };
  }).filter((t) => t.name);
}

function parseJsonText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    throw codedError("tool_error", "The model returned empty JSON");
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  try {
    return JSON.parse(slice);
  } catch {
    throw codedError("tool_error", "The model did not return valid JSON");
  }
}

function mapAnthropicError(status, json) {
  const msg =
    (json && (json.error?.message || json.message || json.error)) ||
    `Anthropic ${status}`;
  const type = json && json.error && json.error.type;
  if (status === 401 || status === 403) {
    return codedError("not_granted", "AI drafting is not permitted.");
  }
  if (status === 429) {
    return codedError("rate_limited", "Rate limited — wait a moment and try again.");
  }
  if (status === 413 || type === "request_too_large") {
    return codedError("prompt_too_large", "That prompt is too large.");
  }
  if (status === 400 && /too (?:many|long)|maximum|token/i.test(String(msg))) {
    return codedError("prompt_too_large", "That prompt is too large.");
  }
  if (status >= 500) {
    return codedError("upstream_error", "The model did not answer.");
  }
  return codedError("tool_error", String(msg));
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && block.type === "text" && block.text)
    .map((block) => block.text)
    .join("");
}

function extractToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((block) => block && block.type === "tool_use" && block.id && block.name)
    .map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input && typeof block.input === "object" ? block.input : {},
    }));
}

async function callAnthropic({ messages, tools, modelTier, mode, signal }) {
  const key = anthropicKey();
  if (!key) {
    throw codedError("not_granted", "AI drafting is not configured on this site.");
  }

  const body = {
    model: modelForTier(modelTier),
    max_tokens: maxTokensForTier(modelTier),
    messages,
  };
  const anthropicTools = toAnthropicTools(tools);
  if (anthropicTools && anthropicTools.length) {
    body.tools = anthropicTools;
  }
  if (mode === "json") {
    body.system =
      "Respond with a single JSON object only. No markdown fences, no commentary, no extra keys beyond what was requested.";
  }

  const headers = {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": ANTHROPIC_VERSION,
  };
  if (messagesHaveDocuments(messages)) {
    headers["anthropic-beta"] = "pdfs-2024-09-25";
  }

  let res;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err && (err.name === "AbortError" || err.code === "ABORT_ERR")) {
      throw codedError("cancelled", "cancelled");
    }
    throw codedError("upstream_error", "The model did not answer.");
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw mapAnthropicError(res.status, json);
  }

  const content = json.content || [];
  const text = extractText(content);
  const toolCalls = extractToolCalls(content);
  const truncated = json.stop_reason === "max_tokens";

  return {
    text,
    truncated,
    toolCalls,
    assistantContent: content,
    stopReason: json.stop_reason || null,
    model: json.model || body.model,
  };
}

module.exports = {
  ANTHROPIC_URL,
  DEFAULT_MODEL,
  callAnthropic,
  coalesceMessages,
  extractText,
  extractToolCalls,
  mapAnthropicError,
  maxTokensForTier,
  messagesHaveDocuments,
  modelForTier,
  normalizeMessageContent,
  normalizeMessages,
  parseJsonText,
  sampleLimits,
  toAnthropicTools,
};
