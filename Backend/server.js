// server.js (ESM)
// --- Imports ---
import 'dotenv/config';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { WebSocketServer } from 'ws';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

// --- Persona / System Instruction (adapted to QA chatbot + small affectionate touches retained) ---
const inderPersona = `
You are a QA Chatbot designed to help users manage and track software issues.
You are affectionate but professional when required. When user explicitly wants casual pet names, use them sparingly.
Core job:
- Track issues provided by the user.
- Detect duplicates / near-duplicates and explain why.
- Present clear structured results: New Issues and Existing Matches.
`;

// --- Databases ---
const adapter = new JSONFile('.db.json');
const db = new Low(adapter, { history: [] });
await db.read();

const factsAdapter = new JSONFile('.facts.json');
const factDb = new Low(factsAdapter, { facts: [] });
await factDb.read();

const issuesAdapter = new JSONFile('.issues.json');
const issuesDb = new Low(issuesAdapter, { issues: [] });
await issuesDb.read();

// --- Google AI Setup ---
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const generationConfig = {
  temperature: 0.9,
  topK: 1,
  topP: 1,
  maxOutputTokens: 2048,
};
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// --- WebSocket Server ---
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`Server started on port ${PORT}`);
console.log(`Loaded ${db.data.history.length} chat messages.`);
console.log(`Loaded ${factDb.data.facts.length} permanent facts.`);
console.log(`Loaded ${issuesDb.data.issues.length} saved issues.`);

// --- Helpers ---
function sendSocketMessage(ws, type, text) {
  ws.send(JSON.stringify({ type, text }));
}
const delay = ms => new Promise(res => setTimeout(res, ms));

function normalizeText(s = '') {
  return s.toLowerCase()
    .replace(/[`~!@#$%^&*()_+\-=\[\]{};:"\\|<>\/?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenSet(s) {
  const n = normalizeText(s);
  if (!n) return new Set();
  return new Set(n.split(' ').filter(Boolean));
}
function jaccardSimilarity(a = '', b = '') {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  const union = new Set([...A, ...B]).size;
  return intersection / union;
}
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Parse issues from user text into array of { raw, title, steps?, severity?, tags? }
function parseIssuesFromText(text) {
  const trimmed = text?.trim?.();
  if (!trimmed) return [];

  // Try JSON array first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map(item => {
        if (typeof item === 'string') {
          return { raw: item, title: item.split('\n')[0].slice(0, 120) };
        } else if (typeof item === 'object' && item !== null) {
          return {
            raw: item.description ?? JSON.stringify(item),
            title: item.title ?? (item.description ? item.description.split('\n')[0].slice(0,120) : 'Untitled'),
            steps: item.steps ?? null,
            severity: item.severity ?? null,
            tags: item.tags ?? null
          };
        } else {
          return { raw: String(item), title: String(item).slice(0,120) };
        }
      });
    }
  } catch (e) {
    // ignore JSON parse error
  }

  // Split into lines and look for bullet or numbered lists
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const dashLines = lines.filter(l => /^[\-\*\u2022]\s+/.test(l));
  const numbered = lines.filter(l => /^\d+\.\s+/.test(l));

  if (dashLines.length >= 2) {
    return dashLines.map(l => ({ raw: l.replace(/^[\-\*\u2022]\s+/, ''), title: l.replace(/^[\-\*\u2022]\s+/, '').slice(0,120) }));
  }
  if (numbered.length >= 2) {
    return numbered.map(l => ({ raw: l.replace(/^\d+\.\s*/, ''), title: l.replace(/^\d+\.\s*/, '').slice(0,120) }));
  }

  // Paragraph separation
  const paras = trimmed.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paras.length >= 2) {
    return paras.map(p => ({ raw: p, title: p.split('\n')[0].slice(0,120) }));
  }

  // Otherwise single issue
  return [{ raw: trimmed, title: trimmed.split('\n')[0].slice(0,120) }];
}

// Heuristic to detect if message likely contains issue(s)
function looksLikeIssueSubmission(text) {
  if (!text) return false;
  const kws = ['issue','bug','error','fail','fails','exception','crash','500','stack','repro','steps','cannot','unable'];
  const t = text.toLowerCase();
  if (kws.some(k => t.includes(k))) return true;
  const parsed = parseIssuesFromText(text);
  return parsed.length >= 1;
}

// Create new chat session with Gemini
async function createNewChatSession() {
  let dynamicSystemInstruction = inderPersona;
  await factDb.read();
  if (factDb.data && factDb.data.facts && factDb.data.facts.length) {
    dynamicSystemInstruction += "\n\nPermanent facts:\n";
    factDb.data.facts.forEach(f => dynamicSystemInstruction += `- ${f}\n`);
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    systemInstruction: dynamicSystemInstruction
  });

  await db.read();
  const recent = (db.data.history || []).slice(-30);

  const chat = model.startChat({
    generationConfig,
    safetySettings,
    history: recent
  });

  return chat;
}

// Exponential backoff for sends (handles 429)
async function sendMessageWithBackoff(chat, messageText, maxRetries = 5) {
  let attempt = 0;
  let wait = 1000;
  while (attempt < maxRetries) {
    try {
      const result = await chat.sendMessage(messageText);
      const response = result.response;
      return response.text();
    } catch (err) {
      if (err?.status === 429 || (err?.message && err.message.includes('429'))) {
        console.warn(`429: retry ${attempt+1} in ${wait}ms`);
        await delay(wait);
        attempt++;
        wait *= 2;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed to send after ${maxRetries} retries due to rate limiting.`);
}

// Handle incoming issue submissions: compare to stored issues, save new ones
async function handleIssueSubmission(submittedIssues) {
  await issuesDb.read();
  const stored = issuesDb.data.issues || [];
  const NEW = [];
  const EXISTING = [];

  const DUP_THRESHOLD = 0.5; // tune this

  for (const s of submittedIssues) {
    const raw = s.raw ?? s.description ?? String(s);
    const title = s.title ?? raw.split('\n')[0].slice(0,120);
    let bestScore = 0;
    let bestMatch = null;

    for (const st of stored) {
      const scoreTitle = jaccardSimilarity(title, st.title ?? '');
      const scoreRaw = jaccardSimilarity(raw, st.raw ?? '');
      const score = (0.4 * scoreTitle) + (0.6 * scoreRaw);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = st;
      }
    }

    if (bestScore >= DUP_THRESHOLD && bestMatch) {
      EXISTING.push({
        provided: { title, raw },
        matchId: bestMatch.id,
        matchTitle: bestMatch.title,
        similarity: Number(bestScore.toFixed(3)),
        explanation: `Matched to stored issue id=${bestMatch.id} (similarity ${Number(bestScore.toFixed(3))}).`
      });
    } else {
      const newIssue = {
        id: makeId(),
        title,
        raw,
        steps: s.steps ?? null,
        severity: s.severity ?? null,
        tags: s.tags ?? null,
        createdAt: new Date().toISOString()
      };
      stored.push(newIssue);
      NEW.push(newIssue);
    }
  }

  issuesDb.data.issues = stored;
  await issuesDb.write();

  return { newIssues: NEW, existingMatches: EXISTING };
}

