const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "store.json");
const SEED_DATA_FILE = path.join(__dirname, "data", "seed.json");
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : DEFAULT_DATA_FILE;
const AUTH_USER = process.env.DOCDASH_USER || process.env.BASIC_AUTH_USER || "";
const AUTH_PASSWORD = process.env.DOCDASH_PASSWORD || process.env.BASIC_AUTH_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const AUTH_ENABLED = Boolean(AUTH_USER && AUTH_PASSWORD && SESSION_SECRET);
const AUTH_REQUIRED = AUTH_ENABLED || Boolean(process.env.RAILWAY_ENVIRONMENT);
const SESSION_COOKIE = "docdash_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sendAuthConfigError(res) {
  sendJson(res, 503, {
    error: "Authentication is required but not configured. Set DOCDASH_USER, DOCDASH_PASSWORD and SESSION_SECRET."
  });
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf("=");
        if (separatorIndex === -1) {
          return [cookie, ""];
        }

        return [cookie.slice(0, separatorIndex), decodeURIComponent(cookie.slice(separatorIndex + 1))];
      })
  );
}

function signSessionPayload(payload) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

function createSessionToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      exp: Date.now() + SESSION_TTL_SECONDS * 1000
    })
  ).toString("base64url");

  return `${payload}.${signSessionPayload(payload)}`;
}

function getSession(req) {
  if (!AUTH_ENABLED) {
    return null;
  }

  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, signSessionPayload(payload))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.sub !== AUTH_USER || Number(session.exp || 0) < Date.now()) {
      return null;
    }

    return session;
  } catch (error) {
    return null;
  }
}

function shouldUseSecureCookie(req) {
  return Boolean(process.env.RAILWAY_ENVIRONMENT) || req.headers["x-forwarded-proto"] === "https";
}

