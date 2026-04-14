const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { TextDecoder } = require("util");
const XLSX = require("xlsx");

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
    .replace(/\u0142/g, "l")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function normalizeSearchValue(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0142/g, "l")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  }

  const text = String(value || "").trim();
  const numeric = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (numeric) {
    return new Date(Date.UTC(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1])));
  }

  return null;
}

function formatDateLabel(value) {
  const date = parseDateValue(value);
  if (!date) {
    return normalizeDateLabel(value);
  }

  const day = date.getUTCDate();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

function dateSortValue(label) {
  const date = parseDateValue(label);
  if (!date) {
    return 0;
  }

  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

function dateDistanceDays(left, right) {
  const leftDate = parseDateValue(left);
  const rightDate = parseDateValue(right);
  if (!leftDate || !rightDate) {
    return 999;
  }

  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function formatTimeLabel(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }

  if (typeof value === "number") {
    const totalMinutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }

  const text = String(value || "").trim();
  const time = text.match(/^(\d{1,2}):(\d{2})/);
  if (time) {
    return `${String(Number(time[1])).padStart(2, "0")}:${time[2]}`;
  }

  return text;
}

function parseAmount(value) {
  if (typeof value === "number") {
    return Number(value.toFixed(2));
  }

  const normalized = String(value || "")
    .replace(/\s/g, "")
    .replace(/\u00a0/g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");

  const amount = Number(normalized);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
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

function getHeaderIndex(headers, names, fallback = -1) {
  const normalizedNames = names.map(normalizeSearchValue);

  for (let index = 0; index < headers.length; index += 1) {
    if (normalizedNames.includes(normalizeSearchValue(headers[index]))) {
      return index;
    }
  }

  return fallback;
}

function valueAt(values, index) {
  if (index < 0 || index >= values.length) {
    return "";
  }

  return values[index];
}

function parseZlWorkbook(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = values.findIndex((row) => row.some((cell) => normalizeSearchValue(cell) === "data"));

  if (headerIndex === -1) {
    throw new Error("Missing ZnanyLekarz header row");
  }

  const headers = values[headerIndex];
  const dateIndex = getHeaderIndex(headers, ["Data"], 0);
  const timeIndex = getHeaderIndex(headers, ["Godzina", "Czas"], -1);
  const patientIndex = getHeaderIndex(headers, ["Pacjent"], timeIndex >= 0 ? 2 : 1);
  const serviceIndex = getHeaderIndex(headers, ["Usługi", "Uslugi", "Usługa", "Usluga"], timeIndex >= 0 ? 3 : 2);
  const amountIndex = getHeaderIndex(headers, ["Wartość", "Wartosc", "Kwota"], timeIndex >= 0 ? 4 : 3);
  const paymentIndex = getHeaderIndex(headers, ["Status płatności", "Status platnosci"], timeIndex >= 0 ? 5 : 4);
  const sourceIndex = getHeaderIndex(headers, ["Źródło", "Zrodlo"], timeIndex >= 0 ? 6 : 5);
  const statusIndex = getHeaderIndex(headers, ["Status"], timeIndex >= 0 ? 7 : 6);
  const rows = [];

  values.slice(headerIndex + 1).forEach((row) => {
    const dateLabel = formatDateLabel(valueAt(row, dateIndex));
    const time = formatTimeLabel(valueAt(row, timeIndex));
    const patientName = String(valueAt(row, patientIndex) || "").trim();

    if (!dateLabel || !patientName) {
      return;
    }

    const legacyId = `zl-${slugify(`${dateLabel}-${patientName}`)}`;
    const rowId = time ? `zl-${slugify(`${dateLabel}-${time}-${patientName}`)}` : legacyId;

    rows.push({
      id: rowId,
      legacyId,
      time,
      dateLabel,
      patientName,
      serviceName: String(valueAt(row, serviceIndex) || "").trim(),
      amount: parseAmount(valueAt(row, amountIndex)),
      paymentStatus: String(valueAt(row, paymentIndex) || "").trim(),
      source: String(valueAt(row, sourceIndex) || "").trim(),
      bookingStatus: String(valueAt(row, statusIndex) || "").trim(),
      importedAt: new Date().toISOString().slice(0, 16).replace("T", " ")
    });
  });

  const sortedDates = rows.map((row) => dateSortValue(row.dateLabel)).filter(Boolean).sort((left, right) => left - right);
  const firstDate = sortedDates[0] || dateSortValue(getCurrentDateKey());
  const lastDate = sortedDates[sortedDates.length - 1] || firstDate;
  const batchId = `zl-${firstDate}-${lastDate}`;

  return {
    id: batchId,
    label: `ZnanyLekarz ${formatDateLabelFromSort(firstDate)} - ${formatDateLabelFromSort(lastDate)}`,
    sourceFile: fileName,
    importedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    rowCount: rows.length,
    rows
  };
}

function formatDateLabelFromSort(value) {
  const text = String(value || "");
  if (text.length !== 8) {
    return "";
  }

  return `${Number(text.slice(6, 8))}.${text.slice(4, 6)}.${text.slice(0, 4)}`;
}

function parseDelimitedLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ";" && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function cleanCsvValue(value) {
  return String(value || "").replace(/^'+|'+$/g, "").trim();
}

function decodeCsvBuffer(buffer) {
  const utf8 = buffer.toString("utf8");
  if (!utf8.includes("\ufffd")) {
    return utf8;
  }

  return new TextDecoder("windows-1250").decode(buffer);
}

function parseBankCsv(buffer, fileName) {
  const text = decodeCsvBuffer(buffer).replace(/^\ufeff/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => line.startsWith("Data transakcji;"));

  if (headerIndex === -1) {
    throw new Error("Missing bank CSV header row");
  }

  const headers = parseDelimitedLine(lines[headerIndex]);
  const transactionDateIndex = getHeaderIndex(headers, ["Data transakcji"], 0);
  const bookingDateIndex = getHeaderIndex(headers, ["Data księgowania", "Data ksiegowania"], 1);
  const counterpartyIndex = getHeaderIndex(headers, ["Dane kontrahenta"], 2);
  const titleIndex = getHeaderIndex(headers, ["Tytuł", "Tytul"], 3);
  const accountIndex = getHeaderIndex(headers, ["Nr rachunku"], 4);
  const bankIndex = getHeaderIndex(headers, ["Nazwa banku"], 5);
  const detailsIndex = getHeaderIndex(headers, ["Szczegóły", "Szczegoly"], 6);
  const transactionNoIndex = getHeaderIndex(headers, ["Nr transakcji"], 7);
  const amountIndex = getHeaderIndex(headers, ["Kwota transakcji (waluta rachunku)", "Kwota transakcji"], 8);
  const currencyIndex = getHeaderIndex(headers, ["Waluta"], 9);
  const transactions = [];

  lines.slice(headerIndex + 1).forEach((line, rawIndex) => {
    const row = parseDelimitedLine(line);
    const amount = parseAmount(valueAt(row, amountIndex));

    if (!amount || amount <= 0) {
      return;
    }

    const transactionNo = cleanCsvValue(valueAt(row, transactionNoIndex));
    const transactionDate = formatDateLabel(cleanCsvValue(valueAt(row, transactionDateIndex)));
    const counterparty = cleanCsvValue(valueAt(row, counterpartyIndex));
    const title = cleanCsvValue(valueAt(row, titleIndex));
    const id = `bank-${slugify(transactionNo || `${transactionDate}-${counterparty}-${title}-${amount}`)}`;

    transactions.push({
      id,
      transactionNo,
      transactionDate,
      bookingDate: formatDateLabel(cleanCsvValue(valueAt(row, bookingDateIndex))),
      counterparty,
      title,
      account: cleanCsvValue(valueAt(row, accountIndex)),
      bankName: cleanCsvValue(valueAt(row, bankIndex)),
      details: cleanCsvValue(valueAt(row, detailsIndex)),
      amount,
      currency: cleanCsvValue(valueAt(row, currencyIndex)) || "PLN",
      sourceFile: fileName,
      rawIndex: rawIndex + 1
    });
  });

  const sortedDates = transactions
    .map((transaction) => dateSortValue(transaction.transactionDate))
    .filter(Boolean)
    .sort((left, right) => left - right);
  const firstDate = sortedDates[0] || dateSortValue(getCurrentDateKey());
  const lastDate = sortedDates[sortedDates.length - 1] || firstDate;

  return {
    id: `bank-${firstDate}-${lastDate}-${slugify(fileName)}`,
    label: `Wpływy bankowe ${formatDateLabelFromSort(firstDate)} - ${formatDateLabelFromSort(lastDate)}`,
    sourceFile: fileName,
    importedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    rowCount: transactions.length,
    transactions
  };
}

function mergeZlBatch(store, batch) {
  store.imports = store.imports || [];
  const existingRows = new Map();

  store.imports.forEach((existingBatch) => {
    (existingBatch.rows || []).forEach((row) => {
      existingRows.set(row.id, row);
      if (row.legacyId) {
        existingRows.set(row.legacyId, row);
      }
    });
  });

  batch.rows = batch.rows.map((row) => {
    const existing = existingRows.get(row.id) || existingRows.get(row.legacyId);
    if (!existing) {
      return row;
    }

    return {
      ...row,
      processed: existing.processed || row.processed,
      linkedVisitId: existing.linkedVisitId || row.linkedVisitId,
      processedAt: existing.processedAt || row.processedAt,
      paymentConfirmed: existing.paymentConfirmed || row.paymentConfirmed,
      bankTransactionId: existing.bankTransactionId || row.bankTransactionId,
      bankPaidAt: existing.bankPaidAt || row.bankPaidAt,
      paymentMatchId: existing.paymentMatchId || row.paymentMatchId
    };
  });

  store.imports = [batch, ...store.imports.filter((existingBatch) => existingBatch.id !== batch.id)];
  return batch;
}

function mergeBankBatch(store, batch) {
  store.bankImports = store.bankImports || [];
  const existingTransactions = new Map();

  store.bankImports.forEach((existingBatch) => {
    (existingBatch.transactions || []).forEach((transaction) => {
      existingTransactions.set(transaction.id, transaction);
    });
  });

  batch.transactions = batch.transactions.map((transaction) => {
    const existing = existingTransactions.get(transaction.id);
    if (!existing) {
      return transaction;
    }

    return {
      ...transaction,
      matchedTargets: existing.matchedTargets || transaction.matchedTargets,
      matchedAt: existing.matchedAt || transaction.matchedAt
    };
  });

  store.bankImports = [batch, ...store.bankImports.filter((existingBatch) => existingBatch.id !== batch.id)];
  return batch;
}

function isPaidImportRow(row) {
  return Boolean(row.paymentConfirmed || row.bankTransactionId);
}

function isPaidVisit(visit) {
  return visit.payment?.status === "paid";
}

function collectSessions(store) {
  const sessions = [];
  const seenSessionKeys = new Set();
  const linkedVisitIds = new Set();

  (store.imports || []).forEach((batch) => {
    (batch.rows || []).forEach((row) => {
      const sessionKey = `${normalizeSearchValue(row.patientName)}|${normalizeDateLabel(row.dateLabel)}|${row.time || ""}|${Number(row.amount || 0)}`;
      if (seenSessionKeys.has(sessionKey)) {
        return;
      }

      seenSessionKeys.add(sessionKey);
      if (row.linkedVisitId) {
        linkedVisitIds.add(row.linkedVisitId);
      }

      sessions.push({
        id: `import:${batch.id}:${row.id}`,
        type: "importRow",
        importId: batch.id,
        rowId: row.id,
        linkedVisitId: row.linkedVisitId,
        patientName: row.patientName,
        dateLabel: row.dateLabel,
        time: row.time || "",
        amount: Number(row.amount || 0),
        paid: isPaidImportRow(row),
        bankTransactionId: row.bankTransactionId || null
      });
    });
  });

  (store.visits || []).forEach((visit) => {
    if (linkedVisitIds.has(visit.id)) {
      return;
    }

    sessions.push({
      id: `visit:${visit.id}`,
      type: "visit",
      visitId: visit.id,
      patientName: visit.patientName,
      dateLabel: visit.dateLabel,
      time: visit.time || "",
      amount: Number(visit.payment?.amount || 0),
      paid: isPaidVisit(visit),
      bankTransactionId: visit.payment?.bankTransactionId || null
    });
  });

  return sessions
    .filter((session) => session.amount > 0)
    .sort((left, right) => dateSortValue(left.dateLabel) - dateSortValue(right.dateLabel));
}

function collectTransactions(store) {
  const byId = new Map();

  (store.bankImports || []).forEach((batch) => {
    (batch.transactions || []).forEach((transaction) => {
      if (!byId.has(transaction.id)) {
        byId.set(transaction.id, transaction);
      }
    });
  });

  return Array.from(byId.values()).sort(
    (left, right) => dateSortValue(left.transactionDate) - dateSortValue(right.transactionDate)
  );
}

const PAYMENT_ALIAS_STOPWORDS = new Set([
  "ul",
  "ulica",
  "al",
  "aleja",
  "os",
  "m",
  "lok",
  "lokal",
  "przelew",
  "srodkow",
  "srodek",
  "sesja",
  "sesje",
  "wizyta",
  "za",
  "od",
  "do",
  "warszawa"
]);

function searchTokens(text, minLength = 3) {
  return normalizeSearchValue(text)
    .split(" ")
    .filter((token) => token.length >= minLength);
}

function transactionTokenSet(transaction) {
  return new Set(searchTokens(`${transaction.counterparty} ${transaction.title}`, 1));
}

function payerAliasTokens(text) {
  return searchTokens(text)
    .filter((token) => !PAYMENT_ALIAS_STOPWORDS.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, 3);
}

function aliasMatchesTransaction(alias, transactionTokens) {
  const aliasTokens = Array.isArray(alias.payerTokens) && alias.payerTokens.length
    ? alias.payerTokens
    : payerAliasTokens(alias.payerName || alias.payerKey);
  const matchedTokens = aliasTokens.filter((token) => transactionTokens.has(token));

  if (aliasTokens.length >= 2) {
    return matchedTokens.length >= 2;
  }

  return aliasTokens.length === 1 && matchedTokens.length === 1;
}

function patientIdentityScore(patientName, transaction, aliases = []) {
  const patientTokens = searchTokens(patientName);
  const transactionTokens = transactionTokenSet(transaction);
  const matchedTokens = patientTokens.filter((token) => transactionTokens.has(token));
  let score = 0;
  const reasons = [];

  if (patientTokens.length && matchedTokens.length === patientTokens.length) {
    score = 45;
    reasons.push("platnik pasuje do pacjenta");
  } else if (matchedTokens.length >= 2) {
    score = 35;
    reasons.push("znaleziono imie i nazwisko pacjenta");
  } else if (matchedTokens.length === 1) {
    score = 24;
    reasons.push("znaleziono fragment danych pacjenta");
  }

  const patientKey = normalizeSearchValue(patientName);
  const alias = (aliases || []).find((item) => (
    item.patientKey === patientKey && aliasMatchesTransaction(item, transactionTokens)
  ));

  if (alias && score < 48) {
    score = 48;
    reasons.unshift(`slownik platnika: ${alias.payerName}`);
  }

  return { score, reasons };
}

function patientTokenScore(patientName, transaction, aliases = []) {
  return patientIdentityScore(patientName, transaction, aliases).score;
}

function titleDateHints(transaction) {
  const text = String(transaction?.title || "");
  const transactionDate = parseDateValue(transaction?.transactionDate);
  const fallbackYear = transactionDate ? transactionDate.getUTCFullYear() : new Date().getFullYear();
  const hints = new Set();
  const pattern = /(^|[^0-9])(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?=$|[^0-9])/g;
  let match = pattern.exec(text);

  while (match) {
    const day = Number(match[2]);
    const month = Number(match[3]);
    const rawYear = match[4];
    const year = rawYear ? (rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)) : fallbackYear;

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      hints.add(year * 10000 + month * 100 + day);
    }

    match = pattern.exec(text);
  }

  return Array.from(hints);
}

function uniqueReasons(reasons) {
  return Array.from(new Set(reasons.filter(Boolean)));
}

function scoreTransactionForSession(transaction, session, aliases = []) {
  let score = 0;
  const reasons = [];

  if (Math.abs(Number(transaction.amount) - Number(session.amount)) < 0.01) {
    score += 30;
    reasons.push("kwota zgodna");
  }

  const identity = patientIdentityScore(session.patientName, transaction, aliases);
  score += identity.score;
  reasons.push(...identity.reasons);

  const hints = titleDateHints(transaction);
  const sessionDateKey = dateSortValue(session.dateLabel);
  if (hints.length && sessionDateKey) {
    if (hints.includes(sessionDateKey)) {
      score += 28;
      reasons.push("tytul wskazuje date sesji");
    } else {
      score -= 30;
      reasons.push("tytul wskazuje inna date");
    }
  }

  const distance = dateDistanceDays(session.dateLabel, transaction.transactionDate);
  if (distance === 0) {
    score += 25;
    reasons.push("wplata w dniu sesji");
  } else if (distance > 0 && distance <= 3) {
    score += 20;
    reasons.push(`wplata ${distance} dni po sesji`);
  } else if (distance > 0 && distance <= 10) {
    score += 12;
    reasons.push(`wplata ${distance} dni po sesji`);
  } else if (distance > 0 && distance <= 31) {
    score += 6;
    reasons.push(`wplata ${distance} dni po sesji`);
  } else if (distance < 0 && distance >= -2) {
    score += 4;
    reasons.push(`wplata ${Math.abs(distance)} dni przed sesja`);
  } else {
    score -= 35;
    reasons.push("data wplaty daleko od sesji");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: uniqueReasons(reasons)
  };
}

function confidenceForScore(score) {
  if (score >= 82) {
    return "pewne";
  }

  if (score >= 60) {
    return "do sprawdzenia";
  }

  return "niskie";
}

function buildMatch(transaction, sessions, score, kind = "single", reasons = []) {
  const totalAmount = sessions.reduce((sum, session) => sum + Number(session.amount || 0), 0);
  const targetSlug = sessions.map((session) => slugify(session.id)).join("-");

  return {
    id: `match-${transaction.id}-${targetSlug}`,
    kind,
    status: "suggested",
    confidence: confidenceForScore(score),
    score,
    reasons: uniqueReasons(reasons),
    transaction: {
      id: transaction.id,
      transactionNo: transaction.transactionNo,
      transactionDate: transaction.transactionDate,
      counterparty: transaction.counterparty,
      title: transaction.title,
      amount: transaction.amount,
      currency: transaction.currency
    },
    targets: sessions.map((session) => ({
      id: session.id,
      type: session.type,
      visitId: session.visitId,
      importId: session.importId,
      rowId: session.rowId,
      linkedVisitId: session.linkedVisitId,
      patientName: session.patientName,
      dateLabel: session.dateLabel,
      time: session.time,
      amount: session.amount
    })),
    delta: Number((Number(transaction.amount) - totalAmount).toFixed(2))
  };
}

function alternativePaymentCandidates(session, transactions, usedTransactionIds, aliases = []) {
  const sessionDateKey = dateSortValue(session.dateLabel);

  return transactions
    .filter((transaction) => !usedTransactionIds.has(transaction.id))
    .filter((transaction) => Math.abs(Number(transaction.amount) - Number(session.amount)) < 0.01)
    .map((transaction) => {
      const details = scoreTransactionForSession(transaction, session, aliases);
      const distance = dateDistanceDays(session.dateLabel, transaction.transactionDate);
      const hints = titleDateHints(transaction);
      const titleDateMatch = sessionDateKey && hints.includes(sessionDateKey);
      const nearby = distance >= -3 && distance <= 7;

      if (!titleDateMatch && !nearby) {
        return null;
      }

      return {
        transaction,
        score: details.score + (titleDateMatch ? 20 : 0) + (Math.abs(distance) <= 3 ? 10 : 0),
        distance: Math.abs(distance),
        reasons: uniqueReasons([
          "kandydat do recznej oceny",
          ...details.reasons
        ])
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.distance - right.distance;
    })
    .slice(0, 3)
    .map((candidate) => ({
      id: candidate.transaction.id,
      transactionNo: candidate.transaction.transactionNo,
      transactionDate: candidate.transaction.transactionDate,
      counterparty: candidate.transaction.counterparty,
      title: candidate.transaction.title,
      amount: candidate.transaction.amount,
      currency: candidate.transaction.currency,
      score: Math.max(0, Math.min(100, candidate.score)),
      reasons: candidate.reasons
    }));
}

function generatePaymentMatches(store) {
  const sessions = collectSessions(store);
  const transactions = collectTransactions(store);
  const aliases = Array.isArray(store.paymentAliases) ? store.paymentAliases : [];
  const confirmedMatches = (store.paymentMatches?.matches || []).filter((match) => match.status === "confirmed");
  const confirmedSessionIds = new Set(confirmedMatches.flatMap((match) => (match.targets || []).map((target) => target.id)));
  const confirmedTransactionIds = new Set(confirmedMatches.map((match) => match.transaction?.id).filter(Boolean));
  const availableSessions = sessions.filter((session) => !session.paid && !confirmedSessionIds.has(session.id));
  const matches = [...confirmedMatches];
  const usedSessionIds = new Set(confirmedSessionIds);
  const usedTransactionIds = new Set(confirmedTransactionIds);

  const singleCandidates = [];
  transactions.forEach((transaction) => {
    if (usedTransactionIds.has(transaction.id)) {
      return;
    }

    availableSessions
      .filter((session) => !usedSessionIds.has(session.id))
      .filter((session) => Math.abs(Number(transaction.amount) - Number(session.amount)) < 0.01)
      .filter((session) => patientTokenScore(session.patientName, transaction, aliases) >= 24)
      .forEach((session) => {
        const details = scoreTransactionForSession(transaction, session, aliases);
        if (details.score >= 52) {
          singleCandidates.push({
            transaction,
            session,
            score: details.score,
            reasons: details.reasons,
            distance: Math.abs(dateDistanceDays(session.dateLabel, transaction.transactionDate))
          });
        }
      });
  });

  singleCandidates
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.distance - right.distance;
    })
    .forEach((candidate) => {
      if (usedTransactionIds.has(candidate.transaction.id) || usedSessionIds.has(candidate.session.id)) {
        return;
      }

      matches.push(buildMatch(candidate.transaction, [candidate.session], candidate.score, "single", candidate.reasons));
      usedTransactionIds.add(candidate.transaction.id);
      usedSessionIds.add(candidate.session.id);
    });

  transactions.forEach((transaction) => {
    if (usedTransactionIds.has(transaction.id)) {
      return;
    }

    const patientGroups = new Map();
    availableSessions
      .filter((session) => !usedSessionIds.has(session.id))
      .filter((session) => patientTokenScore(session.patientName, transaction, aliases) >= 24)
      .filter((session) => dateDistanceDays(session.dateLabel, transaction.transactionDate) >= 0)
      .filter((session) => dateDistanceDays(session.dateLabel, transaction.transactionDate) <= 45)
      .forEach((session) => {
        const key = normalizeSearchValue(session.patientName);
        if (!patientGroups.has(key)) {
          patientGroups.set(key, []);
        }

        patientGroups.get(key).push(session);
      });

    for (const group of patientGroups.values()) {
      const sortedGroup = group.sort((left, right) => dateSortValue(left.dateLabel) - dateSortValue(right.dateLabel));
      const targetSessions = [];
      let sum = 0;

      for (let index = sortedGroup.length - 1; index >= 0; index -= 1) {
        targetSessions.unshift(sortedGroup[index]);
        sum = Number((sum + Number(sortedGroup[index].amount || 0)).toFixed(2));

        if (Math.abs(sum - Number(transaction.amount)) < 0.01 && targetSessions.length > 1) {
          const identity = patientIdentityScore(targetSessions[0].patientName, transaction, aliases);
          const score = Math.min(96, 48 + identity.score + 8);
          matches.push(buildMatch(transaction, targetSessions, score, "group", [
            "platnosc zbiorcza",
            "kwota zgodna z suma sesji",
            ...identity.reasons
          ]));
          usedTransactionIds.add(transaction.id);
          targetSessions.forEach((session) => usedSessionIds.add(session.id));
          return;
        }

        if (sum > Number(transaction.amount)) {
          break;
        }
      }
    }
  });

  availableSessions
    .filter((session) => !usedSessionIds.has(session.id))
    .forEach((session) => {
      matches.push({
        id: `missing-${slugify(session.id)}`,
        kind: "missing",
        status: "missing",
        confidence: "brak płatności",
        score: 0,
        reasons: ["brak pasujacego wplywu"],
        transaction: null,
        targets: [
          {
            id: session.id,
            type: session.type,
            visitId: session.visitId,
            importId: session.importId,
            rowId: session.rowId,
            linkedVisitId: session.linkedVisitId,
            patientName: session.patientName,
            dateLabel: session.dateLabel,
            time: session.time,
            amount: session.amount
          }
        ],
        alternatives: alternativePaymentCandidates(session, transactions, usedTransactionIds, aliases),
        delta: Number(session.amount || 0)
      });
    });

  const suggestedMatches = matches.filter((match) => match.status === "suggested");
  const summary = {
    sessions: sessions.length,
    transactions: transactions.length,
    suggested: suggestedMatches.length,
    confident: suggestedMatches.filter((match) => match.confidence === "pewne").length,
    review: suggestedMatches.filter((match) => match.confidence !== "pewne").length,
    missing: matches.filter((match) => match.status === "missing").length,
    confirmed: matches.filter((match) => match.status === "confirmed").length
  };

  store.paymentMatches = {
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    summary,
    matches
  };

  return store.paymentMatches;
}

function applyPaymentToTarget(store, target, transaction, matchId) {
  const paidAt = transaction.transactionDate || new Date().toISOString().slice(0, 10);

  if (target.type === "importRow") {
    const batch = (store.imports || []).find((item) => item.id === target.importId);
    const row = batch?.rows?.find((item) => item.id === target.rowId);
    if (row) {
      row.paymentConfirmed = true;
      row.paymentStatus = "Zapłacono";
      row.bankTransactionId = transaction.id;
      row.bankPaidAt = paidAt;
      row.paymentMatchId = matchId;
    }

    if (target.linkedVisitId) {
      const visit = (store.visits || []).find((item) => item.id === target.linkedVisitId);
      if (visit) {
        visit.payment = {
          ...visit.payment,
          status: "paid",
          statusLabel: "oplacone",
          bankTransactionId: transaction.id,
          paidAt,
          paymentMatchId: matchId
        };
      }
    }

    return;
  }

  const visit = (store.visits || []).find((item) => item.id === target.visitId);
  if (visit) {
    visit.payment = {
      ...visit.payment,
      status: "paid",
      statusLabel: "oplacone",
      bankTransactionId: transaction.id,
      paidAt,
      paymentMatchId: matchId
    };
  }
}

function addPayerAliasesFromMatch(store, match) {
  if (!match?.transaction?.counterparty) {
    return 0;
  }

  if (!Array.isArray(store.paymentAliases)) {
    store.paymentAliases = [];
  }

  const payerName = String(match.transaction.counterparty || "").trim();
  const payerKey = normalizeSearchValue(payerName);
  const payerTokens = payerAliasTokens(payerName);
  const createdAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  let added = 0;

  if (!payerKey || !payerTokens.length) {
    return 0;
  }

  (match.targets || []).forEach((target) => {
    const patientName = String(target.patientName || "").trim();
    const patientKey = normalizeSearchValue(patientName);
    const directScore = patientIdentityScore(patientName, { ...match.transaction, title: "" }, []).score;

    if (!patientKey || directScore >= 35) {
      return;
    }

    const payerTokenKey = payerTokens.join(" ");
    const exists = store.paymentAliases.some((alias) => (
      alias.patientKey === patientKey &&
      (
        alias.payerKey === payerKey ||
        (Array.isArray(alias.payerTokens) && alias.payerTokens.join(" ") === payerTokenKey)
      )
    ));

    if (exists) {
      return;
    }

    store.paymentAliases.push({
      id: `alias-${slugify(`${patientKey}-${payerTokenKey}`)}-${Date.now()}-${added}`,
      patientName,
      patientKey,
      payerName,
      payerKey,
      payerTokens,
      sourceMatchId: match.id,
      createdAt
    });
    added += 1;
  });

  return added;
}

function confirmManualPaymentMatch(store, targetId, transactionId, rememberPayer = true) {
  const session = collectSessions(store).find((item) => item.id === targetId);
  const transaction = collectTransactions(store).find((item) => item.id === transactionId);

  if (!session || !transaction) {
    return null;
  }

  const details = scoreTransactionForSession(
    transaction,
    session,
    Array.isArray(store.paymentAliases) ? store.paymentAliases : []
  );
  const match = buildMatch(transaction, [session], Math.max(70, details.score), "manual", [
    "recznie wybrany wplyw",
    ...details.reasons
  ]);
  const aliasesAdded = rememberPayer ? addPayerAliasesFromMatch(store, match) : 0;

  if (!store.paymentMatches) {
    store.paymentMatches = { generatedAt: null, summary: {}, matches: [] };
  }

  store.paymentMatches.matches = (store.paymentMatches.matches || [])
    .filter((item) => item.id !== match.id && item.status === "confirmed");

  confirmPaymentMatchInStore(store, match);
  store.paymentMatches.matches.push(match);

  return { match, aliasesAdded };
}

function confirmPaymentMatchInStore(store, match) {
  if (!match || !match.transaction || match.status === "missing" || match.status === "confirmed") {
    return false;
  }

  (match.targets || []).forEach((target) => applyPaymentToTarget(store, target, match.transaction, match.id));

  (store.bankImports || []).forEach((batch) => {
    (batch.transactions || []).forEach((transaction) => {
      if (transaction.id === match.transaction.id) {
        transaction.matchedTargets = match.targets.map((target) => target.id);
        transaction.matchedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
      }
    });
  });

  match.status = "confirmed";
  match.confirmedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  return true;
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

  if (pathname === "/api/reconciliation" && req.method === "GET") {
    const data = readData();
    if (!data.paymentMatches) {
      generatePaymentMatches(data);
      writeData(data);
    }

    sendJson(res, 200, {
      paymentMatches: data.paymentMatches,
      bankImports: data.bankImports || []
    });
    return;
  }

  if (pathname === "/api/reconciliation/import" && req.method === "POST") {
    try {
      const payload = await collectRequestBody(req, 30 * 1024 * 1024);
      const data = readData();
      const result = {
        zl: null,
        bank: null,
        paymentMatches: null
      };

      if (payload.zlBase64) {
        const zlBuffer = Buffer.from(payload.zlBase64, "base64");
        const zlBatch = mergeZlBatch(data, parseZlWorkbook(zlBuffer, payload.zlFileName || "znanylekarz.xlsx"));
        result.zl = {
          id: zlBatch.id,
          label: zlBatch.label,
          rows: zlBatch.rows.length
        };
      }

      if (payload.bankBase64) {
        const bankBuffer = Buffer.from(payload.bankBase64, "base64");
        const bankBatch = mergeBankBatch(data, parseBankCsv(bankBuffer, payload.bankFileName || "bank.csv"));
        result.bank = {
          id: bankBatch.id,
          label: bankBatch.label,
          transactions: bankBatch.transactions.length
        };
      }

      result.paymentMatches = generatePaymentMatches(data);
      data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      writeData(data);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: "Unable to import reconciliation files" });
    }

    return;
  }

  if (pathname.startsWith("/api/reconciliation/matches/") && pathname.endsWith("/confirm") && req.method === "POST") {
    try {
      const payload = await collectRequestBody(req);
      const segments = pathname.split("/").filter(Boolean);
      const matchId = decodeURIComponent(segments[3]);
      const data = readData();
      const match = data.paymentMatches?.matches?.find((item) => item.id === matchId);

      if (!match || !match.transaction || match.status === "missing") {
        sendJson(res, 404, { error: "Payment match not found" });
        return;
      }

      const aliasesAdded = payload.rememberPayer ? addPayerAliasesFromMatch(data, match) : 0;
      confirmPaymentMatchInStore(data, match);
      data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      generatePaymentMatches(data);
      writeData(data);
      sendJson(res, 200, { ok: true, aliasesAdded, paymentMatches: data.paymentMatches });
    } catch (error) {
      sendJson(res, 400, { error: "Unable to confirm payment match" });
    }

    return;
  }

  if (pathname === "/api/reconciliation/manual-confirm" && req.method === "POST") {
    try {
      const payload = await collectRequestBody(req);
      const data = readData();
      const result = confirmManualPaymentMatch(
        data,
        String(payload.targetId || ""),
        String(payload.transactionId || ""),
        payload.rememberPayer !== false
      );

      if (!result) {
        sendJson(res, 404, { error: "Manual payment match not found" });
        return;
      }

      data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      generatePaymentMatches(data);
      writeData(data);
      sendJson(res, 200, {
        ok: true,
        aliasesAdded: result.aliasesAdded,
        paymentMatches: data.paymentMatches
      });
    } catch (error) {
      sendJson(res, 400, { error: "Unable to confirm manual payment match" });
    }

    return;
  }

  if (pathname === "/api/reconciliation/confirm-confident" && req.method === "POST") {
    try {
      const data = readData();
      const matches = data.paymentMatches?.matches || [];
      const confirmed = matches
        .filter((match) => match.status === "suggested" && match.confidence === "pewne" && match.transaction)
        .filter((match) => confirmPaymentMatchInStore(data, match)).length;

      data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
      generatePaymentMatches(data);
      writeData(data);
      sendJson(res, 200, { ok: true, confirmed, paymentMatches: data.paymentMatches });
    } catch (error) {
      sendJson(res, 400, { error: "Unable to confirm confident payment matches" });
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