// WebSocket connection handler
wss.on('connection', async ws => {
  console.log('Client connected.');
  let chat = await createNewChatSession();

  ws.on('message', async message => {
    const userMessage = message.toString();
    console.log('Received:', userMessage);

    // sentinel: dump issues
    if (userMessage === '__dump_issues__') {
      try {
        await issuesDb.read();
        const current = issuesDb.data.issues || [];
        sendSocketMessage(ws, 'bot', JSON.stringify({ cmd: 'dump_issues', issues: current }));
      } catch (e) {
        console.error('Failed to read issues:', e);
        sendSocketMessage(ws, 'error', 'Failed to read issues DB.');
      }
      return;
    }

    // commands: remember fact
    const commandPrefix = 'Inder, remember this:';
    if (userMessage.toLowerCase().startsWith(commandPrefix.toLowerCase())) {
      const fact = userMessage.substring(commandPrefix.length).trim();
      factDb.data.facts.push(fact);
      await factDb.write();
      sendSocketMessage(ws, 'bot', `Ok honey bee, I'll remember this: ${fact} ♥️`);
      chat = await createNewChatSession(); // reload brain
      return;
    }

    // clear/reset issues
    if (userMessage.toLowerCase().startsWith('clear issues') || userMessage.toLowerCase().startsWith('reset issues')) {
      issuesDb.data.issues = [];
      await issuesDb.write();
      sendSocketMessage(ws, 'bot', 'All saved issues have been cleared.');
      return;
    }

    // Save to chat history
    db.data.history.push({ role: 'user', parts: [{ text: userMessage }] });
    await db.write();

    // If looks like issue submission, parse and handle locally
    try {
      const possible = parseIssuesFromText(userMessage);
      if (possible.length > 0 && looksLikeIssueSubmission(userMessage)) {
        const report = await handleIssueSubmission(possible);

        // Structured response: JSON string containing summary, newIssues, existingMatches
        const response = {
          summary: { newCount: report.newIssues.length, existingCount: report.existingMatches.length },
          newIssues: report.newIssues,
          existingMatches: report.existingMatches
        };

        sendSocketMessage(ws, 'bot', JSON.stringify(response));
        // Log
        db.data.history.push({ role: 'system', parts: [{ text: `Handled issue submission. New: ${report.newIssues.length}, Matches: ${report.existingMatches.length}` }] });
        await db.write();
        return;
      }
    } catch (err) {
      console.error('Issue parsing/handling error:', err);
      // fallthrough to normal chat
    }

    // Normal chat: forward to Gemini (with backoff)
    try {
      const botResponse = await sendMessageWithBackoff(chat, userMessage);
      sendSocketMessage(ws, 'bot', botResponse);
      db.data.history.push({ role: 'model', parts: [{ text: botResponse }] });
      await db.write();
    } catch (err) {
      console.error('Error sending to model:', err);
      if (err.message && err.message.includes('Failed to send message after')) {
        sendSocketMessage(ws, 'error', 'Server is busy. Try again shortly.');
      } else {
        sendSocketMessage(ws, 'error', 'Server error occurred.');
      }
    }
  });

  ws.on('close', () => console.log('Client disconnected.'));
  ws.on('error', console.error);
});