function buildSessionCookie(req, token) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];

  if (shouldUseSecureCookie(req)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function buildClearSessionCookie(req) {
  const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];

  if (shouldUseSecureCookie(req)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function isPublicPath(pathname) {
  return [
    "/health",
    "/login.html",
    "/login.js",
    "/styles.css",
    "/favicon.ico",
    "/api/login",
    "/api/logout",
    "/api/session"
  ].includes(pathname);
}

function requireSession(req, res, pathname) {
  if (!AUTH_REQUIRED || isPublicPath(pathname)) {
    return true;
  }

  if (!AUTH_ENABLED) {
    sendAuthConfigError(res);
    return false;
  }

  if (getSession(req)) {
    return true;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(res, 401, { error: "Authentication required" });
    return false;
  }

  res.writeHead(302, { Location: `/login.html?next=${encodeURIComponent(pathname)}` });
  res.end();
  return false;
}

function sendFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal server error");
      return;
    }

    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

function readData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function writeData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function ensureDataFile() {
  if (fs.existsSync(DATA_FILE)) {
    return;
  }

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.copyFileSync(SEED_DATA_FILE, DATA_FILE);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function getCurrentDateKey() {
  const now = new Date();
  const day = now.getDate();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}.${month}.${year}`;
}

function normalizeDateLabel(label) {
  if (!label) {
    return "";
  }

  const numeric = String(label).trim().match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);
  if (numeric) {
    return `${Number(numeric[1])}.${numeric[2]}.${numeric[3]}`;
  }

  return String(label).trim();
}

function getWorkflowStage(visit) {
  if (visit.workflowStage) {
    return visit.workflowStage;
  }

  if (visit.status === "closed") {
    return "closed";
  }

  return normalizeDateLabel(visit.dateLabel) === getCurrentDateKey() ? "today" : "planned";
}

function buildInitialChecklist() {
  return [
    { label: "Wizyta zaplanowana", done: true },
    { label: "Sesja jeszcze nieodbyta", done: false },
    { label: "Brak podsumowania", done: false },
    { label: "Brak rozliczenia", done: false }
  ];
}

function buildManualVisit(payload) {
  const dateKey = normalizeDateLabel(payload.dateLabel);
  const stage = dateKey === getCurrentDateKey() ? "today" : "planned";

  return {
    id: `manual-${dateKey}-${slugify(payload.patientName)}-${Date.now()}`,
    patientName: payload.patientName,
    source: payload.source || "recznie",
    serviceName: payload.serviceName || "konsultacja psychoterapeutyczna",
    workflowStage: stage,
    dayBucket: stage === "today" ? "today" : "archive",
    dateLabel: payload.dateLabel,
    time: payload.time || "brak godziny",
    status: "open",
    notes: "",
    summary: "",
    closureChecklist: buildInitialChecklist(),
    nextVisit: {
      status: "to_schedule",
      label: "nowa wizyta",
      plannedLabel: "Do ustalenia po sesji",
      note: "Wizyta dodana recznie do DocDash."
    },
    followUp: {
      paymentReminderSent: false,
      documentReady: false,
      zlSynced: payload.source === "ZL",
      lastActionLabel: "Dodano recznie do workflow"
    },
    payment: {
      amount: Number(payload.amount || 0),
      status: payload.paymentStatus || "pending",
      statusLabel: payload.paymentStatus === "paid" ? "oplacone" : "platnosc oczekuje",
      method: payload.paymentMethod || "transfer",
      documentType: payload.documentType || "none",
      documentIssued: false,
      followUpLabel: "do rozliczenia po sesji"
    }
  };
}

function updateVisit(currentVisit, patch) {
  return {
    ...currentVisit,
    ...patch,
    nextVisit: patch.nextVisit ? { ...currentVisit.nextVisit, ...patch.nextVisit } : currentVisit.nextVisit,
    payment: patch.payment ? { ...currentVisit.payment, ...patch.payment } : currentVisit.payment,
    followUp: patch.followUp ? { ...currentVisit.followUp, ...patch.followUp } : currentVisit.followUp,
    closureChecklist: patch.closureChecklist || currentVisit.closureChecklist
  };
}

function buildImportedVisit(importRow) {
  const stage = normalizeDateLabel(importRow.dateLabel) === getCurrentDateKey() ? "today" : "planned";

  return {
    id: `workflow-${importRow.id}`,
    patientName: importRow.patientName,
    source: "ZL import",
    serviceName: importRow.serviceName || "konsultacja",
    workflowStage: stage,
    dayBucket: stage === "today" ? "today" : "archive",
    dateLabel: importRow.dateLabel,
    time: importRow.time || "brak godziny",
    status: "open",
    notes: "",
    summary: "",
    closureChecklist: [
      { label: "Wizyta przeniesiona z importu ZL", done: true },
      { label: "Brak notatek i podsumowania", done: false },
      { label: "Brak rozliczenia po imporcie", done: false }
    ],
    nextVisit: {
      status: "to_schedule",
      label: "import z ZL",
      plannedLabel: "Do ustalenia po weryfikacji terminu",
      note: "Rekord przeniesiony z raportu ZL do workflow DocDash."
    },
    followUp: {
      paymentReminderSent: false,
      documentReady: false,
      zlSynced: true,
      lastActionLabel: "Przeniesiono z importu do workflow"
    },
    payment: {
      amount: Number(importRow.amount || 0),
      status: "pending",
      statusLabel: "platnosc oczekuje",
      method: "transfer",
      documentType: "none",
      documentIssued: false,
      followUpLabel: "zaimportowano z raportu ZL"
    }
  };
}

function collectRequestBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let receivedBytes = 0;

    req.on("data", (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }

      body += chunk.toString();
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function validateStorePayload(payload) {
  return Boolean(
    payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      payload.meta &&
      typeof payload.meta === "object" &&
      Array.isArray(payload.visits) &&
      Array.isArray(payload.imports)
  );
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  if (pathname === "/health" && req.method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (pathname === "/api/session" && req.method === "GET") {
    if (!AUTH_REQUIRED) {
      sendJson(res, 200, { authenticated: true, authRequired: false });
      return;
    }

    if (!AUTH_ENABLED) {
      sendAuthConfigError(res);
      return;
    }

    const session = getSession(req);
    sendJson(res, 200, { authenticated: Boolean(session), username: session?.sub || null, authRequired: true });
    return;
  }

  if (pathname === "/api/login" && req.method === "POST") {
    if (!AUTH_ENABLED) {
      sendAuthConfigError(res);
      return;
    }

    try {
      const payload = await collectRequestBody(req);
      const username = String(payload.username || "");
      const password = String(payload.password || "");

      if (!safeEqual(username, AUTH_USER) || !safeEqual(password, AUTH_PASSWORD)) {
        sendJson(res, 401, { error: "Invalid credentials" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": buildSessionCookie(req, createSessionToken(username))
      });
      res.end(JSON.stringify({ authenticated: true, username }));
    } catch (error) {
      sendJson(res, 400, { error: "Invalid login payload" });
    }

    return;
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": buildClearSessionCookie(req)
    });
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }

  if (!requireSession(req, res, pathname)) {
    return;
  }

  if (pathname === "/api/bootstrap" && req.method === "GET") {
    sendJson(res, 200, readData());
    return;
  }

  if (pathname === "/api/data/export" && req.method === "GET") {
    const data = readData();
    const filename = `docdash-store-${new Date().toISOString().slice(0, 10)}.json`;

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    });
    res.end(JSON.stringify(data, null, 2));
    return;
  }

  if (pathname === "/api/data/import" && req.method === "POST") {
    try {
      const payload = await collectRequestBody(req, 10 * 1024 * 1024);

      if (!validateStorePayload(payload)) {
        sendJson(res, 400, { error: "Invalid DocDash store payload" });
        return;
      }

      payload.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      writeData(payload);
      sendJson(res, 200, {
        ok: true,
        visits: payload.visits.length,
        imports: payload.imports.length,
        lastUpdated: payload.meta.lastUpdated
      });
    } catch (error) {
      sendJson(res, 400, { error: "Unable to import DocDash store" });
    }

    return;
  }

  if (pathname === "/api/visits" && req.method === "POST") {
    try {
      const payload = await collectRequestBody(req);

      if (!payload.patientName || !payload.dateLabel) {
        sendJson(res, 400, { error: "Missing patientName or dateLabel" });
        return;
      }

      const data = readData();
      const visit = buildManualVisit(payload);
      data.visits.push(visit);
      data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      writeData(data);
      sendJson(res, 201, visit);
    } catch (error) {
      sendJson(res, 400, { error: "Invalid visit payload" });
    }

    return;
  }

  if (pathname.startsWith("/api/visits/") && req.method === "PUT") {
    try {
      const visitId = pathname.split("/").pop();
      const patch = await collectRequestBody(req);
      const data = readData();
      const visitIndex = data.visits.findIndex((visit) => visit.id === visitId);

      if (visitIndex === -1) {
        sendJson(res, 404, { error: "Visit not found" });
        return;
      }

      const updatedVisit = updateVisit(data.visits[visitIndex], patch);
      data.visits[visitIndex] = updatedVisit;
      data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      writeData(data);
      sendJson(res, 200, updatedVisit);
    } catch (error) {
      sendJson(res, 400, { error: "Invalid request payload" });
    }

    return;
  }

  if (pathname.startsWith("/api/imports/") && pathname.endsWith("/promote") && req.method === "POST") {
    try {
      const segments = pathname.split("/").filter(Boolean);
      const importId = segments[2];
      const rowId = segments[4];
      const data = readData();
      const importBatch = (data.imports || []).find((item) => item.id === importId);

      if (!importBatch) {
        sendJson(res, 404, { error: "Import not found" });
        return;
      }

      const row = (importBatch.rows || []).find((item) => item.id === rowId);
      if (!row) {
        sendJson(res, 404, { error: "Import row not found" });
        return;
      }

      const existingVisitId = row.linkedVisitId || `workflow-${row.id}`;
      const existingVisit = data.visits.find((visit) => visit.id === existingVisitId);

      if (!row.processed && !existingVisit) {
        const visit = buildImportedVisit(row);
        data.visits.push(visit);
        row.processed = true;
        row.linkedVisitId = visit.id;
        row.processedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
      } else if (existingVisit) {
        row.processed = true;
        row.linkedVisitId = existingVisit.id;
        row.processedAt = row.processedAt || new Date().toISOString().slice(0, 16).replace("T", " ");
      }

      data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      writeData(data);
      sendJson(res, 200, row);
    } catch (error) {
      sendJson(res, 400, { error: "Unable to promote import row" });
    }

    return;
  }

  const urlPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    sendFile(filePath, res);
  });
});

server.listen(PORT, () => {
  console.log(`DocDash running on http://localhost:${PORT}`);
});
