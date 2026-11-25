import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const AI_TIMEOUT_MS = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function manualReview(response) {
  return json(response, 200, {
    status: "manual_review",
    topic: null,
    draft: null,
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

async function handleTriage(request, response) {
  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }

  if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.text !== "string" ||
      payload.text.trim().length === 0
  ) {
    return json(response, 400, { status: "invalid_input" });
  }

  let rawAiOutput;
  try {
    rawAiOutput = await classify(payload.text, {
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch {
    return manualReview(response);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawAiOutput);
  } catch {
    return manualReview(response);
  }

  if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.topic !== "string" ||
      !ALLOWED_TOPICS.has(parsed.topic) ||
      typeof parsed.draft !== "string" ||
      parsed.draft.trim().length === 0
  ) {
    return manualReview(response);
  }

  return json(response, 200, {
    status: "ready",
    topic: parsed.topic,
    draft: parsed.draft.trim(),
  });
}

export function createAppServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage") {
      return json(response, 404, { status: "not_found" });
    }
    try {
      await handleTriage(request, response);
    } catch {
      json(response, 500, { status: "server_error" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
