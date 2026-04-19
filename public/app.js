const views = {
  dashboard: {
    title: "Dzien pracy",
    subtitle: "Jedno miejsce do ogarniania sesji, zaleglosci i kolejnych krokow."
  },
  imports: {
    title: "Importy",
    subtitle: "ZL i bank jako wejscie danych do DocDash oraz historia ostatnich batchy."
  },
  patients: {
    title: "Pacjenci",
    subtitle: "Historia wizyt, rozliczenia i status prowadzenia pacjenta w jednym miejscu."
  },
  visit: {
    title: "Sesja",
    subtitle: "Notatki, podsumowanie, kontynuacja i rozliczenie po spotkaniu."
  },
  billing: {
    title: "Walidacja platnosci",
    subtitle: "Dopasowanie do sesji, potwierdzenia i wyjatki wymagajace recznej decyzji."
  },
  stats: {
    title: "Statystyki miesieczne",
    subtitle: "Widok przychodu, zaleglosci i oblozenia praktyki w jednym miejscu."
  }
};

const state = {
  data: null,
  selectedVisitId: null,
  selectedImportId: null,
  selectedPatientName: null,
  activeDateKey: null,
  patientSearch: "",
  showDayFollowup: false,
  showImportArchive: false,
  reconciliationLedger: null,
  reconciliationSelectedSessionId: null,
  reconciliationSelectedSessionIds: [],
  reconciliationListFilter: "open",
  reconciliationDateScope: "past",
  reconciliationSessionFilter: "selected",
  reconciliationTransactionFilter: "recommended",
  reconciliationFocusTransactionId: null,
  notesWorkspaceOpen: false,
  notesWorkspaceFontSize: 1.08,
  notesWorkspaceRuled: true,
  notesWorkspaceFocus: false,
  notesInkDrawing: false,
  notesInkLastPoint: null,
  notesInkPointerId: null,
  notesInkTool: "pen",
  notesInkBrushSize: "medium",
  notesInkHistory: [],
  notesInkHistoryIndex: -1,
  notesInkPageIndex: 0,
  sidebarOpen: false,
  visitAutosaveInFlight: false,
  activeView: "dashboard"
};

const titleEl = document.getElementById("view-title");
const subtitleEl = document.getElementById("view-subtitle");
const navButtons = document.querySelectorAll(".nav-link");
const viewPanels = document.querySelectorAll(".view");
const saveStatusEl = document.getElementById("save-status");
const logoutButton = document.getElementById("logout-button");
const dataToolsPanel = document.getElementById("data-tools-panel");
const dataStoreFileInput = document.getElementById("data-store-file");
const shellBackdropEl = document.getElementById("shell-backdrop");
const sidebarEl = document.getElementById("app-sidebar");
const mobileNavToggleEl = document.getElementById("mobile-nav-toggle");
const sidebarCloseEl = document.getElementById("sidebar-close");

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("pl-PL")} zl`;
}

function formatSignedCurrency(value) {
  const number = Number(value || 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("pl-PL")} zl`;
}

function isCompactShellViewport() {
  return window.innerWidth <= 1080;
}

function setSidebarOpen(isOpen) {
  const compact = isCompactShellViewport();
  state.sidebarOpen = compact && Boolean(isOpen);
  document.body.classList.toggle("sidebar-open", state.sidebarOpen);

  if (shellBackdropEl) {
    shellBackdropEl.hidden = !state.sidebarOpen;
  }

  if (mobileNavToggleEl) {
    mobileNavToggleEl.setAttribute("aria-expanded", state.sidebarOpen ? "true" : "false");
  }

  if (sidebarEl) {
    sidebarEl.setAttribute("aria-hidden", compact && !state.sidebarOpen ? "true" : "false");
  }
}

function syncResponsiveShell() {
  if (!isCompactShellViewport()) {
    setSidebarOpen(false);
    if (sidebarEl) {
      sidebarEl.setAttribute("aria-hidden", "false");
    }
    return;
  }

  if (!state.sidebarOpen && shellBackdropEl) {
    shellBackdropEl.hidden = true;
  }
}

function sumAmounts(items) {
  return Number((items || []).reduce((sum, item) => sum + Number(item?.amount || 0), 0).toFixed(2));
}

function normalizeIdList(values) {
  return Array.from(new Set((values || []).map((value) => String(value || "")).filter(Boolean)));
}

function getCurrentDateKey() {
  const now = new Date();
  const day = now.getDate();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${day}.${month}.${year}`;
}

function normalizeDateKey(label) {
  if (!label) {
    return null;
  }

  const numeric = String(label).trim().match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);
  if (numeric) {
    return `${Number(numeric[1])}.${numeric[2]}.${numeric[3]}`;
  }

  const polish = String(label).trim().toLowerCase().match(/^(\d{1,2})\s+([a-ząćęłńóśźż]+)$/i);
  if (polish) {
    const months = {
      stycznia: "01",
      lutego: "02",
      marca: "03",
      kwietnia: "04",
      maja: "05",
      czerwca: "06",
      lipca: "07",
      sierpnia: "08",
      wrzesnia: "09",
      października: "10",
      pazdziernika: "10",
      listopada: "11",
      grudnia: "12"
    };

    const month = months[polish[2]];
    if (month) {
      return `${Number(polish[1])}.${month}.${new Date().getFullYear()}`;
    }
  }

  return String(label).trim();
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0142/g, "l");
}

const SESSION_OUTCOME_META = {
  scheduled: {
    label: "zaplanowana",
    chargeable: true,
    hint: "Sesja dalej zostaje w rozliczeniach, bo pacjent moze zaplacic z gory."
  },
  completed: {
    label: "odbyta",
    chargeable: true,
    hint: "To normalna sesja do rozliczenia."
  },
  cancelled: {
    label: "nie odbyla sie",
    chargeable: false,
    hint: "Ta pozycja nie buduje dlugu ani zaleglosci."
  },
  rescheduled: {
    label: "przeniesiona",
    chargeable: false,
    hint: "Sesja wypada z rozliczen, bo rozliczana bedzie nowa data."
  },
  no_show_paid: {
    label: "no-show platny",
    chargeable: true,
    hint: "Sesja sie nie odbyla, ale oplata dalej obowiazuje."
  }
};

function defaultSessionOutcome(dateLabel) {
  const sessionDate = getDateSortValue(dateLabel);
  const today = getDateSortValue(getCurrentDateKey());
  return sessionDate >= today ? "scheduled" : "completed";
}

function normalizeSessionOutcome(outcome, dateLabel) {
  return SESSION_OUTCOME_META[outcome] ? outcome : defaultSessionOutcome(dateLabel);
}

function getSessionOutcomeMeta(outcome, dateLabel) {
  const key = normalizeSessionOutcome(outcome, dateLabel);
  return {
    key,
    ...SESSION_OUTCOME_META[key]
  };
}

function isChargeableOutcome(outcome, dateLabel) {
  return getSessionOutcomeMeta(outcome, dateLabel).chargeable;
}

function isVisitChargeable(visit) {
  return visit && visit.payment?.status !== "ignored" && isChargeableOutcome(visit.sessionOutcome, visit.dateLabel);
}

function sessionOutcomeBadgeTone(outcome, dateLabel) {
  const meta = getSessionOutcomeMeta(outcome, dateLabel);

  if (!meta.chargeable) {
    return "neutral";
  }

  return meta.key === "scheduled" ? "neutral" : "success";
}

function updateSessionOutcomeHint(outcome, dateLabel) {
  const hint = document.getElementById("visit-session-outcome-hint");
  if (!hint) {
    return;
  }

  hint.textContent = getSessionOutcomeMeta(outcome, dateLabel).hint;
}

function getDateSortValue(label) {
  const normalized = normalizeDateKey(label);
  const match = String(normalized || "").match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);

  if (!match) {
    return null;
  }

  return Number(match[3]) * 10000 + Number(match[2]) * 100 + Number(match[1]);
}

function parseDateLabel(label) {
  const normalized = normalizeDateKey(label);
  const match = String(normalized || "").match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return null;
  }

  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return getCurrentDateKey();
  }

  return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function shiftDateKey(label, deltaDays) {
  const parsed = parseDateLabel(label) || parseDateLabel(getCurrentDateKey()) || new Date();
  parsed.setDate(parsed.getDate() + Number(deltaDays || 0));
  return formatDateKey(parsed);
}

function dateDistanceBetween(left, right) {
  const leftDate = parseDateLabel(left);
  const rightDate = parseDateLabel(right);
  if (!leftDate || !rightDate) {
    return 999;
  }

  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function getTimeSortValue(label) {
  const match = String(label || "").match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return 9999;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function compareRowsByDateTime(left, right) {
  const leftDate = getDateSortValue(left.dateLabel) || 0;
  const rightDate = getDateSortValue(right.dateLabel) || 0;

  if (leftDate !== rightDate) {
    return leftDate - rightDate;
  }

  const leftTime = getTimeSortValue(left.time);
  const rightTime = getTimeSortValue(right.time);

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.patientName.localeCompare(right.patientName);
}

function compareSessionDateTimeDesc(left, right) {
  const leftDate = getDateSortValue(left?.dateLabel) || 0;
  const rightDate = getDateSortValue(right?.dateLabel) || 0;

  if (leftDate !== rightDate) {
    return rightDate - leftDate;
  }

  const leftTime = getTimeSortValue(left?.time);
  const rightTime = getTimeSortValue(right?.time);

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return String(left?.patientName || "").localeCompare(String(right?.patientName || ""));
}

function compareTransactionHistoryDesc(left, right) {
  const leftDate = getDateSortValue(left?.transactionDate) || 0;
  const rightDate = getDateSortValue(right?.transactionDate) || 0;

  if (leftDate !== rightDate) {
    return rightDate - leftDate;
  }

  const leftTarget = left?.matchedTargets?.[0] || null;
  const rightTarget = right?.matchedTargets?.[0] || null;
  const leftTime = getTimeSortValue(leftTarget?.time);
  const rightTime = getTimeSortValue(rightTarget?.time);

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  return String(left?.counterparty || "").localeCompare(String(right?.counterparty || ""));
}

function compareDayPlanItems(left, right) {
  const leftTime = getTimeSortValue(left?.visit?.time || left?.row?.time);
  const rightTime = getTimeSortValue(right?.visit?.time || right?.row?.time);

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  if (left.statusRank !== right.statusRank) {
    return left.statusRank - right.statusRank;
  }

  return String(left.patientName || "").localeCompare(String(right.patientName || ""));
}

function sessionIdentityKey(session) {
  if (!session) {
    return "";
  }

  return `${normalizeSearchText(session.patientName)}|${normalizeDateKey(session.dateLabel) || ""}|${String(session.time || "").trim()}|${Number(session.amount || 0)}`;
}

function getSelectedVisit() {
  if (!state.data) {
    return null;
  }

  return state.data.visits.find((visit) => visit.id === state.selectedVisitId) || state.data.visits[0];
}

function getActiveDateWorkflowVisits() {
  return state.data.visits.filter((visit) => normalizeDateKey(visit.dateLabel) === state.activeDateKey);
}

function getActiveDateImportRows() {
  return getImports()
    .flatMap((batch) => (batch.rows || []).map((row) => ({ ...row, importId: batch.id })))
    .filter((row) => normalizeDateKey(row.dateLabel) === state.activeDateKey && !row.processed);
}

function getPatients() {
  const byPatient = new Map();

  state.data.visits.forEach((visit) => {
    if (!byPatient.has(visit.patientName)) {
      byPatient.set(visit.patientName, { visits: [], importedRows: [] });
    }

    byPatient.get(visit.patientName).visits.push(visit);
  });

  getImports().forEach((batch) => {
    (batch.rows || []).forEach((row) => {
      if (!byPatient.has(row.patientName)) {
        byPatient.set(row.patientName, { visits: [], importedRows: [] });
      }

      byPatient.get(row.patientName).importedRows.push({ ...row, importId: batch.id });
    });
  });

  return Array.from(byPatient.entries())
    .map(([patientName, payload]) => {
      const visits = payload.visits;
      const importedRows = payload.importedRows;
      const chargeableVisits = visits.filter((visit) => isVisitChargeable(visit));
      const totalDue = chargeableVisits.reduce((sum, visit) => sum + visit.payment.amount, 0);
      const totalPaid = chargeableVisits
        .filter((visit) => visit.payment.status === "paid")
        .reduce((sum, visit) => sum + visit.payment.amount, 0);
      const pending = totalDue - totalPaid;
      const nextVisit = visits.find((visit) => visit.nextVisit.status === "scheduled");
      const importOnlyRows = importedRows.filter((row) => !row.linkedVisitId);
      const attention = getPatientAttentionMeta(pending, importedRows);

      return {
        patientName,
        visits,
        importedRows,
        visitCount: visits.length + importOnlyRows.length,
        importedCount: importedRows.length,
        importOnlyCount: importOnlyRows.length,
        unresolvedImportCount: importedRows.filter(importRowNeedsAttention).length,
        totalDue,
        totalPaid,
        pending,
        nextVisit,
        activeStatus: attention.label,
        activeStatusTone: attention.tone,
        activeStatusDetail: attention.detail
      };
    })
    .sort((left, right) => left.patientName.localeCompare(right.patientName));
}

function getSelectedPatient() {
  const patients = getPatients();
  return patients.find((patient) => patient.patientName === state.selectedPatientName) || patients[0];
}

function importRowTargetId(row) {
  if (!row?.importId || !row?.id) {
    return "";
  }

  return `import:${row.importId}:${row.id}`;
}

function isPendingImportPaymentLabel(label) {
  const normalized = normalizeSearchText(label);
  return normalized.includes("nie zaplacono") || normalized.includes("oczekuje");
}

function getExternalPaymentMeta(method) {
  switch (method) {
    case "cash":
      return { label: "gotowka", tone: "success", ignored: false };
    case "other_account":
      return { label: "inne konto", tone: "success", ignored: false };
    case "ignored":
      return { label: "pominieta", tone: "neutral", ignored: true };
    default:
      return null;
  }
}

function normalizePaymentConfirmationSource(source, fallback = "none") {
  const safe = String(source || "").trim().toLowerCase();
  if (["none", "manual", "bank", "cash", "other_account", "ignored"].includes(safe)) {
    return safe;
  }

  return fallback;
}

function paymentStatusLabelForConfirmationSource(source, fallback = "potwierdzone recznie") {
  switch (normalizePaymentConfirmationSource(source, "none")) {
    case "bank":
      return "potwierdzone z banku";
    case "manual":
      return "potwierdzone recznie";
    case "cash":
      return "gotowka";
    case "other_account":
      return "inne konto";
    case "ignored":
      return "pominieta";
    default:
      return fallback;
  }
}

function deriveVisitPaymentConfirmationSource(payment = {}, confirmedMatch = null) {
  if (payment?.status === "ignored") {
    return "ignored";
  }

  if (confirmedMatch?.externalPayment?.method) {
    return normalizePaymentConfirmationSource(confirmedMatch.externalPayment.method, "other_account");
  }

  if (confirmedMatch?.transaction || payment?.bankTransactionId) {
    return "bank";
  }

  const explicit = normalizePaymentConfirmationSource(payment?.confirmationSource, "");
  if (explicit) {
    return explicit;
  }

  if (payment?.status === "paid") {
    if (payment?.method === "cash") {
      return "cash";
    }
    if (payment?.method === "other_account") {
      return "other_account";
    }

    return "manual";
  }

  return "none";
}

function deriveImportRowPaymentConfirmationSource(row = {}, confirmedMatch = null) {
  if (row?.paymentIgnored || confirmedMatch?.externalPayment?.ignored) {
    return "ignored";
  }

  if (confirmedMatch?.externalPayment?.method) {
    return normalizePaymentConfirmationSource(confirmedMatch.externalPayment.method, "other_account");
  }

  if (confirmedMatch?.transaction || row?.bankTransactionId) {
    return "bank";
  }

  if (row?.externalPaymentMethod) {
    return normalizePaymentConfirmationSource(row.externalPaymentMethod, "other_account");
  }

  const explicit = normalizePaymentConfirmationSource(row?.paymentConfirmationSource, "");
  if (explicit) {
    return explicit;
  }

  if (row?.paymentConfirmed) {
    return "manual";
  }

  return "none";
}

function editableVisitPaymentConfirmationSource(visit, paymentStatus, paymentMethod) {
  const confirmedMatch = getConfirmedVisitMatch(visit);
  const derived = deriveVisitPaymentConfirmationSource(
    {
      ...visit?.payment,
      status: paymentStatus,
      method: paymentMethod
    },
    confirmedMatch
  );

  if (paymentStatus !== "paid" || derived === "bank" || derived === "ignored") {
    return "";
  }

  if (derived === "none") {
    return paymentMethod === "cash" ? "cash" : "manual";
  }

  return derived;
}

let confirmedPaymentMatchLookupCache = null;
let confirmedPaymentMatchLookupSource = null;

function getConfirmedPaymentMatchLookup() {
  const paymentMatches = state.data?.paymentMatches || { generatedAt: "", matches: [] };
  const matches = paymentMatches.matches || [];

  if (confirmedPaymentMatchLookupCache && confirmedPaymentMatchLookupSource === matches) {
    return confirmedPaymentMatchLookupCache;
  }

  const byTargetId = new Map();
  const bySessionKey = new Map();
  const byMatchId = new Map();

  matches
    .filter((match) => match.status === "confirmed")
    .forEach((match) => {
      if (match?.id && !byMatchId.has(match.id)) {
        byMatchId.set(match.id, match);
      }

      (match.targets || []).forEach((target) => {
        if (target?.id && !byTargetId.has(target.id)) {
          byTargetId.set(target.id, match);
        }

        const key = sessionIdentityKey(target);
        if (key && !bySessionKey.has(key)) {
          bySessionKey.set(key, match);
        }
      });
  });

  confirmedPaymentMatchLookupSource = matches;
  confirmedPaymentMatchLookupCache = { byTargetId, bySessionKey, byMatchId };
  return confirmedPaymentMatchLookupCache;
}

function getConfirmedImportRowMatch(row) {
  if (!row) {
    return null;
  }

  const lookup = getConfirmedPaymentMatchLookup();
  const targetId = importRowTargetId(row);
  return lookup.byTargetId.get(targetId) || lookup.bySessionKey.get(sessionIdentityKey(row)) || null;
}

function getVisitTargetId(visit) {
  return visit?.id ? `visit:${visit.id}` : "";
}

function getConfirmedVisitMatch(visit) {
  if (!visit) {
    return null;
  }

  const lookup = getConfirmedPaymentMatchLookup();
  const targetId = getVisitTargetId(visit);
  return (
    lookup.byTargetId.get(targetId) ||
    lookup.bySessionKey.get(sessionIdentityKey({ ...visit, amount: Number(visit.payment?.amount || 0) })) ||
    (visit.payment?.paymentMatchId ? lookup.byMatchId.get(visit.payment.paymentMatchId) : null) ||
    null
  );
}

function getImportRowOutcomeMeta(row) {
  return getSessionOutcomeMeta(row?.sessionOutcome, row?.dateLabel);
}

function getImportRowPaymentMeta(row) {
  const outcomeMeta = getImportRowOutcomeMeta(row);
  const confirmedMatch = getConfirmedImportRowMatch(row);
  const externalMeta = getExternalPaymentMeta(row?.externalPaymentMethod);
  const matchedExternalMeta = getExternalPaymentMeta(confirmedMatch?.externalPayment?.method);
  const confirmationSource = deriveImportRowPaymentConfirmationSource(row, confirmedMatch);
  const ignored = Boolean(row?.paymentIgnored || matchedExternalMeta?.ignored || externalMeta?.ignored);
  const settled = Boolean(
    confirmedMatch ||
    row?.paymentConfirmed ||
    row?.bankTransactionId ||
    row?.externalPaymentMethod ||
    row?.paymentIgnored
  );

  if (!outcomeMeta.chargeable) {
    return {
      settled: true,
      ignored: true,
      label: "bez naleznosci",
      tone: "neutral",
      match: confirmedMatch
    };
  }

  if (ignored) {
    return {
      settled: true,
      ignored: true,
      label: paymentStatusLabelForConfirmationSource(
        confirmationSource,
        row?.paymentStatus || matchedExternalMeta?.label || externalMeta?.label || "pominieta"
      ),
      tone: "neutral",
      match: confirmedMatch,
      confirmationSource
    };
  }

  if (settled) {
    const label = resolvedPaidPaymentLabel({
      storedLabel: row?.paymentStatus,
      paymentMethod: row?.externalPaymentMethod,
      hasBankLink: Boolean(confirmedMatch?.transaction || row?.bankTransactionId),
      confirmedExternalMethod: confirmedMatch?.externalPayment?.method,
      confirmationSource
    });

    return {
      settled: true,
      ignored: false,
      label,
      tone: "success",
      match: confirmedMatch,
      confirmationSource
    };
  }

  return {
    settled: false,
    ignored: false,
    label: "nierozliczona",
    tone: "warning",
    match: null,
    confirmationSource: "none"
  };
}

function defaultVisitPaymentStatusLabel(status) {
  if (status === "paid") {
    return "potwierdzone recznie";
  }

  if (status === "partial") {
    return "platnosc czesciowa";
  }

  if (status === "ignored") {
    return "pominieta";
  }

  return "platnosc oczekuje";
}

function isGenericPaidStatusLabel(label) {
  const value = normalizeSearchText(label);
  return !value || ["oplacone", "zaplacono", "potwierdzone", "paid"].includes(value);
}

function resolvedPaidPaymentLabel({
  storedLabel = "",
  paymentMethod = "",
  hasBankLink = false,
  confirmedExternalMethod = "",
  confirmationSource = ""
} = {}) {
  const explicitSource = normalizePaymentConfirmationSource(confirmationSource, "");
  if (explicitSource && explicitSource !== "none") {
    return paymentStatusLabelForConfirmationSource(explicitSource, storedLabel || "potwierdzone recznie");
  }

  const confirmedExternalMeta = getExternalPaymentMeta(confirmedExternalMethod);
  if (confirmedExternalMeta && !confirmedExternalMeta.ignored) {
    return confirmedExternalMeta.label;
  }

  if (hasBankLink) {
    return "potwierdzone z banku";
  }

  const methodMeta = getExternalPaymentMeta(paymentMethod);
  if (methodMeta && !methodMeta.ignored) {
    return methodMeta.label;
  }

  const label = String(storedLabel || "").trim();
  if (label && !isPendingImportPaymentLabel(label) && !isGenericPaidStatusLabel(label)) {
    return label;
  }

  return "potwierdzone recznie";
}

function getLedgerSessionPaymentLabel(session) {
  if (!session) {
    return "rozliczona";
  }

  return resolvedPaidPaymentLabel({
    storedLabel: session.paymentStatusLabel,
    paymentMethod: session.paymentMethod,
    hasBankLink: Boolean(session.bankTransactionId),
    confirmationSource: session.paymentConfirmationSource
  });
}

function getVisitPaymentMeta(visit, overrides = {}) {
  if (!visit) {
    return {
      settled: false,
      ignored: false,
      blockedByOutcome: false,
      label: "platnosc oczekuje",
      tone: "warning"
    };
  }

  const outcomeMeta = getSessionOutcomeMeta(overrides.outcome || visit.sessionOutcome, visit.dateLabel);
  const confirmedMatch = getConfirmedVisitMatch(visit);
  const matchedExternalMeta = getExternalPaymentMeta(confirmedMatch?.externalPayment?.method);
  const paymentMethod = overrides.paymentMethod || visit.payment?.method;
  const paymentStatus =
    overrides.paymentStatus ||
      (confirmedMatch ? (matchedExternalMeta?.ignored ? "ignored" : "paid") : visit.payment?.status || "pending");
  const confirmationSource = paymentStatus === "paid" || paymentStatus === "ignored"
    ? deriveVisitPaymentConfirmationSource(
      {
        ...visit.payment,
        status: paymentStatus,
        method: paymentMethod,
        confirmationSource: overrides.confirmationSource ?? visit.payment?.confirmationSource
      },
      confirmedMatch
    )
    : "none";
  const usesStoredStatus = !overrides.paymentStatus && paymentStatus === visit.payment?.status;
  const storedLabel = usesStoredStatus ? String(visit.payment?.statusLabel || "").trim() : "";

  if (!outcomeMeta.chargeable) {
    return {
      settled: true,
      ignored: true,
      blockedByOutcome: true,
      label: "bez naleznosci",
      tone: "neutral",
      confirmationSource: "none",
      bankLinked: false
    };
  }

  if (paymentStatus === "ignored") {
    return {
      settled: true,
      ignored: true,
      blockedByOutcome: false,
      label: paymentStatusLabelForConfirmationSource(
        confirmationSource,
        matchedExternalMeta?.label || storedLabel || defaultVisitPaymentStatusLabel(paymentStatus)
      ),
      tone: "neutral",
      confirmationSource,
      bankLinked: false
    };
  }

  if (paymentStatus === "paid") {
    const label = resolvedPaidPaymentLabel({
      storedLabel,
      paymentMethod,
      hasBankLink: Boolean(confirmedMatch?.transaction || visit.payment?.bankTransactionId),
      confirmedExternalMethod: confirmedMatch?.externalPayment?.method,
      confirmationSource
    });
    return {
      settled: true,
      ignored: false,
      blockedByOutcome: false,
      label,
      tone: "success",
      confirmationSource,
      bankLinked: confirmationSource === "bank"
    };
  }

  if (paymentStatus === "partial") {
    return {
      settled: false,
      ignored: false,
      blockedByOutcome: false,
      label: storedLabel || defaultVisitPaymentStatusLabel(paymentStatus),
      tone: "neutral",
      confirmationSource: "none",
      bankLinked: false
    };
  }

  return {
    settled: false,
    ignored: false,
    blockedByOutcome: false,
    label: storedLabel || defaultVisitPaymentStatusLabel(paymentStatus),
    tone: "warning",
    confirmationSource: "none",
    bankLinked: false
  };
}

function isImportRowSettled(row) {
  return getImportRowPaymentMeta(row).settled;
}

function needsImportWorkflowCard(row) {
  return !row?.linkedVisitId;
}

function importRowNeedsAttention(row) {
  return needsImportWorkflowCard(row) && getImportRowOutcomeMeta(row).chargeable && !isImportRowSettled(row);
}

function getPatientAttentionMeta(pending, importedRows = []) {
  const openImports = (importedRows || []).filter(importRowNeedsAttention).length;

  if (pending > 0 && openImports > 0) {
    return {
      label: "Saldo i importy",
      tone: "warning",
      detail: `${openImports} wizyty z importu ZL czekaja na przejecie, a saldo pacjenta wynosi ${formatCurrency(pending)}.`
    };
  }

  if (pending > 0) {
    return {
      label: "Saldo otwarte",
      tone: "warning",
      detail: `Pacjent ma otwarte saldo ${formatCurrency(pending)} do potwierdzenia lub rozliczenia.`
    };
  }

  if (openImports > 0) {
    return {
      label: "Importy ZL",
      tone: "warning",
      detail: `${openImports} wizyty z importu ZL nadal czekaja na rozliczenie lub utworzenie karty sesji.`
    };
  }

  return {
    label: "Aktywny",
    tone: "success",
    detail: "Brak otwartych importow i brak zaleglosci rozliczeniowych."
  };
}

function getFilteredPatients() {
  const patients = getPatients();
  const search = normalizeSearchText(state.patientSearch);

  if (!search) {
    return patients;
  }

  return patients.filter((patient) => {
    return normalizeSearchText(`${patient.patientName} ${patient.activeStatus}`).includes(search);
  });
}

function resolvePatientNameInput(rawName) {
  const typedName = String(rawName || "").trim();
  const normalizedTypedName = normalizeSearchText(typedName).trim();
  if (!normalizedTypedName) {
    return "";
  }

  const existingPatient = getPatients().find((patient) => (
    normalizeSearchText(patient.patientName).trim() === normalizedTypedName
  ));

  return existingPatient?.patientName || typedName;
}

function renderCreatePatientSuggestions() {
  const list = document.getElementById("create-patient-suggestions");
  const hint = document.getElementById("create-patient-hint");
  if (!list) {
    return;
  }

  const patientNames = Array.from(new Set(
    getPatients()
      .map((patient) => String(patient.patientName || "").trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, "pl"));

  list.replaceChildren(...patientNames.map((patientName) => {
    const option = document.createElement("option");
    option.value = patientName;
    return option;
  }));

  if (hint) {
    hint.textContent = patientNames.length
      ? `Zacznij wpisywac, a podpowiemy pacjenta z bazy (${patientNames.length}). Nowa osoba zapisze sie po dodaniu wizyty.`
      : "Wpisz pelne imie i nazwisko. Pierwsza dodana wizyta utworzy karte pacjenta w bazie.";
  }
}

function getImports() {
  return state.data.imports || [];
}

function getSelectedImport() {
  const imports = getImports();
  return imports.find((item) => item.id === state.selectedImportId) || imports[0] || null;
}

function setSaveStatus(message, type = "idle") {
  const text = String(message || "").trim();
  saveStatusEl.textContent = text;
  saveStatusEl.dataset.state = type;
  saveStatusEl.hidden = !text;
}

function setReconciliationImportStatus(message, type = "idle") {
  const status = document.getElementById("reconciliation-import-status");
  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.state = type;
}

function setReconciliationImportPending(isPending) {
  const button = document.getElementById("run-reconciliation-import");
  if (!button) {
    return;
  }

  button.disabled = Boolean(isPending);
  button.textContent = isPending ? "Importuje..." : "Importuj i dopasuj";
}

function fetchWithTimeout(url, options = {}, timeoutMs = 0) {
  if (!timeoutMs) {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function startReconciliationImportStatusTimers() {
  const timers = [
    window.setTimeout(() => {
      setReconciliationImportStatus("Import nadal trwa. Przy wiekszych plikach to moze byc normalne.", "pending");
    }, 8000),
    window.setTimeout(() => {
      setReconciliationImportStatus(
        "To trwa dluzej niz zwykle. Jesli nic sie nie zmieni, sprobuj mniejszy zakres albo ponow import za chwile.",
        "pending"
      );
    }, 20000)
  ];

  return () => timers.forEach((timer) => window.clearTimeout(timer));
}

function setActiveView(viewKey) {
  if (viewKey !== "visit" && state.notesWorkspaceOpen) {
    setNotesWorkspaceVisibility(false);
  }

  if (isCompactShellViewport()) {
    setSidebarOpen(false);
  }

  state.activeView = viewKey;
  const meta = views[viewKey];
  titleEl.textContent = meta.title;
  subtitleEl.textContent = meta.subtitle;

  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewKey);
  });

  viewPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `${viewKey}-view`);
  });
}

function setChoiceState(group, value) {
  document.querySelectorAll(`[data-choice-group="${group}"]`).forEach((button) => {
    button.classList.toggle("active", button.dataset.choiceValue === value);
  });
}

function clearChoiceState(group) {
  document.querySelectorAll(`[data-choice-group="${group}"]`).forEach((button) => {
    button.classList.remove("active");
  });
}

function getTodayMetrics() {
  const workflowToday = getActiveDateWorkflowVisits();
  const importedToday = getActiveDateImportRows();
  const completed = workflowToday.filter((visit) => visit.status === "closed").length;
  const chargeableToday = workflowToday.filter((visit) => isVisitChargeable(visit));
  const due = chargeableToday.reduce((sum, visit) => sum + visit.payment.amount, 0);
  const paid = chargeableToday
    .filter((visit) => visit.payment.status === "paid")
    .reduce((sum, visit) => sum + visit.payment.amount, 0);
  const openItems = buildInboxItems(state.activeDateKey).length + importedToday.length;

  return { total: workflowToday.length, completed, due, paid, openItems, importedPending: importedToday.length };
}

function getWorkingDayLabel() {
  return state.activeDateKey || "Brak ustawionego dnia";
}

function getMonthlyStats() {
  const visits = state.data.visits;
  const chargeableVisits = visits.filter((visit) => isVisitChargeable(visit));
  const paid = chargeableVisits
    .filter((visit) => visit.payment.status === "paid")
    .reduce((sum, visit) => sum + visit.payment.amount, 0);
  const due = chargeableVisits.reduce((sum, visit) => sum + visit.payment.amount, 0);
  const unscheduled = visits.filter((visit) => visit.nextVisit.status !== "scheduled").length;
  const pendingPayments = chargeableVisits.filter((visit) => visit.payment.status !== "paid").length;
  const closed = visits.filter((visit) => visit.status === "closed").length;
  const closureRate = Math.round((closed / visits.length) * 100);
  const average = chargeableVisits.length ? Math.round(due / chargeableVisits.length) : 0;

  return {
    monthLabel: state.data.meta.monthLabel,
    sessionCount: visits.length,
    due,
    paid,
    pending: due - paid,
    average,
    unscheduled,
    pendingPayments,
    occupancy: state.data.meta.weekOccupancy,
    closureRate
  };
}

function renderDashboard() {
  const metrics = getTodayMetrics();
  const todayVisits = getActiveDateWorkflowVisits();
  const dayImportRows = getActiveDateImportRows();
  const selectedVisit = todayVisits.find((visit) => visit.id === state.selectedVisitId) || todayVisits[0] || null;
  const workingDayLabel = getWorkingDayLabel();
  const importedPendingCount = dayImportRows.length;
  const importedPendingLabel = importedPendingCount
    ? `${importedPendingCount} z ZL czeka na przejecie`
    : "brak wpisow ZL do przejecia";
  const isToday = normalizeDateKey(workingDayLabel) === normalizeDateKey(getCurrentDateKey());

  document.getElementById("day-context").innerHTML = `
    <div class="day-context-copy">
      <p class="panel-label">Aktywny dzien workflow</p>
      <div class="day-context-heading">
        <h3>${workingDayLabel}</h3>
        <div class="day-nav">
          <button class="ghost day-nav-button" id="day-prev" type="button" aria-label="Poprzedni dzien">‹</button>
          <button class="ghost day-nav-button" id="day-today" type="button"${isToday ? " disabled" : ""}>Dzis</button>
          <button class="ghost day-nav-button" id="day-next" type="button" aria-label="Nastepny dzien">›</button>
        </div>
      </div>
      <p>${
        importedPendingCount
          ? `Masz ${importedPendingCount} wpis${importedPendingCount === 1 ? "" : importedPendingCount < 5 ? "y" : "ow"} z ZL na ten dzien. Jednym ruchem przenosisz je do sesji DocDash i dalej pracujesz juz tylko u nas.`
          : "Ten dzien jest juz przejety do DocDash. Dalej pracujesz tylko na sesjach, statusach i rozliczeniach."
      }</p>
    </div>
    <div class="day-context-meta">
      <span class="day-pill">${todayVisits.length} wizyt w workflow</span>
      <span class="day-pill">${importedPendingLabel}</span>
      <span class="day-pill">${metrics.openItems} rzeczy do domkniecia</span>
      ${
        importedPendingCount
          ? `<button class="primary" id="promote-active-day" type="button">Przejmij caly dzien do sesji</button>`
          : ""
      }
    </div>
  `;

    const dayItems = [
      ...todayVisits.map((visit) => ({
        type: "workflow",
        statusRank: visit.status === "closed" ? 3 : 1,
      patientName: visit.patientName,
      visit
    })),
    ...dayImportRows.map((row) => ({
      type: "import",
        statusRank: 0,
        patientName: row.patientName,
        row
      }))
    ].sort(compareDayPlanItems);

  document.getElementById("day-schedule").innerHTML = dayItems.length
    ? `
      <div class="day-work-list">
        <div class="day-work-head">
          <span>Pacjent</span>
          <span>Godzina</span>
          <span>Status</span>
          <span>Platnosc</span>
          <span>Akcja</span>
        </div>
        ${dayItems
          .map((item) => {
            if (item.type === "workflow") {
              const visit = item.visit;
              const paymentMeta = getVisitPaymentMeta(visit);
              return `
                <article class="day-entry workflow-entry day-list-row" data-day-open-visit="${visit.id}">
                  <div>
                    <h4>${visit.patientName}</h4>
                    <p>${visit.serviceName || "sesja"} - ${visit.source}</p>
                  </div>
                  <span class="day-entry-time">${visit.time || "bez godziny"}</span>
                  <span class="tag">${visit.status === "closed" ? "zamknieta" : "w workflow"}</span>
                  <span class="tag">${paymentMeta.label}</span>
                  <button class="ghost" type="button">Sesja</button>
                </article>
              `;
            }

            const row = item.row;
            return `
              <article class="day-entry import-entry day-list-row" data-day-promote="${row.id}" data-import-id="${row.importId}">
                <div>
                  <h4>${row.patientName}</h4>
                  <p>${row.serviceName} - wpis z ${row.source}</p>
                </div>
                <span class="day-entry-time">${row.time || "bez godziny"}</span>
                <span class="tag">w ZL</span>
                <span class="tag">${row.paymentStatus}</span>
                <button class="ghost" type="button">Przejmij pojedynczo</button>
              </article>
            `;
          })
          .join("")}
      </div>
    `
    : `<div class="empty-state">Na ${workingDayLabel} nie ma jeszcze zadnych pozycji dnia. Dodaj wizyte recznie albo zaimportuj dane.</div>`;

  document.getElementById("visit-checklist").innerHTML = selectedVisit
    ? selectedVisit.closureChecklist.map((item) => `<li class="${item.done ? "done" : "todo"}">${item.label}</li>`).join("")
    : `<li class="todo">Brak aktywnej wizyty w workflow na ten dzien.</li>`;

  document.getElementById("next-step-card").innerHTML = selectedVisit
    ? `
      <p class="panel-label">Zapamietane ustalenie</p>
      <h4>${selectedVisit.nextVisit.plannedLabel}</h4>
      <span>${selectedVisit.nextVisit.note}</span>
    `
    : `
      <p class="panel-label">Co dalej</p>
      <h4>Przejmij dzien z ZL albo dodaj wizyte recznie</h4>
      <span>Po przejeciu pracujesz juz na sesjach DocDash, a nie na samych wpisach z importu.</span>
    `;
  renderInbox(state.activeDateKey);
  document.getElementById("day-followup-panel").hidden = !state.showDayFollowup;
  const toggleButton = document.getElementById("toggle-followup");
  if (toggleButton) {
    toggleButton.textContent = state.showDayFollowup ? "Ukryj domkniecia" : "Pokaz domkniecia";
  }

  document.querySelectorAll("[data-day-open-visit]").forEach((item) => {
    item.onclick = async () => {
      await openVisitById(item.dataset.dayOpenVisit);
    };
  });

  document.querySelectorAll("[data-day-promote]").forEach((item) => {
    item.onclick = async () => {
      await promoteImportRow(item.dataset.importId, item.dataset.dayPromote);
    };
  });

  document.getElementById("promote-active-day")?.addEventListener("click", async () => {
    await promoteActiveDayToWorkflow();
  });

  document.getElementById("day-prev")?.addEventListener("click", () => {
    state.activeDateKey = shiftDateKey(state.activeDateKey, -1);
    renderAll();
  });

  document.getElementById("day-next")?.addEventListener("click", () => {
    state.activeDateKey = shiftDateKey(state.activeDateKey, 1);
    renderAll();
  });

  document.getElementById("day-today")?.addEventListener("click", () => {
    state.activeDateKey = getCurrentDateKey();
    renderAll();
  });
}

function buildInboxItems(dateKey = null) {
  const items = [];

  state.data.visits.forEach((visit) => {
    const followUp = visit.followUp || {};
    const visitDateKey = normalizeDateKey(visit.dateLabel);

    if (dateKey && visitDateKey !== dateKey) {
      return;
    }

    if (isVisitChargeable(visit) && visit.payment.status !== "paid" && !followUp.paymentReminderSent) {
      items.push({
        id: `${visit.id}-payment-reminder`,
        visitId: visit.id,
        type: "payment_reminder",
        priority: visitDateKey === state.activeDateKey ? "high" : "medium",
        title: `${visit.patientName} czeka na przypomnienie o platnosci`,
        detail: `${visit.dateLabel} - ${formatCurrency(visit.payment.amount)} - ${visit.payment.followUpLabel}`,
        actionLabel: "Wyslano przypomnienie"
      });
    }

    if (isVisitChargeable(visit) && visit.payment.documentType !== "none" && !followUp.documentReady) {
      items.push({
        id: `${visit.id}-document`,
        visitId: visit.id,
        type: "document_ready",
        priority: "high",
        title: `${visit.patientName} wymaga dokumentu sprzedazy`,
        detail: `${visit.payment.documentType === "invoice" ? "Faktura" : "Paragon"} do przygotowania`,
        actionLabel: "Dokument gotowy"
      });
    }

    if (visit.nextVisit.status === "to_schedule" && !followUp.zlSynced) {
      items.push({
        id: `${visit.id}-zl-sync`,
        visitId: visit.id,
        type: "zl_sync",
        priority: visitDateKey === state.activeDateKey ? "high" : "medium",
        title: `${visit.patientName} nie ma jeszcze terminu w ZL`,
        detail: visit.nextVisit.plannedLabel,
        actionLabel: "Termin wpisany do ZL"
      });
    }
  });

  return items;
}

function renderInbox(dateKey = null) {
  const inboxItems = buildInboxItems(dateKey);
  const inboxRoot = document.getElementById("inbox-list");

  if (!inboxItems.length) {
    inboxRoot.innerHTML = `<div class="empty-state">Na teraz wszystko domkniete. Inbox jest pusty.</div>`;
    return;
  }

  inboxRoot.innerHTML = inboxItems
    .map((item) => {
      return `
        <article class="inbox-item priority-${item.priority}">
          <div class="inbox-copy">
            <p class="inbox-kicker">${item.priority === "high" ? "wysoki priorytet" : "do ogarniecia"}</p>
            <h4>${item.title}</h4>
            <span>${item.detail}</span>
          </div>
          <div class="inbox-actions">
            <button class="ghost inbox-open" type="button" data-visit-jump="${item.visitId}">Otworz</button>
            <button class="primary inbox-complete" type="button" data-inbox-action="${item.type}" data-visit-id="${item.visitId}">${item.actionLabel}</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderVisitForm() {
  const visit = getSelectedVisit();
  const badge = document.getElementById("visit-status-badge");
  const outcomeMeta = getSessionOutcomeMeta(visit.sessionOutcome, visit.dateLabel);

  document.getElementById("visit-heading").textContent = `${visit.patientName} - ${visit.dateLabel} - ${visit.time}`;
  badge.textContent = visit.status === "closed" ? "zamknieta" : "wymaga akcji";
  badge.className = `badge ${visit.status === "closed" ? "success" : "warning"}`;

  document.getElementById("visit-notes-mode").value = visit.notesMode === "ink" || visit.notesInk ? "ink" : "text";
  document.getElementById("visit-notes-ink").value = visit.notesInk || "";
  document.getElementById("visit-notes").value = visit.notes;
  document.getElementById("visit-summary").value = visit.summary;
  document.getElementById("visit-next-note").value = visit.nextVisit.note;
  document.getElementById("visit-next-planned").value = visit.nextVisit.plannedLabel;
  updateSessionOutcomeHint(outcomeMeta.key, visit.dateLabel);
  setChoiceState("session-outcome", outcomeMeta.key);
  setChoiceState("next-status", visit.nextVisit.status);

  if (!state.notesWorkspaceOpen) {
    syncNotesWorkspacePreview(visit.notes);
  } else {
    updateNotesWorkspaceMeta(visit);
  }

  renderVisitNotesPreview(visit);
}

function getVisitNotesMode(visit = getSelectedVisit()) {
  const input = document.getElementById("visit-notes-mode");
  const stored = input?.value || visit?.notesMode || (visit?.notesInk ? "ink" : "text");
  return stored === "ink" ? "ink" : "text";
}

function getVisitNotesInkData(visit = getSelectedVisit()) {
  const input = document.getElementById("visit-notes-ink");
  return input?.value || visit?.notesInk || "";
}

function parseVisitNotesInkPages(rawInk = getVisitNotesInkData()) {
  const raw = normalizeNotesInkSnapshot(rawInk).trim();
  if (!raw) {
    return [""];
  }

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      const pages = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.pages)
          ? parsed.pages
          : null;
      if (pages?.length) {
        return pages.map((page) => normalizeNotesInkSnapshot(page));
      }
    } catch (error) {
      // Legacy single-page data is handled below.
    }
  }

  return [raw];
}

function serializeVisitNotesInkPages(pages = []) {
  const normalizedPages = Array.isArray(pages) && pages.length
    ? pages.map((page) => normalizeNotesInkSnapshot(page))
    : [""];

  return normalizedPages.length <= 1
    ? normalizedPages[0] || ""
    : JSON.stringify({ version: 2, pages: normalizedPages });
}

function getVisitNotesInkPages(visit = getSelectedVisit()) {
  return parseVisitNotesInkPages(getVisitNotesInkData(visit));
}

function clampNotesInkPageIndex(index, pages = getVisitNotesInkPages()) {
  const maxIndex = Math.max((pages?.length || 1) - 1, 0);
  return Math.max(0, Math.min(Number(index) || 0, maxIndex));
}

function getActiveNotesInkPageIndex(visit = getSelectedVisit()) {
  return clampNotesInkPageIndex(state.notesInkPageIndex, getVisitNotesInkPages(visit));
}

function getActiveNotesInkPageData(visit = getSelectedVisit()) {
  const pages = getVisitNotesInkPages(visit);
  return pages[getActiveNotesInkPageIndex(visit)] || "";
}

function setVisitNotesMode(mode) {
  const input = document.getElementById("visit-notes-mode");
  if (input) {
    input.value = mode === "ink" ? "ink" : "text";
  }
  renderVisitNotesPreview(getSelectedVisit());
}

function setVisitNotesInkData(dataUrl) {
  const input = document.getElementById("visit-notes-ink");
  if (input) {
    input.value = dataUrl || "";
  }
  renderVisitNotesPreview(getSelectedVisit());
}

function setVisitNotesInkPages(pages) {
  setVisitNotesInkData(serializeVisitNotesInkPages(pages));
  state.notesInkPageIndex = clampNotesInkPageIndex(state.notesInkPageIndex, pages);
}

function setActiveNotesInkPageData(dataUrl) {
  const pages = getVisitNotesInkPages();
  const pageIndex = clampNotesInkPageIndex(state.notesInkPageIndex, pages);
  pages[pageIndex] = normalizeNotesInkSnapshot(dataUrl);
  setVisitNotesInkPages(pages);
}

function flushNotesInkCanvasToPage() {
  if (getVisitNotesMode() !== "ink") {
    return;
  }

  const stage = getNotesInkStage();
  if (!stage || stage.hidden) {
    return;
  }

  const snapshot = exportNotesInkCanvas();
  setActiveNotesInkPageData(snapshot);
}

function addNotesInkPage() {
  flushNotesInkCanvasToPage();
  const pages = getVisitNotesInkPages();
  const nextIndex = clampNotesInkPageIndex(state.notesInkPageIndex, pages) + 1;
  pages.splice(nextIndex, 0, "");
  state.notesInkPageIndex = nextIndex;
  setVisitNotesInkPages(pages);
  resetNotesInkHistory("");
  renderNotesWorkspaceControls();
}

function removeNotesInkPage() {
  flushNotesInkCanvasToPage();
  const pages = getVisitNotesInkPages();
  const pageIndex = clampNotesInkPageIndex(state.notesInkPageIndex, pages);
  if (pages.length <= 1) {
    pages[0] = "";
    state.notesInkPageIndex = 0;
  } else {
    pages.splice(pageIndex, 1);
    state.notesInkPageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
  }
  setVisitNotesInkPages(pages);
  resetNotesInkHistory(getActiveNotesInkPageData());
  renderNotesWorkspaceControls();
}

function openNotesInkPage(pageIndex) {
  flushNotesInkCanvasToPage();
  state.notesInkPageIndex = clampNotesInkPageIndex(pageIndex);
  resetNotesInkHistory(getActiveNotesInkPageData());
  renderNotesWorkspaceControls();
}

function renderVisitNotesPreview(visit = getSelectedVisit()) {
  const textPreview = document.getElementById("visit-notes");
  const inkPreview = document.getElementById("visit-ink-preview");
  const inkImage = document.getElementById("visit-ink-preview-image");
  const inkCopy = document.getElementById("visit-ink-preview-copy");
  const notesHint = document.getElementById("visit-notes-hint");

  if (!textPreview || !inkPreview || !inkImage || !inkCopy || !notesHint || !visit) {
    return;
  }

  const mode = getVisitNotesMode(visit);
  const inkPages = getVisitNotesInkPages(visit);
  const inkData = inkPages.find((page) => page) || inkPages[0] || "";
  const pageCount = inkPages.length;

  if (mode === "ink") {
    textPreview.hidden = true;
    inkPreview.hidden = false;
    inkImage.hidden = !inkData;
    if (inkData) {
      inkImage.src = inkData;
      inkCopy.textContent = "Notatka odręczna zapisana. Otwórz tryb pisania, aby dopisać kolejne rzeczy.";
      if (pageCount > 1) {
        inkCopy.textContent = `Notatka odreczna zapisana (${pageCount} strony). Otworz tryb pisania, aby przechodzic miedzy kartkami.`;
      }
    } else {
      inkImage.removeAttribute("src");
      inkCopy.textContent = "Tryb odręczny jest aktywny. Otwórz tryb pisania, aby notować rysikiem bez zamiany na tekst.";
    }
    notesHint.textContent = "Ten wpis jest prowadzony odręcznie. Otwórz tryb pisania, aby pisać dalej rysikiem.";
    if (pageCount > 1) {
      notesHint.textContent = `Ten wpis jest prowadzony odrecznie i ma ${pageCount} strony. Otworz tryb pisania, aby zobaczyc cala historie.`;
    }
    return;
  }

  textPreview.hidden = false;
  inkPreview.hidden = true;
  notesHint.textContent = "Dotknij notatek albo przycisku, aby otworzyc duzy obszar roboczy pod pisanie rysikiem.";
}

function renderPatients() {
  const patients = getPatients();
  const filteredPatients = getFilteredPatients();
  let selectedPatient = getSelectedPatient();
  const searchInput = document.getElementById("patient-search");
  const searchMeta = document.getElementById("patient-search-meta");

  if (searchInput) {
    searchInput.value = state.patientSearch;
  }

  if (filteredPatients.length && !filteredPatients.some((patient) => patient.patientName === selectedPatient?.patientName)) {
    selectedPatient = filteredPatients[0];
    state.selectedPatientName = selectedPatient.patientName;
  }

  if (searchMeta) {
    searchMeta.textContent = state.patientSearch
      ? `${filteredPatients.length} z ${patients.length} pacjentow`
      : `${patients.length} pacjentow`;
  }

  if (!selectedPatient || !filteredPatients.length) {
    document.getElementById("patient-heading").textContent = state.patientSearch ? "Brak wynikow" : "Brak pacjentow";
    document.getElementById("patient-badge").textContent = "pusto";
    document.getElementById("patient-badge").className = "badge neutral";
    document.getElementById("patient-status-copy").textContent = "";
    document.getElementById("patient-list").innerHTML = `<div class="empty-state">Nie znaleziono pacjenta dla tego wyszukiwania.</div>`;
    document.getElementById("patient-summary-grid").innerHTML = "";
    document.getElementById("patient-history").innerHTML = "";
    return;
  }

  document.getElementById("patient-heading").textContent = selectedPatient.patientName;
  document.getElementById("patient-badge").textContent = selectedPatient.activeStatus;
  document.getElementById("patient-badge").className = `badge ${selectedPatient.activeStatusTone || "neutral"}`;
  document.getElementById("patient-badge").title = selectedPatient.activeStatusDetail || "";
  document.getElementById("patient-status-copy").textContent = selectedPatient.activeStatusDetail || "";

  document.getElementById("patient-list").innerHTML = filteredPatients
    .map((patient) => {
      return `
        <article class="patient-item ${patient.patientName === selectedPatient.patientName ? "selected" : ""}" data-patient-name="${patient.patientName}">
          <div>
            <h4>${patient.patientName}</h4>
            <span>${patient.visitCount} sesji - ZL do ogarniecia: ${patient.unresolvedImportCount || 0} - saldo: ${formatCurrency(patient.pending)}</span>
          </div>
          <span class="badge ${patient.activeStatusTone || "neutral"}" title="${patient.activeStatusDetail || ""}">${patient.activeStatus}</span>
        </article>
      `;
    })
    .join("");

  document.getElementById("patient-summary-grid").innerHTML = `
    <div class="patient-summary-card">
      <p>Sesje</p>
      <strong>${selectedPatient.visitCount}</strong>
    </div>
    <div class="patient-summary-card">
      <p>ZL do ogarniecia</p>
      <strong>${selectedPatient.unresolvedImportCount || 0}</strong>
    </div>
    <div class="patient-summary-card">
      <p>Saldo</p>
      <strong>${formatCurrency(selectedPatient.pending)}</strong>
    </div>
    <div class="patient-summary-card">
      <p>Nastepna</p>
      <strong>${selectedPatient.nextVisit ? selectedPatient.nextVisit.nextVisit.plannedLabel : "brak"}</strong>
    </div>
  `;

  const historyItems = [
    ...selectedPatient.visits.map((visit) => ({
      type: "visit",
      data: visit
    })),
    ...selectedPatient.importedRows
      .filter((row) => !row.linkedVisitId)
      .map((row) => ({
      type: "import",
      data: row
    }))
  ].sort((left, right) => {
    const byDate = compareSessionDateTimeDesc(left.data, right.data);
    if (byDate !== 0) {
      return byDate;
    }

    if (left.type !== right.type) {
      return left.type === "visit" ? -1 : 1;
    }

    return 0;
  });

  document.getElementById("patient-history").innerHTML = historyItems
    .map((item) => {
      if (item.type === "visit") {
        const visit = item.data;
        const outcomeMeta = getSessionOutcomeMeta(visit.sessionOutcome, visit.dateLabel);
        const paymentMeta = getVisitPaymentMeta(visit);
        return `
          <article class="history-item">
            <div>
              <h4>${visit.dateLabel} - ${visit.time}</h4>
              <span>${visit.summary || "Brak podsumowania"}</span>
            </div>
            <div class="inbox-actions">
              <span class="badge ${sessionOutcomeBadgeTone(visit.sessionOutcome, visit.dateLabel)}">${outcomeMeta.label}</span>
              <span class="badge ${paymentMeta.tone}">${paymentMeta.label}</span>
              <button class="ghost history-open" type="button" data-history-visit="${visit.id}">Otworz sesje</button>
            </div>
          </article>
        `;
        }

        const row = item.data;
        const outcomeMeta = getImportRowOutcomeMeta(row);
        const paymentMeta = getImportRowPaymentMeta(row);
        const targetId = importRowTargetId(row);
        const needsAttention = importRowNeedsAttention(row);
        const bookingCopy = [row.serviceName, row.bookingStatus, formatCurrency(row.amount)].filter(Boolean).join(" - ");
        const outcomeCopy =
          outcomeMeta.key === "cancelled"
            ? "Sesja oznaczona jako nieodbyta."
            : outcomeMeta.key === "rescheduled"
              ? "Sesja oznaczona jako przeniesiona."
              : outcomeMeta.key === "no_show_paid"
                ? "Sesja oznaczona jako no-show platny."
                : "";
        const workflowCopy = needsAttention
          ? "To nadal tylko wpis z ZL. Jesli chcesz notatki i workflow, przejmij go do sesji."
          : "To nadal tylko wpis z ZL. Dodanie karty sesji w DocDash jest opcjonalne.";
        return `
          <article class="history-item">
            <div>
              <h4>${row.dateLabel}${row.time ? ` - ${row.time}` : ""} - ZL</h4>
              <span>${bookingCopy}</span>
              ${outcomeCopy ? `<span>${outcomeCopy}</span>` : ""}
              <span>${workflowCopy}</span>
            </div>
            <div class="inbox-actions">
              <span class="badge neutral">ZL</span>
              <span class="badge ${sessionOutcomeBadgeTone(row.sessionOutcome, row.dateLabel)}">${outcomeMeta.label}</span>
              <span class="badge ${paymentMeta.tone}">${paymentMeta.label}</span>
              ${needsAttention && targetId ? `<button class="ghost open-patient-reconciliation" type="button" data-patient-name="${encodeURIComponent(selectedPatient.patientName)}" data-target-id="${targetId}" data-transaction-id="">Waliduj platnosc</button>` : ""}
              <button class="${needsAttention ? "secondary" : "ghost"} promote-import" type="button" data-import-id="${row.importId}" data-row-id="${row.id}">${needsAttention ? "Przejmij do sesji" : "Dodaj karte sesji"}</button>
            </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-patient-name]").forEach((item) => {
    item.onclick = () => {
      state.selectedPatientName = item.dataset.patientName;
      renderPatients();
      attachActions();
    };
  });
}

function renderImports() {
  const imports = getImports();
  const selectedImport = getSelectedImport();
  const batchesRoot = document.getElementById("import-batches");
  const headingEl = document.getElementById("import-heading");
  const summaryRoot = document.getElementById("import-summary-grid");
  const rowsRoot = document.getElementById("import-rows");

  if (!imports.length) {
    batchesRoot.innerHTML = `<div class="empty-state">Brak importow.</div>`;
    headingEl.textContent = "Brak danych";
    summaryRoot.innerHTML = "";
    rowsRoot.innerHTML = "";
    return;
  }

  const importRows = [...(selectedImport.rows || [])].sort(compareRowsByDateTime);
  const activeDateValue = getDateSortValue(state.activeDateKey) || getDateSortValue(getCurrentDateKey()) || 0;
  const isPastImportRow = (row) => {
    const rowDateValue = getDateSortValue(row.dateLabel);
    return rowDateValue !== null && rowDateValue < activeDateValue;
  };
  const futureRows = importRows.filter((row) => !isPastImportRow(row));
  const pastRows = importRows.filter(isPastImportRow);
  const actionableRows = futureRows.filter((row) => !row.processed);
  const visibleRows = state.showImportArchive ? [...futureRows, ...pastRows] : actionableRows;
  const hiddenPastCount = pastRows.length;
  const hiddenProcessedCount = futureRows.filter((row) => row.processed).length;
  const totalAmount = importRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const processedCount = importRows.filter((row) => row.processed).length;

  batchesRoot.innerHTML = imports
    .map((item) => {
      return `
        <article class="import-batch-item ${selectedImport && item.id === selectedImport.id ? "selected" : ""}" data-import-id="${item.id}">
          <div>
            <h4>${item.label}</h4>
            <span>${item.sourceFile}</span>
          </div>
          <span class="badge neutral">${item.rowCount} wizyt</span>
        </article>
      `;
    })
    .join("");

  headingEl.textContent = selectedImport.label;
  summaryRoot.innerHTML = `
    <div class="patient-summary-card">
      <p>Wiersze</p>
      <strong>${selectedImport.rowCount}</strong>
    </div>
    <div class="patient-summary-card">
      <p>Wartosc</p>
      <strong>${formatCurrency(totalAmount)}</strong>
    </div>
    <div class="patient-summary-card">
      <p>Do przejecia od dzis</p>
      <strong>${actionableRows.length}</strong>
    </div>
    <div class="patient-summary-card">
      <p>Ukryte archiwum</p>
      <strong>${hiddenPastCount}</strong>
    </div>
  `;

  const filterCopy = state.showImportArchive
    ? `Pokazujesz caly import: ${importRows.length} wizyt, w tym ${hiddenPastCount} z przeszlosci i ${processedCount} juz przetworzonych.`
    : `Pokazujesz kolejke robocza od ${state.activeDateKey}: nieprzetworzone wizyty dzisiejsze i przyszle. Ukryte: ${hiddenPastCount} z przeszlosci oraz ${hiddenProcessedCount} przetworzonych od dzis.`;

  rowsRoot.innerHTML = `
    <div class="import-filter-bar">
      <p>${filterCopy}</p>
      <button class="ghost" id="toggle-import-archive" type="button">
        ${state.showImportArchive ? "Ukryj archiwum" : "Pokaz archiwum"}
      </button>
    </div>
    <div class="import-table">
      <div class="import-table-head">
        <span>Data</span>
        <span>Godz.</span>
        <span>Pacjent</span>
        <span>Usluga</span>
        <span>Status</span>
        <span>Kwota</span>
        <span>Akcja</span>
      </div>
      ${visibleRows.length ? visibleRows.map((row) => {
        const archiveClass = isPastImportRow(row) ? "archived" : "";
        const processedClass = row.processed ? "processed" : "";

        return `
          <article class="import-row-item compact ${archiveClass} ${processedClass}">
            <span class="import-date">${row.dateLabel}</span>
            <span class="import-time">${row.time || "-"}</span>
            <strong>${row.patientName}</strong>
            <span class="import-service">${row.serviceName}</span>
            <span class="badge ${row.processed ? "success" : "warning"}">${row.processed ? "przetworzone" : row.paymentStatus}</span>
            <strong>${formatCurrency(row.amount)}</strong>
            ${
              row.processed && row.linkedVisitId
                ? `<button class="ghost history-open" type="button" data-history-visit="${row.linkedVisitId}">Otworz sesje</button>`
                : `<button class="primary promote-import" type="button" data-import-id="${selectedImport.id}" data-row-id="${row.id}">Przejmij do sesji</button>`
            }
          </article>
        `;
      }).join("") : `<div class="empty-state">Brak wizyt w kolejce roboczej. Jesli szukasz starszego wpisu, wlacz archiwum.</div>`}
    </div>
  `;

  document.getElementById("toggle-import-archive").onclick = () => {
    state.showImportArchive = !state.showImportArchive;
    renderImports();
    attachActions();
  };

  document.querySelectorAll(".import-batch-item[data-import-id]").forEach((item) => {
    item.onclick = () => {
      state.selectedImportId = item.dataset.importId;
      state.showImportArchive = false;
      renderImports();
      attachActions();
    };
  });

}

function renderBilling() {
  const visit = getSelectedVisit();
  const monthly = getMonthlyStats();
  const openPayments = state.data.visits
    .filter((entry) => isVisitChargeable(entry))
    .filter((entry) => entry.payment.status !== "paid")
    .sort(compareSessionDateTimeDesc);

  document.getElementById("billing-amount").value = String(visit.payment.amount);
  setChoiceState("payment-status", visit.payment.status);
  setChoiceState("payment-method", visit.payment.method);
  setChoiceState("payment-document", visit.payment.documentType);
  clearChoiceState("payment-confirmation-source");
  updateVisitBillingPresentation();

  document.getElementById("payment-list").innerHTML = openPayments.length
    ? openPayments.map((entry) => {
      return `
        <article class="payment-item">
          <div>
            <h4>${entry.patientName}</h4>
            <span>${entry.dateLabel} - ${entry.payment.followUpLabel}</span>
          </div>
          <strong>${formatCurrency(entry.payment.amount)}</strong>
        </article>
      `;
    })
    .join("")
    : `<div class="empty-state">Brak otwartych platnosci do dopilnowania.</div>`;

  document.getElementById("billing-summary").innerHTML = `
    <div><span>Przychod miesieczny</span><strong>${formatCurrency(monthly.due)}</strong></div>
    <div><span>Do odzyskania</span><strong>${formatCurrency(monthly.pending)}</strong></div>
    <div><span>Oplacone sesje</span><strong>${state.data.visits.filter((entry) => isVisitChargeable(entry) && entry.payment.status === "paid").length}</strong></div>
  `;

  renderVisitCloseoutPreview();
  renderReconciliation();
}

function updateVisitBillingPresentation() {
  const visit = getSelectedVisit();
  const paymentBadge = document.getElementById("visit-payment-badge");
  const paymentContext = document.getElementById("visit-billing-context");
  const paymentSourceHint = document.getElementById("visit-payment-source-hint");
  const amountField = document.getElementById("billing-amount");
  const markPaidButton = document.getElementById("mark-paid");
  const issueDocumentButton = document.getElementById("issue-document");
  const selectedOutcome =
    document.querySelector('[data-choice-group="session-outcome"].active')?.dataset.choiceValue || visit.sessionOutcome;
  const selectedPaymentStatus =
    document.querySelector('[data-choice-group="payment-status"].active')?.dataset.choiceValue || visit.payment.status;
  const selectedPaymentMethod =
    document.querySelector('[data-choice-group="payment-method"].active')?.dataset.choiceValue || visit.payment.method;
  const selectedConfirmationSource =
    document.querySelector('[data-choice-group="payment-confirmation-source"].active')?.dataset.choiceValue || "";
  const outcomeMeta = getSessionOutcomeMeta(selectedOutcome, visit.dateLabel);
  const paymentMeta = getVisitPaymentMeta(visit, {
    outcome: selectedOutcome,
    paymentStatus: selectedPaymentStatus,
    paymentMethod: selectedPaymentMethod,
    confirmationSource: selectedConfirmationSource || undefined
  });
  const sourceLocked = paymentMeta.bankLinked;

  if (paymentMeta.blockedByOutcome) {
    clearChoiceState("payment-status");
    clearChoiceState("payment-method");
    clearChoiceState("payment-document");
    clearChoiceState("payment-confirmation-source");
  } else {
    if (!document.querySelector('[data-choice-group="payment-status"].active')) {
      setChoiceState("payment-status", visit.payment.status);
    }
    if (!document.querySelector('[data-choice-group="payment-method"].active')) {
      setChoiceState("payment-method", visit.payment.method);
    }
    if (!document.querySelector('[data-choice-group="payment-document"].active')) {
      setChoiceState("payment-document", visit.payment.documentType);
    }
    if (selectedPaymentStatus !== "paid" || sourceLocked) {
      clearChoiceState("payment-confirmation-source");
    } else if (!document.querySelector('[data-choice-group="payment-confirmation-source"].active')) {
      const editableSource = editableVisitPaymentConfirmationSource(visit, selectedPaymentStatus, selectedPaymentMethod);
      if (editableSource) {
        setChoiceState("payment-confirmation-source", editableSource);
      }
    }
  }

  ["payment-status", "payment-method"].forEach((group) => {
    document.querySelectorAll(`[data-choice-group="${group}"]`).forEach((button) => {
      const locked = paymentMeta.blockedByOutcome || sourceLocked;
      button.disabled = locked;
      button.title = paymentMeta.blockedByOutcome
        ? "Ta sesja nie buduje naleznosci."
        : sourceLocked
          ? "Ta platnosc jest juz powiazana z importem bankowym."
        : "";
    });
  });

  document.querySelectorAll('[data-choice-group="payment-document"]').forEach((button) => {
    button.disabled = paymentMeta.blockedByOutcome;
    button.title = paymentMeta.blockedByOutcome ? "Dokument nie jest potrzebny dla tej sesji." : "";
  });

  document.querySelectorAll('[data-choice-group="payment-confirmation-source"]').forEach((button) => {
    const locked = paymentMeta.blockedByOutcome || selectedPaymentStatus !== "paid" || sourceLocked;
    button.disabled = locked;
    button.title = paymentMeta.blockedByOutcome
      ? "Ta sesja nie buduje naleznosci."
      : sourceLocked
        ? "Zrodlo potwierdzenia ustawil import banku."
        : selectedPaymentStatus !== "paid"
          ? "Najpierw oznacz platnosc jako potwierdzona."
          : "";
  });

  if (amountField) {
    amountField.disabled = paymentMeta.blockedByOutcome || sourceLocked;
    amountField.title = paymentMeta.blockedByOutcome
      ? "Kwota nie wymaga rozliczenia dla tej sesji."
      : sourceLocked
        ? "Kwota jest juz zweryfikowana przez import banku."
        : "";
  }

  if (markPaidButton) {
    markPaidButton.disabled = paymentMeta.blockedByOutcome || sourceLocked;
    const editableSource = selectedPaymentStatus === "paid"
      ? editableVisitPaymentConfirmationSource(visit, selectedPaymentStatus, selectedPaymentMethod)
      : "";
    markPaidButton.textContent = sourceLocked
      ? "Powiazane z bankiem"
      : selectedPaymentStatus !== "paid"
        ? "Zapisz rozliczenie"
        : editableSource === "cash"
          ? "Zapisz gotowke"
          : editableSource === "other_account"
            ? "Zapisz inne konto"
            : "Potwierdz bez banku";
    markPaidButton.title = paymentMeta.blockedByOutcome
      ? "Ta sesja nie wymaga rozliczenia."
      : sourceLocked
        ? "Ta platnosc jest juz powiazana z importem bankowym."
        : "";
  }

  if (issueDocumentButton) {
    issueDocumentButton.disabled = paymentMeta.blockedByOutcome;
    issueDocumentButton.title = paymentMeta.blockedByOutcome ? "Dokument nie jest potrzebny dla tej sesji." : "";
  }

  if (paymentBadge) {
    paymentBadge.textContent = paymentMeta.label;
    paymentBadge.className = `badge ${paymentMeta.tone}`;
  }

  if (paymentContext) {
    paymentContext.textContent = paymentMeta.blockedByOutcome
      ? `${visit.patientName} | ${visit.dateLabel} ${visit.time} | bez naleznosci, bo sesja jest oznaczona jako ${outcomeMeta.label}`
      : `${visit.patientName} | ${visit.dateLabel} ${visit.time} | ${paymentMeta.label}`;
  }

  if (paymentSourceHint) {
    if (paymentMeta.blockedByOutcome) {
      paymentSourceHint.textContent = "Ta sesja nie buduje naleznosci, wiec zrodlo potwierdzenia nie jest potrzebne.";
    } else if (sourceLocked) {
      paymentSourceHint.textContent = "Powiazane z realnym wplywem bankowym. To potwierdzenie przyszlo z importu banku.";
    } else if (selectedPaymentStatus !== "paid") {
      paymentSourceHint.textContent = "Najpierw oznacz naleznosc jako potwierdzona. Dopiero wtedy wybierasz, skad mamy to potwierdzenie.";
    } else if (paymentMeta.confirmationSource === "cash") {
      paymentSourceHint.textContent = "Sesja zostanie oznaczona jako rozliczona gotowka.";
    } else if (paymentMeta.confirmationSource === "other_account") {
      paymentSourceHint.textContent = "Sesja zostanie oznaczona jako rozliczona poza importowanym kontem.";
    } else {
      paymentSourceHint.textContent = "To potwierdzenie reczne bez twardego linku do banku. Pozniejszy import moze je jeszcze dopiac do wplywu.";
    }
  }
}

function syncNotesWorkspacePreview(value) {
  const preview = document.getElementById("visit-notes");
  const workspaceInput = document.getElementById("notes-workspace-input");

  if (preview) {
    preview.value = value || "";
  }

  if (workspaceInput && state.notesWorkspaceOpen) {
    workspaceInput.value = value || "";
  }

  renderVisitNotesPreview(getSelectedVisit());
}

function nextVisitChecklistEntry(nextVisit) {
  if (nextVisit.status === "scheduled") {
    return { label: "Kolejna wizyta ustawiona", done: true };
  }

  if (nextVisit.status === "none") {
    return { label: "Brak kontynuacji potwierdzony", done: true };
  }

  return { label: "Termin kolejnej wizyty do wpisania", done: false };
}

function isDocumentRequired(outcome, payment) {
  return Boolean(outcome?.chargeable) && payment?.status !== "ignored" && payment?.documentType !== "none";
}

function derivePaymentFollowUpLabel(payment, documentNeeded) {
  const paidLabel = resolvedPaidPaymentLabel({
    storedLabel: payment?.statusLabel,
    paymentMethod: payment?.method,
    hasBankLink: Boolean(payment?.bankTransactionId),
    confirmationSource: payment?.confirmationSource
  });

  if (payment.status === "paid") {
    return documentNeeded && !payment.documentIssued
      ? `${paidLabel}, dokument do wystawienia`
      : `${paidLabel} po sesji`;
  }

  if (payment.status === "partial") {
    return documentNeeded ? "platnosc czesciowa, dokument do dopilnowania" : "platnosc czesciowa po sesji";
  }

  return documentNeeded ? "oczekuje na platnosc i dokument" : "oczekuje na platnosc po sesji";
}

function buildCloseoutState(visit, visitPatch, paymentPatch) {
  const outcome = getSessionOutcomeMeta(visitPatch?.sessionOutcome || visit.sessionOutcome, visit.dateLabel);
  const nextVisit = visitPatch?.nextVisit || visit.nextVisit;
  const payment = paymentPatch?.payment || visit.payment;
  const summaryText = String(visitPatch?.summary ?? visit.summary ?? "").trim();
  const paymentNeeded = outcome.chargeable && payment.status !== "ignored";
  const documentNeeded = isDocumentRequired(outcome, payment);
  const nextVisitEntry = nextVisitChecklistEntry(nextVisit);

  const checklist = [
    {
      label:
        outcome.key === "completed"
          ? "Sesja oznaczona jako odbyta"
          : outcome.key === "cancelled"
            ? "Sesja oznaczona jako nieodbyta"
            : outcome.key === "rescheduled"
              ? "Sesja oznaczona jako przeniesiona"
              : outcome.key === "no_show_paid"
                ? "Sesja oznaczona jako no-show platny"
                : "Wynik sesji jeszcze nieoznaczony",
      done: outcome.key !== "scheduled"
    },
    { label: summaryText ? "Podsumowanie wizyty uzupelnione" : "Brak podsumowania wizyty", done: Boolean(summaryText) },
    nextVisitEntry,
    {
      label: !paymentNeeded
        ? "Ta sesja nie buduje naleznosci"
        : payment.status === "paid"
          ? `Platnosc ${formatCurrency(payment.amount)}: ${resolvedPaidPaymentLabel({
            storedLabel: payment.statusLabel,
            paymentMethod: payment.method,
            hasBankLink: Boolean(payment.bankTransactionId),
            confirmationSource: payment.confirmationSource
          })}`
          : payment.status === "partial"
            ? `Platnosc ${formatCurrency(payment.amount)} oznaczona jako czesciowa`
            : `Platnosc ${formatCurrency(payment.amount)} nadal oczekuje`,
      done: !paymentNeeded || payment.status === "paid"
    },
    {
      label: !documentNeeded
        ? "Dokument sprzedazy nie jest potrzebny"
        : payment.documentIssued
          ? `${payment.documentType === "invoice" ? "Faktura" : "Paragon"} gotowe`
          : `${payment.documentType === "invoice" ? "Faktura" : "Paragon"} do wystawienia`,
      done: !documentNeeded || payment.documentIssued
    }
  ];

  const remaining = checklist.filter((item) => !item.done);
  return {
    checklist,
    remaining,
    remainingCount: remaining.length,
    paymentNeeded,
    documentNeeded,
    payment,
    outcome,
    nextVisit
  };
}

function getCurrentVisitEditorState() {
  const visit = getSelectedVisit();
  const visitPatch = collectVisitPatch();
  const paymentPatch = collectBillingPatch();

  return {
    visit,
    visitPatch,
    paymentPatch,
    closeoutState: buildCloseoutState(visit, visitPatch, paymentPatch)
  };
}

function renderVisitCloseoutPreview() {
  const list = document.getElementById("visit-closeout-list");
  const badge = document.getElementById("visit-closeout-badge");
  const copy = document.getElementById("visit-closeout-copy");

  if (!list || !badge || !copy) {
    return;
  }

  const { closeoutState } = getCurrentVisitEditorState();
  const remainingLabels = closeoutState.remaining.slice(0, 2).map((item) => item.label.toLowerCase());
  const helper =
    closeoutState.remainingCount === 0
      ? "Mozesz domknac te sesje jednym ruchem."
      : closeoutState.remainingCount === 1
        ? `Brakuje jeszcze: ${remainingLabels[0]}.`
        : `Brakuje jeszcze ${closeoutState.remainingCount} rzeczy, np. ${remainingLabels.join(" i ")}.`;

  copy.textContent = helper;
  badge.textContent = closeoutState.remainingCount === 0
    ? "gotowe do zamkniecia"
    : `${closeoutState.remainingCount} do domkniecia`;
  badge.className = `badge ${closeoutState.remainingCount === 0 ? "success" : "warning"}`;

  list.innerHTML = closeoutState.checklist
    .map((item) => `<li class="${item.done ? "done" : "todo"}">${item.label}</li>`)
    .join("");
}

function getNotesInkCanvas() {
  return document.getElementById("notes-ink-canvas");
}

function getNotesInkStage() {
  return document.getElementById("notes-ink-stage");
}

const NOTES_INK_BRUSH_WIDTHS = {
  thin: 2.2,
  medium: 4,
  bold: 6.8
};

const NOTES_INK_ERASER_WIDTHS = {
  thin: 14,
  medium: 22,
  bold: 32
};

function normalizeNotesInkSnapshot(dataUrl = "") {
  return String(dataUrl || "");
}

function getNotesInkBaseWidth(tool = state.notesInkTool, size = state.notesInkBrushSize) {
  const lookup = tool === "eraser" ? NOTES_INK_ERASER_WIDTHS : NOTES_INK_BRUSH_WIDTHS;
  return lookup[size] || lookup.medium;
}

function resolveNotesInkStrokeWidth(event = null, tool = state.notesInkTool, size = state.notesInkBrushSize) {
  const baseWidth = getNotesInkBaseWidth(tool, size);
  if (tool === "eraser") {
    return baseWidth;
  }

  const pointerType = String(event?.pointerType || "").toLowerCase();
  const rawPressure = Number(event?.pressure);
  const pressure = Number.isFinite(rawPressure) && rawPressure > 0
    ? rawPressure
    : pointerType === "mouse"
      ? 0.7
      : 0.55;

  return Math.max(baseWidth * 0.55, baseWidth * (0.45 + pressure * 0.95));
}

function configureNotesInkContext(context, event = null) {
  if (!context) {
    return null;
  }

  const tool = state.notesInkTool;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
  context.lineWidth = resolveNotesInkStrokeWidth(event, tool, state.notesInkBrushSize);
  context.strokeStyle = "rgba(50, 34, 20, 0.96)";
  context.fillStyle = "rgba(50, 34, 20, 0.96)";
  return context;
}

function getNotesInkContext() {
  const canvas = getNotesInkCanvas();
  if (!canvas) {
    return null;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.lineCap = "round";
  context.lineJoin = "round";
  context.globalCompositeOperation = "source-over";
  context.lineWidth = getNotesInkBaseWidth("pen", "medium");
  context.strokeStyle = "rgba(50, 34, 20, 0.96)";
  context.fillStyle = "rgba(50, 34, 20, 0.96)";
  return context;
}

function resetNotesInkHistory(dataUrl = getActiveNotesInkPageData()) {
  const snapshot = normalizeNotesInkSnapshot(dataUrl);
  state.notesInkHistory = [snapshot];
  state.notesInkHistoryIndex = 0;
}

function recordNotesInkHistorySnapshot(dataUrl = getActiveNotesInkPageData()) {
  const snapshot = normalizeNotesInkSnapshot(dataUrl);
  const currentSnapshot = normalizeNotesInkSnapshot(state.notesInkHistory[state.notesInkHistoryIndex] || "");
  if (snapshot === currentSnapshot) {
    return;
  }

  const nextHistory = state.notesInkHistory.slice(0, state.notesInkHistoryIndex + 1);
  nextHistory.push(snapshot);
  state.notesInkHistory = nextHistory.slice(-40);
  state.notesInkHistoryIndex = state.notesInkHistory.length - 1;
}

function canUndoNotesInk() {
  return state.notesInkHistoryIndex > 0;
}

function undoNotesInkStroke() {
  if (!canUndoNotesInk()) {
    return;
  }

  state.notesInkHistoryIndex -= 1;
  const snapshot = normalizeNotesInkSnapshot(state.notesInkHistory[state.notesInkHistoryIndex] || "");
  setActiveNotesInkPageData(snapshot);
  drawNotesInkSnapshot(snapshot);
}

function setNotesInkTool(tool) {
  state.notesInkTool = tool === "eraser" ? "eraser" : "pen";
}

function setNotesInkBrushSize(size) {
  state.notesInkBrushSize = ["thin", "medium", "bold"].includes(size) ? size : "medium";
}

function getNotesInkHintCopy() {
  const toolLabel = state.notesInkTool === "eraser" ? "gumka" : "pioro";
  const sizeLabel =
    state.notesInkBrushSize === "thin"
      ? "cienka"
      : state.notesInkBrushSize === "bold"
        ? "gruba"
        : "srednia";
  const pageCount = getVisitNotesInkPages().length;
  return `Pisze tylko rysik. Tryb: ${toolLabel}, linia: ${sizeLabel}, strony: ${pageCount}.`;
}

function getNotesInkSampleEvents(event) {
  if (!event) {
    return [];
  }

  const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  return coalesced.length ? coalesced : [event];
}

function drawNotesInkDot(context, point, event) {
  if (!context || !point) {
    return;
  }

  configureNotesInkContext(context, event);
  context.beginPath();
  context.arc(point.x, point.y, Math.max(context.lineWidth / 2, 0.7), 0, Math.PI * 2);
  context.fill();
}

function drawNotesInkSegment(context, fromPoint, toPoint, event) {
  if (!context || !fromPoint || !toPoint) {
    return;
  }

  configureNotesInkContext(context, event);
  context.beginPath();
  context.moveTo(fromPoint.x, fromPoint.y);
  context.lineTo(toPoint.x, toPoint.y);
  context.stroke();
}

function drawNotesInkSnapshot(dataUrl = getActiveNotesInkPageData()) {
  const canvas = getNotesInkCanvas();
  const stage = getNotesInkStage();
  if (!canvas || !stage || stage.hidden) {
    return;
  }

  const deviceScale = Math.max(window.devicePixelRatio || 1, 1);
  const width = Math.max(stage.clientWidth, 320);
  const height = Math.max(stage.clientHeight, 320);

  if (!width || !height) {
    return;
  }

  canvas.width = Math.round(width * deviceScale);
  canvas.height = Math.round(height * deviceScale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const context = getNotesInkContext();
  if (!context) {
    return;
  }

  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  context.clearRect(0, 0, width, height);

  if (!dataUrl) {
    return;
  }

  const image = new Image();
  image.onload = () => {
    const ratio = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  };
  image.src = dataUrl;
}

function exportNotesInkCanvas() {
  const canvas = getNotesInkCanvas();
  if (!canvas) {
    return "";
  }

  return canvas.toDataURL("image/png");
}

function clearNotesInkCanvas() {
  setActiveNotesInkPageData("");
  drawNotesInkSnapshot("");
  recordNotesInkHistorySnapshot("");
}

function notesInkPoint(event, canvas = getNotesInkCanvas()) {
  if (!canvas) {
    return { x: 0, y: 0 };
  }

  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function isHandwritingPointer(event) {
  const pointerType = String(event?.pointerType || "").toLowerCase();
  return pointerType === "pen" || pointerType === "mouse";
}

function isPointerStillPressed(event) {
  if (!event) {
    return false;
  }

  const buttons = Number(event.buttons);
  const pressure = Number(event.pressure);
  return buttons > 0 || pressure > 0;
}

function suppressNotesInkDefaultEvent(event) {
  if (getVisitNotesMode() !== "ink" || !event) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}

function endNotesInkStroke(event = null) {
  const canvas = getNotesInkCanvas();
  if (
    canvas &&
    event?.pointerId !== undefined &&
    event.pointerId === state.notesInkPointerId &&
    canvas.hasPointerCapture?.(event.pointerId)
  ) {
    canvas.releasePointerCapture(event.pointerId);
  }

  if (!state.notesInkDrawing || (event?.pointerId !== undefined && event.pointerId !== state.notesInkPointerId)) {
    return;
  }

  state.notesInkDrawing = false;
  state.notesInkLastPoint = null;
  state.notesInkPointerId = null;
  const snapshot = exportNotesInkCanvas();
  setActiveNotesInkPageData(snapshot);
  recordNotesInkHistorySnapshot(snapshot);
  if (event) {
    event.preventDefault();
  }
}

function startNotesInkStroke(event) {
  if (getVisitNotesMode() !== "ink" || !isHandwritingPointer(event)) {
    return;
  }

  const canvas = getNotesInkCanvas();
  const context = getNotesInkContext();
  if (!canvas || !context) {
    return;
  }

  const point = notesInkPoint(event, canvas);
  state.notesInkDrawing = true;
  state.notesInkLastPoint = point;
  state.notesInkPointerId = event.pointerId;
  canvas.setPointerCapture?.(event.pointerId);
  configureNotesInkContext(context, event);
  drawNotesInkDot(context, point, event);
  event.preventDefault();
}

function moveNotesInkStroke(event) {
  if (
    !state.notesInkDrawing &&
    getVisitNotesMode() === "ink" &&
    isHandwritingPointer(event) &&
    isPointerStillPressed(event)
  ) {
    startNotesInkStroke(event);
    return;
  }

  if (
    !state.notesInkDrawing ||
    getVisitNotesMode() !== "ink" ||
    !isHandwritingPointer(event) ||
    event.pointerId !== state.notesInkPointerId
  ) {
    return;
  }

  const context = getNotesInkContext();
  const canvas = getNotesInkCanvas();
  if (!context || !canvas) {
    return;
  }

  getNotesInkSampleEvents(event).forEach((sample) => {
    const point = notesInkPoint(sample, canvas);
    const previousPoint = state.notesInkLastPoint || point;
    drawNotesInkSegment(context, previousPoint, point, sample);
    state.notesInkLastPoint = point;
  });
  event.preventDefault();
}

function renderNotesWorkspaceMode() {
  const mode = getVisitNotesMode();
  const input = document.getElementById("notes-workspace-input");
  const stage = getNotesInkStage();
  const textButton = document.getElementById("notes-mode-text");
  const inkButton = document.getElementById("notes-mode-ink");
  const penButton = document.getElementById("notes-ink-pen");
  const eraserButton = document.getElementById("notes-ink-eraser");
  const thinButton = document.getElementById("notes-ink-size-thin");
  const mediumButton = document.getElementById("notes-ink-size-medium");
  const boldButton = document.getElementById("notes-ink-size-bold");
  const undoButton = document.getElementById("undo-notes-ink");
  const clearInkButton = document.getElementById("clear-notes-ink");
  const hint = document.querySelector(".notes-ink-copy");

  if (input) {
    input.hidden = mode === "ink";
  }

  if (stage) {
    stage.hidden = mode !== "ink";
    stage.dataset.tool = state.notesInkTool;
  }

  if (textButton) {
    textButton.classList.toggle("active", mode === "text");
  }

  if (inkButton) {
    inkButton.classList.toggle("active", mode === "ink");
  }

  [penButton, eraserButton, thinButton, mediumButton, boldButton, undoButton, clearInkButton].forEach((button) => {
    if (button) {
      button.hidden = mode !== "ink";
      button.disabled = mode !== "ink";
    }
  });

  if (penButton) {
    penButton.classList.toggle("active", mode === "ink" && state.notesInkTool === "pen");
  }

  if (eraserButton) {
    eraserButton.classList.toggle("active", mode === "ink" && state.notesInkTool === "eraser");
  }

  if (thinButton) {
    thinButton.classList.toggle("active", mode === "ink" && state.notesInkBrushSize === "thin");
  }

  if (mediumButton) {
    mediumButton.classList.toggle("active", mode === "ink" && state.notesInkBrushSize === "medium");
  }

  if (boldButton) {
    boldButton.classList.toggle("active", mode === "ink" && state.notesInkBrushSize === "bold");
  }

  if (undoButton) {
    undoButton.disabled = mode !== "ink" || !canUndoNotesInk();
  }

  if (clearInkButton) {
    clearInkButton.disabled = mode !== "ink" || !getActiveNotesInkPageData();
  }

  if (hint) {
    hint.textContent = getNotesInkHintCopy();
  }

  if (mode === "ink") {
    window.requestAnimationFrame(() => drawNotesInkSnapshot());
  }
}

function renderNotesInkPagination() {
  const mode = getVisitNotesMode();
  const pagination = document.getElementById("notes-workspace-pages");
  const pageLabel = document.getElementById("notes-page-label");
  const prevButton = document.getElementById("notes-page-prev");
  const nextButton = document.getElementById("notes-page-next");
  const addButton = document.getElementById("notes-page-add");
  const removeButton = document.getElementById("notes-page-remove");

  if (!pagination || !pageLabel || !prevButton || !nextButton || !addButton || !removeButton) {
    return;
  }

  const pages = getVisitNotesInkPages();
  const pageIndex = clampNotesInkPageIndex(state.notesInkPageIndex, pages);
  state.notesInkPageIndex = pageIndex;

  pagination.hidden = mode !== "ink";
  if (mode !== "ink") {
    return;
  }

  pageLabel.textContent = `Strona ${pageIndex + 1} z ${pages.length}`;
  prevButton.disabled = pageIndex <= 0;
  nextButton.disabled = pageIndex >= pages.length - 1;
  addButton.disabled = pages.length >= 12;
  removeButton.disabled = pages.length <= 1 && !pages[0];
}

function renderNotesWorkspaceControls() {
  const shell = document.querySelector(".notes-workspace-shell");
  const input = document.getElementById("notes-workspace-input");
  const rulingButton = document.getElementById("toggle-notes-ruling");
  const focusButton = document.getElementById("toggle-notes-focus");
  const fontDownButton = document.getElementById("notes-font-down");
  const fontUpButton = document.getElementById("notes-font-up");
  const mode = getVisitNotesMode();
  const shellTool = state.notesInkTool === "eraser" ? "eraser" : "pen";

  if (!shell || !input) {
    return;
  }

  const fontSize = Math.max(0.96, Math.min(1.32, Number(state.notesWorkspaceFontSize || 1.08)));
  shell.classList.toggle("notes-ruled", Boolean(state.notesWorkspaceRuled));
  shell.classList.toggle("notes-focus", Boolean(state.notesWorkspaceFocus));
  shell.dataset.notesTool = shellTool;
  shell.style.setProperty("--notes-font-size", `${fontSize.toFixed(2)}rem`);
  shell.style.setProperty("--notes-line-height", fontSize >= 1.18 ? "1.78" : fontSize <= 1 ? "1.6" : "1.7");

  if (rulingButton) {
    rulingButton.classList.toggle("active", Boolean(state.notesWorkspaceRuled));
    rulingButton.textContent = state.notesWorkspaceRuled ? "Linie on" : "Linie off";
    rulingButton.disabled = mode === "ink";
  }

  if (focusButton) {
    focusButton.classList.toggle("active", Boolean(state.notesWorkspaceFocus));
    focusButton.textContent = state.notesWorkspaceFocus ? "Widok pelny" : "Czysty ekran";
  }

  if (fontDownButton) {
    fontDownButton.disabled = mode === "ink" || fontSize <= 0.96;
  }

  if (fontUpButton) {
    fontUpButton.disabled = mode === "ink" || fontSize >= 1.32;
  }

  renderNotesWorkspaceMode();
  renderNotesInkPagination();
}

function updateNotesWorkspaceMeta(visit = getSelectedVisit()) {
  const title = document.getElementById("notes-workspace-title");
  const meta = document.getElementById("notes-workspace-meta");

  if (!title || !meta || !visit) {
    return;
  }

  title.textContent = `Notatki - ${visit.patientName}`;
  meta.textContent = `${visit.dateLabel} | ${visit.time} | ${visit.serviceName || "sesja"}`;
}

function setNotesWorkspaceVisibility(isVisible) {
  const overlay = document.getElementById("notes-workspace-overlay");
  const workspaceInput = document.getElementById("notes-workspace-input");
  const preview = document.getElementById("visit-notes");

  if (!overlay || !workspaceInput || !preview) {
    return;
  }

  if (isVisible) {
    const visit = getSelectedVisit();
    updateNotesWorkspaceMeta(visit);
    workspaceInput.value = preview.value || "";
    state.notesInkPageIndex = 0;
    resetNotesInkHistory(getActiveNotesInkPageData(visit));
    overlay.hidden = false;
    document.body.classList.add("workspace-open");
    state.notesWorkspaceOpen = true;
    renderNotesWorkspaceControls();
    window.requestAnimationFrame(() => {
      if (getVisitNotesMode(visit) === "ink") {
        drawNotesInkSnapshot(getActiveNotesInkPageData(visit));
        return;
      }

      workspaceInput.focus();
      const end = workspaceInput.value.length;
      workspaceInput.setSelectionRange(end, end);
    });
    return;
  }

  flushNotesInkCanvasToPage();
  preview.value = workspaceInput.value || "";
  overlay.hidden = true;
  document.body.classList.remove("workspace-open");
  state.notesWorkspaceOpen = false;
  renderVisitNotesPreview(getSelectedVisit());
}

function reconciliationPrimaryTarget(match) {
  const targets = [...(match.visibleTargets || match.targets || [])];
  return targets.sort((left, right) => {
    const leftDate = getDateSortValue(left.dateLabel) || 0;
    const rightDate = getDateSortValue(right.dateLabel) || 0;
    if (leftDate !== rightDate) {
      return leftDate - rightDate;
    }

    const leftTime = getTimeSortValue(left.time);
    const rightTime = getTimeSortValue(right.time);
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return String(left.patientName || "").localeCompare(String(right.patientName || ""));
  })[0] || null;
}

function isReconciliationTargetDue(target, scope = "past") {
  const targetDate = getDateSortValue(target?.dateLabel);
  const todayDate = getDateSortValue(getCurrentDateKey()) || 0;

  if (targetDate === null) {
    return false;
  }

  return scope === "past_or_today" ? targetDate <= todayDate : targetDate < todayDate;
}

function getReconciliationDateScopeCopy(scope) {
  if (scope === "past_or_today") {
    return {
      summary: "pozycji z przeszlosci i z dzisiaj",
      empty: "Brak pozycji w tym filtrze dla wizyt z przeszlosci i z dzisiaj."
    };
  }

  return {
    summary: "pozycji z przeszlosci",
    empty: "Brak pozycji w tym filtrze dla wizyt z przeszlosci."
  };
}

function matchPassesReconciliationFilter(match, filterKey) {
  if (filterKey === "all") {
    return true;
  }

  if (filterKey === "confirmed") {
    return match.status === "confirmed" || match.status === "ignored";
  }

  if (filterKey === "missing") {
    return match.status === "missing";
  }

  if (filterKey === "review") {
    return match.status === "suggested" && match.confidence !== "pewne";
  }

  return match.status !== "confirmed" && match.status !== "ignored";
}

function compareReconciliationMatches(left, right) {
  const leftTarget = reconciliationPrimaryTarget(left);
  const rightTarget = reconciliationPrimaryTarget(right);
  const leftDate = getDateSortValue(leftTarget?.dateLabel) || 0;
  const rightDate = getDateSortValue(rightTarget?.dateLabel) || 0;

  if (leftDate !== rightDate) {
    return leftDate - rightDate;
  }

  const leftTime = getTimeSortValue(leftTarget?.time);
  const rightTime = getTimeSortValue(rightTarget?.time);
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return String(leftTarget?.patientName || "").localeCompare(String(rightTarget?.patientName || ""));
}

function syncReconciliationSelection(allSessions) {
  const availableIds = new Set((allSessions || []).map((session) => session.id));
  let selectedIds = normalizeIdList(state.reconciliationSelectedSessionIds).filter((id) => availableIds.has(id));

  if (!selectedIds.length && state.reconciliationSelectedSessionId && availableIds.has(state.reconciliationSelectedSessionId)) {
    selectedIds = [state.reconciliationSelectedSessionId];
  }

  if (!selectedIds.length && allSessions?.length) {
    selectedIds = [allSessions[0].id];
  }

  state.reconciliationSelectedSessionIds = selectedIds;
  if (!selectedIds.includes(state.reconciliationSelectedSessionId)) {
    state.reconciliationSelectedSessionId = selectedIds[0] || null;
  }

  return selectedIds;
}

function resolveTransactionTargetIds(transaction, selectedSessions) {
  const selectedIds = normalizeIdList((selectedSessions || []).map((session) => session.id));
  const selectedTotal = sumAmounts(selectedSessions);
  const suggestedTargets = transaction?.suggestedTargets || [];
  const suggestedIds = normalizeIdList(suggestedTargets.map((session) => session.id));
  const suggestedTotal = sumAmounts(suggestedTargets);
  const transactionAmount = Number(transaction?.amount || 0);

  if (selectedIds.length > 1 && Math.abs(selectedTotal - transactionAmount) < 0.01) {
    return selectedIds;
  }

  if (suggestedIds.length > 1 && Math.abs(suggestedTotal - transactionAmount) < 0.01) {
    return suggestedIds;
  }

  if (selectedIds.length === 1 && Math.abs(selectedTotal - transactionAmount) < 0.01) {
    return selectedIds;
  }

  if (suggestedIds.length === 1) {
    return suggestedIds;
  }

  return selectedIds.length ? [selectedIds[0]] : [];
}

function renderPatientReconciliation() {
  const panel = document.getElementById("patient-reconciliation-panel");
  const ledger = state.reconciliationLedger;

  if (!panel) {
    return;
  }

  if (!ledger) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  const allSessions = ledger.sessions || [];
  const settledSessions = ledger.settledSessions || [];
  const allTransactions = ledger.transactions || [];
  const usedTransactions = ledger.usedTransactions || [];
  const summary = ledger.summary || {};
  const selectedSessionIds = syncReconciliationSelection(allSessions);
  const selectedSessions = allSessions.filter((session) => selectedSessionIds.includes(session.id));
  const selectedSession = allSessions.find((session) => session.id === state.reconciliationSelectedSessionId) || selectedSessions[0] || null;
  const selectedTotal = sumAmounts(selectedSessions);
  const focusedTransaction = allTransactions.find((transaction) => transaction.id === state.reconciliationFocusTransactionId) || null;
  const settledHistory = [...settledSessions].sort(compareSessionDateTimeDesc);
  const usedTransactionHistory = [...usedTransactions].sort(compareTransactionHistoryDesc);

  const filteredSessions = allSessions.filter((session) => {
    if (state.reconciliationSessionFilter === "selected") {
      return selectedSessionIds.includes(session.id);
    }

    if (state.reconciliationSessionFilter === "nearby" && focusedTransaction) {
      const sameAmount = Math.abs(Number(session.amount || 0) - Number(focusedTransaction.amount || 0)) < 0.01;
      const distance = Math.abs(dateDistanceBetween(session.dateLabel, focusedTransaction.transactionDate));
      return sameAmount && distance <= 21;
    }

    return true;
  });

  const filteredTransactions = allTransactions.filter((transaction) => {
    if (!selectedSessions.length) {
      return true;
    }

    const suggestedIds = normalizeIdList(transaction.suggestedTargetIds || []);
    const sameAmount = Math.abs(Number(transaction.amount || 0) - Number(selectedTotal || 0)) < 0.01;
    const distance = Math.min(
      ...selectedSessions.map((session) => Math.abs(dateDistanceBetween(session.dateLabel, transaction.transactionDate)))
    );

    if (state.reconciliationTransactionFilter === "recommended") {
      if (suggestedIds.length) {
        return selectedSessionIds.every((sessionId) => suggestedIds.includes(sessionId));
      }

      return selectedSessionIds.length === 1 && transaction.bestSessionId === selectedSessionIds[0];
    }

    if (state.reconciliationTransactionFilter === "nearby") {
      return sameAmount && distance <= 21;
    }

    return true;
  });
  const sessionCopy = selectedSession
    ? selectedSessions.length > 1
      ? `${selectedSessions.length} sesje - ${formatCurrency(selectedTotal)}`
      : `${selectedSession.dateLabel} ${selectedSession.time || ""} - ${formatCurrency(selectedSession.amount)}`
    : "Brak otwartej sesji";

  panel.hidden = false;
  panel.innerHTML = `
    <div class="patient-reconciliation-card">
      <div class="panel-header compact-header">
        <div>
          <p class="panel-label">Rozlicz pacjenta</p>
          <h3>${ledger.patientName}</h3>
          <span>${selectedSessions.length > 1 ? "Wybrane sesje" : "Wybrana sesja"}: ${sessionCopy}</span>
        </div>
        <button class="ghost close-patient-reconciliation" type="button">Zamknij</button>
      </div>

      <div class="ledger-balance-grid">
        <article class="ledger-balance-card">
          <span>Sesje lacznie</span>
          <strong>${summary.totalSessions || 0}</strong>
        </article>
        <article class="ledger-balance-card">
          <span>Otwarte</span>
          <strong>${summary.openSessions || 0}</strong>
          <small>${formatCurrency(summary.openAmount || 0)}</small>
        </article>
        <article class="ledger-balance-card">
          <span>Rozliczone</span>
          <strong>${summary.settledSessions || 0}</strong>
          <small>${formatCurrency(summary.settledAmount || 0)}</small>
        </article>
        <article class="ledger-balance-card">
          <span>Wolne wplywy</span>
          <strong>${summary.availableTransactions || 0}</strong>
        </article>
        <article class="ledger-balance-card">
          <span>Wykorzystane wplywy</span>
          <strong>${summary.usedTransactions || 0}</strong>
        </article>
        <article class="ledger-balance-card">
          <span>Poza bankiem</span>
          <strong>${summary.externalSettledSessions || 0}</strong>
        </article>
      </div>

      <div class="ledger-filter-bar">
        <label>
          Sesje
          <select id="ledger-session-filter">
            <option value="selected" ${state.reconciliationSessionFilter === "selected" ? "selected" : ""}>Tylko wybrana</option>
            <option value="nearby" ${state.reconciliationSessionFilter === "nearby" ? "selected" : ""}>Blisko platnosci</option>
            <option value="all" ${state.reconciliationSessionFilter === "all" ? "selected" : ""}>Wszystkie</option>
          </select>
        </label>
        <label>
          Platnosci
          <select id="ledger-transaction-filter">
            <option value="recommended" ${state.reconciliationTransactionFilter === "recommended" ? "selected" : ""}>Najbardziej pasujace</option>
            <option value="nearby" ${state.reconciliationTransactionFilter === "nearby" ? "selected" : ""}>Blisko sesji</option>
            <option value="all" ${state.reconciliationTransactionFilter === "all" ? "selected" : ""}>Wszystkie</option>
          </select>
        </label>
      </div>

      <div class="patient-reconciliation-grid">
        <section>
          <div class="ledger-column-header">
            <strong>Sesje do rozliczenia</strong>
            <span>${filteredSessions.length} / ${allSessions.length}</span>
          </div>
          <div class="ledger-selection-meta">
            <span>Zaznacz kilka sesji, jesli jedna platnosc obejmuje zalegle i kolejna wizyte.</span>
            <strong>${selectedSessions.length} wybrane - ${formatCurrency(selectedTotal)}</strong>
          </div>
          <div class="ledger-list compact-ledger-list">
            ${
              filteredSessions.length
                ? filteredSessions
                    .map((session) => `
                      <button class="ledger-session ${selectedSessionIds.includes(session.id) ? "selected" : ""}" type="button" data-ledger-session-id="${session.id}">
                        <div>
                          <strong>${session.dateLabel} ${session.time || ""}</strong>
                          <span>${session.sessionOutcomeLabel || "do rozliczenia"}</span>
                        </div>
                        <span>${formatCurrency(session.amount)}</span>
                      </button>
                    `)
                    .join("")
                : `<div class="empty-state">Brak sesji w tym filtrze.</div>`
            }
          </div>
          ${
            selectedSession && selectedSessions.length === 1
              ? `
                <div class="external-payment-actions ledger-exception-actions">
                  <button class="ghost ledger-session-outcome" type="button" data-target-id="${selectedSession.id}" data-outcome="cancelled">Nie odbyla sie</button>
                  <button class="ghost ledger-session-outcome" type="button" data-target-id="${selectedSession.id}" data-outcome="rescheduled">Przeniesiona</button>
                  <button class="ghost ledger-session-outcome" type="button" data-target-id="${selectedSession.id}" data-outcome="no_show_paid">No-show platny</button>
                </div>
                <div class="external-payment-actions ledger-exception-actions">
                  <button class="secondary external-payment-match" type="button" data-target-id="${selectedSession.id}" data-method="cash" data-remember="false">Gotowka</button>
                  <button class="secondary external-payment-match" type="button" data-target-id="${selectedSession.id}" data-method="other_account" data-remember="false">Inne konto</button>
                  <button class="ghost external-payment-match" type="button" data-target-id="${selectedSession.id}" data-method="ignored" data-remember="false">Pomin</button>
                </div>
              `
              : selectedSessions.length > 1
                ? `<div class="ledger-selection-note">Akcje typu "Nie odbyla sie" lub "Gotowka" dzialaja dla jednej sesji. Przy kilku zaznaczonych pozycjach mozna podpiac wspolny przelew.</div>`
                : ""
          }
        </section>

        <section>
          <div class="ledger-column-header">
            <strong>Wplywy do wyboru</strong>
            <span>${filteredTransactions.length} / ${allTransactions.length}</span>
          </div>
          <div class="ledger-list compact-ledger-list">
            ${
              filteredTransactions.length
                ? filteredTransactions
                    .map((transaction) => {
                      const actionTargetIds = resolveTransactionTargetIds(transaction, selectedSessions);
                      const suggestedTargets = transaction.suggestedTargets || [];
                      const suggestionCopy = suggestedTargets.length
                        ? suggestedTargets.map((target) => `${target.dateLabel}${target.time ? ` ${target.time}` : ""}`).join(", ")
                        : "";
                      const actionLabel = actionTargetIds.length > 1 ? `Podepnij ${actionTargetIds.length} sesje` : "Podepnij";
                      const isRecommended = normalizeIdList(transaction.suggestedTargetIds || []).some((id) => selectedSessionIds.includes(id));
                      return `
                      <article class="ledger-transaction ${isRecommended ? "recommended" : ""}">
                        <div>
                          <strong>${transaction.transactionDate} - ${transaction.counterparty}</strong>
                          <span>${transaction.title || "bez tytulu"}</span>
                          ${suggestionCopy ? `<small class="ledger-transaction-hint">Sesje: ${suggestionCopy}</small>` : ""}
                          <div class="reconciliation-signals">
                            ${(transaction.reasons || []).slice(0, 3).map((reason) => `<span>${reason}</span>`).join("")}
                          </div>
                        </div>
                        <div class="ledger-transaction-actions">
                          <strong>${formatCurrency(transaction.amount)}</strong>
                          <button class="primary ledger-link-payment" type="button" data-target-ids="${actionTargetIds.join(",")}" data-transaction-id="${transaction.id}" ${actionTargetIds.length ? "" : "disabled"}>${actionLabel}</button>
                        </div>
                      </article>
                    `;
                    })
                    .join("")
                : `<div class="empty-state">Brak platnosci w tym filtrze.</div>`
            }
          </div>
        </section>
      </div>

      <div class="ledger-history-grid">
        <section>
          <div class="ledger-column-header">
            <strong>Juz rozliczone sesje</strong>
            <span>${settledHistory.length}</span>
          </div>
          <div class="ledger-history-list">
            ${
              settledHistory.length
                ? settledHistory
                    .map((session) => `
                      <article class="ledger-history-item">
                        <div>
                          <strong>${session.dateLabel} ${session.time || ""}</strong>
                          <span>${getLedgerSessionPaymentLabel(session)}</span>
                        </div>
                        <div class="ledger-history-meta">
                          <strong>${formatCurrency(session.amount)}</strong>
                          <span>${session.paidAt || session.paymentMethod || ""}</span>
                        </div>
                      </article>
                    `)
                    .join("")
                : `<div class="empty-state">Brak rozliczonych sesji dla tego pacjenta.</div>`
            }
          </div>
        </section>

        <section>
          <div class="ledger-column-header">
            <strong>Juz wykorzystane wplywy</strong>
            <span>${usedTransactionHistory.length}</span>
          </div>
          <div class="ledger-history-list">
            ${
              usedTransactionHistory.length
                ? usedTransactionHistory
                    .map((transaction) => `
                      <article class="ledger-history-item">
                        <div>
                          <strong>${transaction.transactionDate} - ${transaction.counterparty}</strong>
                          <span>${transaction.title || "bez tytulu"}</span>
                          <small>${(transaction.matchedTargets || []).map((target) => `${target.dateLabel} ${target.time || ""}`).join(", ")}</small>
                        </div>
                        <div class="ledger-history-meta">
                          <strong>${formatCurrency(transaction.amount)}</strong>
                        </div>
                      </article>
                    `)
                    .join("")
                : `<div class="empty-state">Brak wykorzystanych wplywow w tym pacjencie.</div>`
            }
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderReconciliation() {
  const reconciliation = state.data.paymentMatches || { summary: {}, matches: [] };
  const matches = reconciliation.matches || [];
  const dateScopeCopy = getReconciliationDateScopeCopy(state.reconciliationDateScope);
  const dueMatches = matches
    .map((match) => ({
      ...match,
      visibleTargets: (match.targets || []).filter((target) => isReconciliationTargetDue(target, state.reconciliationDateScope))
    }))
    .filter((match) => match.visibleTargets.length);
  const sortedMatches = [...dueMatches].sort(compareReconciliationMatches);
  const filteredMatches = sortedMatches.filter((match) => matchPassesReconciliationFilter(match, state.reconciliationListFilter));
  const visibleMatches = filteredMatches.slice(0, 500);
  const sessionIds = new Set();
  const transactionIds = new Set();

  dueMatches.forEach((match) => {
    (match.visibleTargets || []).forEach((target) => sessionIds.add(target.id));
    if (match.transaction?.id) {
      transactionIds.add(match.transaction.id);
    }
  });

  const summary = {
    sessions: sessionIds.size,
    transactions: transactionIds.size,
    confident: dueMatches.filter((match) => match.status === "suggested" && match.confidence === "pewne").length,
    review: dueMatches.filter((match) => match.status === "suggested" && match.confidence !== "pewne").length,
    missing: dueMatches.filter((match) => match.status === "missing").length,
    confirmed: dueMatches.filter((match) => match.status === "confirmed").length
  };

  document.getElementById("reconciliation-summary").innerHTML = `
    <article><span>Sesje</span><strong>${summary.sessions || 0}</strong></article>
    <article><span>Wplywy</span><strong>${summary.transactions || 0}</strong></article>
    <article><span>Pewne</span><strong>${summary.confident || 0}</strong></article>
    <article><span>Do sprawdzenia</span><strong>${summary.review || 0}</strong></article>
    <article><span>Brak platnosci</span><strong>${summary.missing || 0}</strong></article>
    <article><span>Potwierdzone</span><strong>${summary.confirmed || 0}</strong></article>
  `;

  renderPatientReconciliation();

  if (!dueMatches.length) {
    document.getElementById("reconciliation-list").innerHTML = `
      <div class="empty-state">Brak pozycji do rozliczenia z przeszlosci. Dzisiejsze i przyszle wizyty nie sa tu pokazywane.</div>
    `;
    return;
  }

  const itemsHtml = visibleMatches
    .map((match) => {
      const visibleTargets = match.visibleTargets || match.targets || [];
      const targetCopy = visibleTargets
        .map((target) => `${target.dateLabel} ${target.time || ""} - ${target.patientName} - ${formatCurrency(target.amount)}`)
        .join("<br />");
      const firstTargetId = visibleTargets[0]?.id || "";
      const firstPatientName = visibleTargets[0]?.patientName || "";
      const openPatientButton = firstPatientName
        ? `<button class="ghost open-patient-reconciliation" type="button" data-patient-name="${encodeURIComponent(firstPatientName)}" data-target-id="${firstTargetId}" data-transaction-id="${match.transaction?.id || ""}">Rozlicz pacjenta</button>`
        : "";
      const transactionCopy = match.externalPayment
        ? `Platnosc poza bankiem: ${match.externalPayment.label}`
        : match.transaction
          ? `${match.transaction.transactionDate} - ${match.transaction.counterparty}<br />${match.transaction.title || "bez tytulu"}`
          : "Nie znaleziono pasujacego wplywu";
      const reasonsCopy = (match.reasons || [])
        .slice(0, 5)
        .map((reason) => `<span>${reason}</span>`)
        .join("");
      const alternativesCopy = (match.alternatives || [])
        .slice(0, 3)
        .map((candidate) => `
          <button class="ghost manual-payment-match" type="button" data-target-id="${firstTargetId}" data-transaction-id="${candidate.id}">
            <strong>${candidate.transactionDate} - ${candidate.counterparty} - ${formatCurrency(candidate.amount)}</strong>
            <span>${candidate.title || "bez tytulu"}</span>
          </button>
        `)
        .join("");
      const badgeClass =
        match.status === "confirmed" ? "success" : match.status === "missing" ? "warning" : match.confidence === "pewne" ? "success" : "neutral";
      const paymentExceptionActions =
        match.status === "missing"
            ? `
              <div class="external-payment-actions">
                <button class="secondary external-payment-match" type="button" data-target-id="${firstTargetId}" data-method="cash" data-remember="false">Gotowka</button>
                <button class="secondary external-payment-match" type="button" data-target-id="${firstTargetId}" data-method="other_account" data-remember="false">Inne konto</button>
                <button class="ghost external-payment-match" type="button" data-target-id="${firstTargetId}" data-method="ignored" data-remember="false">Pomin</button>
              </div>
            `
            : "";
      const actionsCopy =
        match.transaction && match.status !== "confirmed"
          ? `
            <button class="primary confirm-payment-match" type="button" data-match-id="${match.id}">Potwierdz</button>
            <button class="secondary remember-payer-match" type="button" data-match-id="${match.id}">Potwierdz + zapamietaj platnika</button>
            <button class="ghost reject-payment-match" type="button" data-match-id="${match.id}">To nie ta platnosc</button>
          `
          : paymentExceptionActions;

      return `
        <article class="reconciliation-item ${match.status}">
          <div class="reconciliation-target">
            <strong>${targetCopy}</strong>
            <span>${
              match.kind === "group"
                ? "platnosc zbiorcza"
                : match.kind === "missing"
                  ? "brak dopasowania"
                  : match.kind === "external"
                    ? "platnosc poza bankiem"
                    : match.kind === "ignored"
                      ? "pominieto"
                      : "pojedyncza sesja"
            }</span>
          </div>
          <div class="reconciliation-transaction">
            <span>${transactionCopy}</span>
            ${reasonsCopy ? `<div class="reconciliation-signals">${reasonsCopy}</div>` : ""}
            ${alternativesCopy ? `<div class="manual-payment-options"><small>Mozliwe wplywy do recznego podpiecia:</small>${alternativesCopy}</div>` : ""}
          </div>
          <div class="reconciliation-result">
            <span class="badge ${badgeClass}">${match.status === "confirmed" ? "potwierdzone" : match.confidence}</span>
            <strong>${match.transaction ? formatSignedCurrency(match.delta) : formatCurrency(match.delta)}</strong>
            ${actionsCopy}
            ${openPatientButton}
          </div>
        </article>
      `;
    })
    .join("");

  document.getElementById("reconciliation-list").innerHTML = `
    <div class="reconciliation-toolbar">
      <div class="reconciliation-toolbar-filters">
        <label>
          Pokaz
          <select id="reconciliation-status-filter">
            <option value="open" ${state.reconciliationListFilter === "open" ? "selected" : ""}>Otwarte</option>
            <option value="review" ${state.reconciliationListFilter === "review" ? "selected" : ""}>Do sprawdzenia</option>
            <option value="missing" ${state.reconciliationListFilter === "missing" ? "selected" : ""}>Brak platnosci</option>
            <option value="confirmed" ${state.reconciliationListFilter === "confirmed" ? "selected" : ""}>Potwierdzone</option>
            <option value="all" ${state.reconciliationListFilter === "all" ? "selected" : ""}>Wszystkie</option>
          </select>
        </label>
        <label>
          Zakres
          <select id="reconciliation-date-scope">
            <option value="past" ${state.reconciliationDateScope === "past" ? "selected" : ""}>Tylko przeszle</option>
            <option value="past_or_today" ${state.reconciliationDateScope === "past_or_today" ? "selected" : ""}>Przeszle + dzis</option>
          </select>
        </label>
      </div>
      <span>${filteredMatches.length} ${dateScopeCopy.summary}, sort po dacie wizyty</span>
    </div>
      ${
        visibleMatches.length
          ? itemsHtml
          : `<div class="empty-state">${dateScopeCopy.empty}</div>`
      }
    `;
}

function renderStats() {
  const stats = getMonthlyStats();

  document.getElementById("stats-metrics").innerHTML = `
    <article class="metric-card">
      <p>${stats.monthLabel}</p>
      <strong>${stats.sessionCount} sesji</strong>
      <span>${state.data.meta.newPatients} nowych pacjentow, reszta to kontynuacje</span>
    </article>
    <article class="metric-card">
      <p>Przychod</p>
      <strong>${formatCurrency(stats.due)}</strong>
      <span>${formatCurrency(stats.paid)} oplacone, ${formatCurrency(stats.pending)} oczekuje</span>
    </article>
    <article class="metric-card">
      <p>Skutecznosc dnia</p>
      <strong>${stats.closureRate}%</strong>
      <span>Wizyty zamkniete bez zostawiania luznych koncowek</span>
    </article>
  `;

  document.getElementById("stats-table").innerHTML = `
    <div><span>Srednia cena sesji</span><strong>${formatCurrency(stats.average)}</strong></div>
    <div><span>Wizyty bez kolejnego terminu</span><strong>${stats.unscheduled}</strong></div>
    <div><span>Zalegle platnosci</span><strong>${stats.pendingPayments}</strong></div>
    <div><span>Oblozenie tygodnia</span><strong>${stats.occupancy}%</strong></div>
  `;

  document.getElementById("insight-copy").textContent =
    `Masz ${state.data.meta.openSlots} wolne sloty tygodniowo. Przy obecnej cenie sesji to okolo ${formatCurrency(
      state.data.meta.openSlots * stats.average * 4
    )} dodatkowego przychodu miesiecznie.`;
}

async function saveVisit(patch, message) {
  const visit = getSelectedVisit();
  setSaveStatus("Zapisywanie...", "pending");

  const response = await fetch(`/api/visits/${visit.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie zapisac zmian.", "error");
    return false;
  }

  const updatedVisit = await response.json();
  await refreshBootstrapData();
  await refreshOpenPatientReconciliation();
  state.selectedVisitId = updatedVisit.id;
  state.selectedPatientName = updatedVisit.patientName;
  setSaveStatus(message, "success");
  renderAll();
  return true;
}

async function promoteImportRow(importId, rowId) {
  setSaveStatus("Przenoszenie importu do workflow...", "pending");

  const response = await fetch(`/api/imports/${importId}/rows/${rowId}/promote`, {
    method: "POST"
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie przeniesc rekordu z importu.", "error");
    return;
  }

  const updatedRow = await response.json();
  const importBatch = getImports().find((item) => item.id === importId);
  const row = (importBatch.rows || []).find((item) => item.id === rowId);

  if (row) {
    Object.assign(row, updatedRow);
  }

  await refreshBootstrapData();
  state.activeDateKey = normalizeDateKey(updatedRow.dateLabel) || state.activeDateKey;
  state.selectedImportId = importId;
  state.selectedPatientName = updatedRow.patientName || state.selectedPatientName;
  state.selectedVisitId = updatedRow.linkedVisitId || state.selectedVisitId;
  renderAll();
  setActiveView("visit");
  setSaveStatus("Rekord z importu przeniesiony do workflow DocDash.", "success");
}

async function promoteActiveDayToWorkflow() {
  if (!state.activeDateKey) {
    setSaveStatus("Brak aktywnego dnia do przejecia.", "error");
    return;
  }

  const pendingRows = getActiveDateImportRows();
  if (!pendingRows.length) {
    setSaveStatus("Ten dzien jest juz przejety do DocDash.", "idle");
    return;
  }

  setSaveStatus("Przejmuje caly dzien do sesji DocDash...", "pending");

  const response = await fetch("/api/imports/promote-day", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateLabel: state.activeDateKey })
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie przejac calego dnia do sesji.", "error");
    return;
  }

  const result = await response.json();
  await refreshBootstrapData();

  const firstVisit = result.promotedVisits?.[0];
  if (firstVisit?.visitId) {
    state.selectedVisitId = firstVisit.visitId;
    state.selectedPatientName = firstVisit.patientName || state.selectedPatientName;
  }

  renderAll();
  setActiveView("dashboard");
  setSaveStatus(
    result.promotedCount
      ? `Przejeto ${result.promotedCount} ${result.promotedCount === 1 ? "wpis" : result.promotedCount < 5 ? "wpisy" : "wpisow"} z ${state.activeDateKey} do sesji DocDash.`
      : `Na ${state.activeDateKey} nie bylo juz nic do przejecia.`,
    "success"
  );
}

function setCreateVisitPanelVisibility(isVisible) {
  const panel = document.getElementById("create-visit-panel");
  panel.hidden = !isVisible;

  if (isVisible) {
    document.getElementById("create-date-label").value = state.activeDateKey || getCurrentDateKey();
    document.getElementById("create-time").value = "";
    document.getElementById("create-patient-name").focus();
  }
}

function setDataToolsPanelVisibility(isVisible) {
  dataToolsPanel.hidden = !isVisible;

  if (!isVisible) {
    dataStoreFileInput.value = "";
  }
}

async function refreshBootstrapData(options = {}) {
  const response = await fetchWithTimeout("/api/bootstrap", {}, options.timeoutMs || 0);

  if (response.status === 401) {
    window.location.href = "/login.html";
    return false;
  }

  state.data = await response.json();
  return true;
}

async function fetchPatientReconciliation(patientName) {
  const response = await fetch(`/api/reconciliation/patient?name=${encodeURIComponent(patientName)}`);
  if (!response.ok) {
    return null;
  }

  return response.json();
}

async function openPatientReconciliation(patientName, focusSessionId = null, focusTransactionId = null) {
  setSaveStatus("Laduje rozliczenie pacjenta...", "pending");
  const ledger = await fetchPatientReconciliation(patientName);

  if (!ledger) {
    setSaveStatus("Nie udalo sie pobrac rozliczenia pacjenta.", "error");
    return;
  }

  if (ledger.paymentMatches) {
    state.data = {
      ...state.data,
      paymentMatches: ledger.paymentMatches
    };

    if (state.activeView === "patients") {
      renderPatients();
      attachActions();
    }
  }

  state.reconciliationLedger = ledger;
  state.reconciliationSelectedSessionId = ledger.sessions?.some((session) => session.id === focusSessionId)
    ? focusSessionId
    : ledger.sessions?.[0]?.id || null;
  state.reconciliationSelectedSessionIds = state.reconciliationSelectedSessionId ? [state.reconciliationSelectedSessionId] : [];
  state.reconciliationSessionFilter = focusSessionId ? "selected" : "all";
  state.reconciliationTransactionFilter = focusTransactionId ? "recommended" : "all";
  state.reconciliationFocusTransactionId = focusTransactionId || null;
  renderAll();
  setActiveView("billing");
  setSaveStatus("", "idle");
}

async function refreshOpenPatientReconciliation() {
  if (!state.reconciliationLedger?.patientName) {
    return;
  }

  const previousSessionId = state.reconciliationSelectedSessionId;
  const previousSessionIds = normalizeIdList(state.reconciliationSelectedSessionIds);
  const ledger = await fetchPatientReconciliation(state.reconciliationLedger.patientName);
  state.reconciliationLedger = ledger;
  state.reconciliationSelectedSessionId = ledger?.sessions?.some((session) => session.id === previousSessionId)
    ? previousSessionId
    : ledger?.sessions?.[0]?.id || null;
  state.reconciliationSelectedSessionIds = previousSessionIds.filter((sessionId) => ledger?.sessions?.some((session) => session.id === sessionId));
  if (!state.reconciliationSelectedSessionIds.length && state.reconciliationSelectedSessionId) {
    state.reconciliationSelectedSessionIds = [state.reconciliationSelectedSessionId];
  }
  if (!ledger) {
    state.reconciliationFocusTransactionId = null;
  }
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.includes(",") ? result.split(",").pop() : result);
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isValidStorePayload(payload) {
  return Boolean(payload && payload.meta && Array.isArray(payload.visits) && Array.isArray(payload.imports));
}

async function importDataStore() {
  const file = dataStoreFileInput.files?.[0];

  if (!file) {
    setSaveStatus("Wybierz plik store.json do importu.", "error");
    return;
  }

  setSaveStatus("Wczytuje plik z danymi...", "pending");

  try {
    const payload = await readJsonFile(file);

    if (!isValidStorePayload(payload)) {
      setSaveStatus("To nie wyglada jak poprawny plik DocDash store.json.", "error");
      return;
    }

    const response = await fetch("/api/data/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      setSaveStatus("Import danych nie powiodl sie.", "error");
      return;
    }

    const result = await response.json();
    await refreshBootstrapData();
    setDataToolsPanelVisibility(false);
    renderAll();
    setSaveStatus(`Zaimportowano dane: ${result.visits} wizyt, ${result.imports} importow.`, "success");
  } catch (error) {
    setSaveStatus("Nie udalo sie odczytac pliku JSON.", "error");
  }
}

async function runReconciliationImport() {
  const zlFile = document.getElementById("reconciliation-zl-file").files?.[0];
  const bankFile = document.getElementById("reconciliation-bank-file").files?.[0];

  if (!zlFile && !bankFile) {
    setSaveStatus("Wybierz plik ZL albo CSV z banku.", "error");
    setReconciliationImportStatus("Najpierw wybierz plik ZL albo CSV z banku.", "error");
    return;
  }

  setSaveStatus("Importuje pliki i dopasowuje platnosci...", "pending");
  setReconciliationImportPending(true);
  setReconciliationImportStatus("Przygotowuje pliki do importu...", "pending");
  const stopStatusTimers = startReconciliationImportStatusTimers();

  try {
    const payload = {};

    if (zlFile) {
      payload.zlFileName = zlFile.name;
      payload.zlBase64 = await readFileAsBase64(zlFile);
    }

    if (bankFile) {
      payload.bankFileName = bankFile.name;
      payload.bankBase64 = await readFileAsBase64(bankFile);
    }

    setReconciliationImportStatus("Wysylam pliki na serwer i przeliczam dopasowania...", "pending");

    const response = await fetchWithTimeout("/api/reconciliation/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, 90000);

    if (!response.ok) {
      let errorMessage = "Nie udalo sie zaimportowac plikow do rozliczen.";
      try {
        const errorPayload = await response.json();
        if (errorPayload?.error) {
          errorMessage = errorPayload.error;
        }
      } catch (error) {
        // Ignore JSON parsing problems and use the fallback message.
      }

      setSaveStatus(errorMessage, "error");
      setReconciliationImportStatus(errorMessage, "error");
      return;
    }

      const result = await response.json();
      setReconciliationImportStatus("Import zapisany. Odswiezam widok danych...", "pending");
      await refreshBootstrapData({ timeoutMs: 30000 });
      if (result.zl?.id) {
        state.selectedImportId = result.zl.id;
        state.showImportArchive = false;
      }
      await refreshOpenPatientReconciliation();
      renderAll();
      const importedParts = [];
      if (result.zl) {
        importedParts.push(`ZL: ${result.zl.rows} wizyt`);
    }

    if (result.bank) {
      importedParts.push(`bank: ${result.bank.transactions} wplywow`);
    }

    setReconciliationImportStatus(
      `Gotowe. Zaimportowano ${importedParts.join(", ") || "pliki"} i przeliczono dopasowania.`,
      "success"
    );
    setSaveStatus(
      `Dopasowanie gotowe: ${result.paymentMatches.summary.suggested} propozycji, ${result.paymentMatches.summary.missing} bez platnosci.`,
      "success"
    );
  } catch (error) {
    const aborted = error?.name === "AbortError";
    const message = aborted
      ? "Import trwa zbyt dlugo. Sprobuj mniejszy zakres pliku albo ponow za chwile."
      : "Nie udalo sie odczytac plikow rozliczeniowych.";
    setSaveStatus(message, "error");
    setReconciliationImportStatus(message, "error");
  } finally {
    stopStatusTimers();
    setReconciliationImportPending(false);
  }
}

async function confirmPaymentMatch(matchId, rememberPayer = false) {
  setSaveStatus(rememberPayer ? "Potwierdzam platnosc i zapamietuje platnika..." : "Potwierdzam platnosc...", "pending");

  const response = await fetch(`/api/reconciliation/matches/${encodeURIComponent(matchId)}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rememberPayer })
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie potwierdzic platnosci.", "error");
    return;
  }

  const result = await response.json();
  await refreshBootstrapData();
  await refreshOpenPatientReconciliation();
  renderAll();
  setActiveView("billing");
  setSaveStatus(
    rememberPayer && result.aliasesAdded
      ? `Platnosc potwierdzona. Zapamietano ${result.aliasesAdded} powiazanie platnika.`
      : "Platnosc potwierdzona i przypisana do sesji.",
    "success"
  );
}

async function rejectPaymentMatch(matchId) {
  setSaveStatus("Odrzucam bledne dopasowanie...", "pending");

  const response = await fetch(`/api/reconciliation/matches/${encodeURIComponent(matchId)}/reject`, {
    method: "POST"
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie odrzucic dopasowania.", "error");
    return;
  }

  await refreshBootstrapData();
  await refreshOpenPatientReconciliation();
  renderAll();
  setActiveView("billing");
  setSaveStatus("Dopasowanie odrzucone. Ta para nie bedzie juz proponowana.", "success");
}

async function confirmManualPaymentMatch(targetIds, transactionId) {
  setSaveStatus("Podpinam recznie wplyw i zapamietuje platnika...", "pending");

  const response = await fetch("/api/reconciliation/manual-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetIds: normalizeIdList(targetIds), transactionId, rememberPayer: true })
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie recznie podpiac wplywu.", "error");
    return;
  }

  const result = await response.json();
  await refreshBootstrapData();
  await refreshOpenPatientReconciliation();
  renderAll();
  setActiveView("billing");
  setSaveStatus(
    result.aliasesAdded
      ? `Wplyw podpiety. Zapamietano ${result.aliasesAdded} powiazanie platnika.`
      : "Wplyw podpiety do sesji.",
    "success"
  );
}

async function confirmExternalPayment(targetId, method, rememberPatient = false) {
  const methodCopy = method === "cash" ? "gotowke" : method === "ignored" ? "pomijam pozycje" : "platnosc z innego konta";
  setSaveStatus(`${methodCopy.charAt(0).toUpperCase()}${methodCopy.slice(1)}...`, "pending");

  const response = await fetch("/api/reconciliation/external-payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, method, rememberPatient })
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie oznaczyc tej pozycji.", "error");
    return;
  }

  const result = await response.json();
  await refreshBootstrapData();
  await refreshOpenPatientReconciliation();
  renderAll();
  setActiveView("billing");
  setSaveStatus(
    rememberPatient && result.rulesAdded
      ? "Pozycja oznaczona i zapamietano sposob platnosci pacjenta."
      : method === "ignored"
        ? "Pozycja pominieta w rozliczeniach."
        : "Pozycja oznaczona jako rozliczona poza importowanym kontem.",
    "success"
  );
}

async function updateReconciliationSessionOutcome(targetId, outcome) {
  const outcomeMeta = getSessionOutcomeMeta(outcome, getCurrentDateKey());
  setSaveStatus(`Oznaczam sesje jako ${outcomeMeta.label}...`, "pending");

  const response = await fetch("/api/reconciliation/session-outcome", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetId, outcome })
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie zaktualizowac wyniku sesji.", "error");
    return;
  }

  await refreshBootstrapData();
  await refreshOpenPatientReconciliation();
  renderAll();
  setActiveView("billing");
  setSaveStatus(
    outcome === "cancelled"
      ? "Sesja oznaczona jako nieodbyta i wypadla z zaleglosci."
      : outcome === "rescheduled"
        ? "Sesja oznaczona jako przeniesiona i usunieta z rozliczen."
        : "Sesja oznaczona jako no-show platny.",
    "success"
  );
}

async function confirmConfidentPaymentMatches() {
  setSaveStatus("Potwierdzam pewne dopasowania...", "pending");

  const response = await fetch("/api/reconciliation/confirm-confident", {
    method: "POST"
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie potwierdzic pewnych dopasowan.", "error");
    return;
  }

  const result = await response.json();
  await refreshBootstrapData();
  renderAll();
  setActiveView("billing");
  setSaveStatus(`Potwierdzono automatycznie ${result.confirmed} pewnych platnosci.`, "success");
}

async function createManualVisit() {
  const payload = {
    patientName: resolvePatientNameInput(document.getElementById("create-patient-name").value),
    dateLabel: document.getElementById("create-date-label").value.trim(),
    time: document.getElementById("create-time").value.trim() || "brak godziny",
    serviceName: document.getElementById("create-service-name").value.trim(),
    amount: Number(document.getElementById("create-amount").value || 0),
    source: document.getElementById("create-source").value.trim() || "recznie"
  };

  if (!payload.patientName || !payload.dateLabel) {
    setSaveStatus("Podaj pacjenta i date wizyty.", "error");
    return;
  }

  setSaveStatus("Dodawanie wizyty...", "pending");

  const response = await fetch("/api/visits", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    setSaveStatus("Nie udalo sie dodac wizyty.", "error");
    return;
  }

  const visit = await response.json();
  await refreshBootstrapData();
  state.selectedVisitId = visit.id;
  state.selectedPatientName = visit.patientName;
  setCreateVisitPanelVisibility(false);
  renderAll();
  setActiveView(normalizeDateKey(visit.dateLabel) === state.activeDateKey ? "dashboard" : "visit");
  setSaveStatus("Wizyta dodana do workflow.", "success");
}

function collectVisitPatch() {
  const visit = getSelectedVisit();
  return {
    sessionOutcome: document.querySelector('[data-choice-group="session-outcome"].active').dataset.choiceValue,
    notes: document.getElementById("visit-notes").value,
    notesMode: document.getElementById("visit-notes-mode")?.value || visit.notesMode || "text",
    notesInk: document.getElementById("visit-notes-ink")?.value || visit.notesInk || "",
    summary: document.getElementById("visit-summary").value,
    nextVisit: {
      ...visit.nextVisit,
      status: document.querySelector('[data-choice-group="next-status"].active').dataset.choiceValue,
      plannedLabel: document.getElementById("visit-next-planned").value,
      note: document.getElementById("visit-next-note").value
    }
  };
}

function collectBillingPatch() {
  const visit = getSelectedVisit();
  const confirmedMatch = getConfirmedVisitMatch(visit);
  const status =
    document.querySelector('[data-choice-group="payment-status"].active')?.dataset.choiceValue || visit.payment.status || "pending";
  const method =
    document.querySelector('[data-choice-group="payment-method"].active')?.dataset.choiceValue || visit.payment.method || "transfer";
  const selectedConfirmationSource =
    document.querySelector('[data-choice-group="payment-confirmation-source"].active')?.dataset.choiceValue || "";
  const documentType =
    document.querySelector('[data-choice-group="payment-document"].active')?.dataset.choiceValue
      || visit.payment.documentType
      || "none";
  const documentIssued = documentType === "none"
    ? false
    : visit.payment.documentType === documentType
      ? Boolean(visit.payment.documentIssued)
      : false;
  const confirmationSource = status === "paid"
    ? normalizePaymentConfirmationSource(
      selectedConfirmationSource,
      editableVisitPaymentConfirmationSource(visit, status, method) || deriveVisitPaymentConfirmationSource(
        { ...visit.payment, status, method },
        confirmedMatch
      )
    )
    : status === "ignored"
      ? "ignored"
      : "none";

  return {
    payment: {
      ...visit.payment,
      amount: Number(document.getElementById("billing-amount").value || visit.payment.amount),
      status,
      statusLabel: status === "paid"
        ? resolvedPaidPaymentLabel({
          storedLabel: visit.payment?.statusLabel,
          paymentMethod: method,
          hasBankLink: Boolean(confirmedMatch?.transaction || visit.payment?.bankTransactionId),
          confirmedExternalMethod: confirmedMatch?.externalPayment?.method,
          confirmationSource
        })
        : defaultVisitPaymentStatusLabel(status),
      method,
      confirmationSource,
      documentType,
      documentIssued
    }
  };
}

function buildChecklist(visit, visitPatch, paymentPatch) {
  return buildCloseoutState(visit, visitPatch, paymentPatch).checklist;
}

function buildVisitSavePayload(options = {}) {
  const visit = getSelectedVisit();
  const visitPatch = collectVisitPatch();
  const paymentPatch = collectBillingPatch();
  const closeoutState = buildCloseoutState(visit, visitPatch, paymentPatch);
  const payment = {
    ...paymentPatch.payment
  };

  if (options.forcePaid) {
    payment.status = "paid";
    payment.statusLabel = resolvedPaidPaymentLabel({
      storedLabel: payment.statusLabel,
      paymentMethod: payment.method,
      hasBankLink: Boolean(getConfirmedVisitMatch(visit)?.transaction || visit.payment?.bankTransactionId),
      confirmedExternalMethod: getConfirmedVisitMatch(visit)?.externalPayment?.method
    });
  }

  if (options.autoIssueDocument && closeoutState.documentNeeded) {
    payment.documentIssued = true;
  }

  const finalDocumentNeeded = isDocumentRequired(closeoutState.outcome, payment);
  const finalPaymentNeeded = closeoutState.outcome.chargeable && payment.status !== "ignored";
  payment.followUpLabel = derivePaymentFollowUpLabel(payment, finalDocumentNeeded);

  const followUp = {
    ...visit.followUp,
    documentReady: !finalDocumentNeeded || payment.documentIssued,
    lastActionLabel: options.closeVisit
      ? !finalPaymentNeeded
        ? "Sesja zamknieta po ustaleniach"
        : payment.status === "paid"
        ? "Sesja zamknieta i rozliczona"
        : "Sesja zamknieta, platnosc do dopilnowania"
      : payment.documentIssued
        ? "Dokument sprzedazy przygotowany"
        : visit.followUp?.lastActionLabel || "Karta zaktualizowana"
  };

  return {
    visit,
    visitPatch,
    paymentPatch: { payment },
    payload: {
      ...visitPatch,
      payment,
      followUp,
      ...(options.closeVisit ? { status: "closed", workflowStage: "closed" } : {}),
      closureChecklist: buildChecklist(visit, visitPatch, { payment })
    }
  };
}

function hasVisitEditorChanges(visit, visitPatch, payment) {
  if (!visit) {
    return false;
  }

  return (
    visit.sessionOutcome !== visitPatch.sessionOutcome ||
    String(visit.notes || "") !== String(visitPatch.notes || "") ||
    String(visit.notesMode || (visit.notesInk ? "ink" : "text")) !== String(visitPatch.notesMode || "text") ||
    String(visit.notesInk || "") !== String(visitPatch.notesInk || "") ||
    String(visit.summary || "") !== String(visitPatch.summary || "") ||
    visit.nextVisit.status !== visitPatch.nextVisit.status ||
    String(visit.nextVisit.plannedLabel || "") !== String(visitPatch.nextVisit.plannedLabel || "") ||
    String(visit.nextVisit.note || "") !== String(visitPatch.nextVisit.note || "") ||
    Number(visit.payment.amount || 0) !== Number(payment.amount || 0) ||
    visit.payment.status !== payment.status ||
    visit.payment.method !== payment.method ||
    visit.payment.documentType !== payment.documentType ||
    normalizePaymentConfirmationSource(visit.payment.confirmationSource, deriveVisitPaymentConfirmationSource(visit.payment)) !==
      normalizePaymentConfirmationSource(payment.confirmationSource, "none")
  );
}

async function autosaveVisitIfNeeded(message = "Zmiany zapisane automatycznie przy opuszczeniu sesji.") {
  if (state.activeView !== "visit" || state.visitAutosaveInFlight) {
    return true;
  }

  const notesField = document.getElementById("visit-notes");
  if (!notesField || !state.selectedVisitId) {
    return true;
  }

  const { visit, visitPatch, paymentPatch, payload } = buildVisitSavePayload();
  if (!hasVisitEditorChanges(visit, visitPatch, paymentPatch.payment)) {
    return true;
  }

  state.visitAutosaveInFlight = true;

  try {
    return await saveVisit(payload, message);
  } finally {
    state.visitAutosaveInFlight = false;
  }
}

async function openVisitById(visitId) {
  if (!visitId) {
    return;
  }

  const canContinue = await autosaveVisitIfNeeded("Zmiany zapisane automatycznie przed otwarciem innej wizyty.");
  if (!canContinue) {
    return;
  }

  const visit = state.data.visits.find((entry) => entry.id === visitId);
  state.selectedVisitId = visitId;
  state.selectedPatientName = visit?.patientName || state.selectedPatientName;
  renderAll();
  setActiveView("visit");
}

async function openSelectedPatientCardFromVisit() {
  const visit = getSelectedVisit();
  if (!visit) {
    return;
  }

  const patientName = visit.patientName;
  const canContinue = await autosaveVisitIfNeeded("Zmiany zapisane automatycznie przed otwarciem karty pacjenta.");
  if (!canContinue) {
    return;
  }

  state.selectedPatientName = patientName;
  state.patientSearch = patientName;
  renderPatients();
  attachActions();
  setActiveView("patients");
  setSaveStatus(`Otwarta karta pacjenta: ${patientName}.`, "idle");
}

async function navigateToView(viewKey) {
  if (viewKey !== "visit") {
    const canContinue = await autosaveVisitIfNeeded();
    if (!canContinue) {
      return false;
    }
  }

  setActiveView(viewKey);
  return true;
}

function attachActions() {
  document.querySelectorAll("[data-choice-group]").forEach((button) => {
    button.onclick = () => {
      setChoiceState(button.dataset.choiceGroup, button.dataset.choiceValue);
      if (button.dataset.choiceGroup === "session-outcome") {
        updateSessionOutcomeHint(button.dataset.choiceValue, getSelectedVisit()?.dateLabel);
      }
      if (["session-outcome", "next-status", "payment-status", "payment-method", "payment-document", "payment-confirmation-source"].includes(button.dataset.choiceGroup)) {
        renderVisitCloseoutPreview();
      }
      if (["session-outcome", "payment-status", "payment-method", "payment-document", "payment-confirmation-source"].includes(button.dataset.choiceGroup)) {
        updateVisitBillingPresentation();
      }
    };
  });

  const openCreateButton = document.getElementById("open-create-visit");
  const saveCreateButton = document.getElementById("save-create-visit");
  const cancelCreateButton = document.getElementById("cancel-create-visit");
  const createPatientInput = document.getElementById("create-patient-name");
  const toggleFollowupButton = document.getElementById("toggle-followup");

  if (openCreateButton) {
    openCreateButton.onclick = () => setCreateVisitPanelVisibility(true);
  }

  if (saveCreateButton) {
    saveCreateButton.onclick = async () => {
      await createManualVisit();
    };
  }

  if (cancelCreateButton) {
    cancelCreateButton.onclick = () => setCreateVisitPanelVisibility(false);
  }

  if (createPatientInput) {
    createPatientInput.onchange = () => {
      createPatientInput.value = resolvePatientNameInput(createPatientInput.value);
    };

    createPatientInput.onblur = () => {
      createPatientInput.value = resolvePatientNameInput(createPatientInput.value);
    };
  }

  if (toggleFollowupButton) {
    toggleFollowupButton.onclick = () => {
      state.showDayFollowup = !state.showDayFollowup;
      renderDashboard();
      attachActions();
    };
  }

  document.getElementById("save-visit").onclick = async () => {
    const { visit, visitPatch, paymentPatch, payload } = buildVisitSavePayload();
    await saveVisit(
      {
        ...payload,
        closureChecklist: buildChecklist(visit, visitPatch, paymentPatch)
      },
      "Karta wizyty zapisana."
    );
  };

  document.getElementById("close-visit").onclick = async () => {
    const { payload } = buildVisitSavePayload({ closeVisit: true });
    await saveVisit(payload, "Wizyta domknieta operacyjnie.");
  };

  document.getElementById("close-and-settle").onclick = async () => {
    const { payload } = buildVisitSavePayload({ closeVisit: true, autoIssueDocument: true });
    await saveVisit(payload, "Sesja zamknieta, a rozliczenie zapisane wedlug wybranych ustawien.");
  };

  document.getElementById("mark-paid").onclick = async () => {
    const { payload, paymentPatch } = buildVisitSavePayload();
    const paymentLabel = resolvedPaidPaymentLabel({
      storedLabel: paymentPatch.payment.statusLabel,
      paymentMethod: paymentPatch.payment.method,
      hasBankLink: Boolean(paymentPatch.payment.bankTransactionId),
      confirmationSource: paymentPatch.payment.confirmationSource
    });
    const saveCopy = paymentPatch.payment.status === "paid"
      ? `Rozliczenie zapisane jako: ${paymentLabel}.`
      : "Rozliczenie zapisane.";
    await saveVisit(
      payload,
      saveCopy
    );
  };

  document.getElementById("issue-document").onclick = async () => {
    const { payload } = buildVisitSavePayload({ autoIssueDocument: true });
    await saveVisit(
      payload,
      "Dokument sprzedazy zaktualizowany."
    );
  };

    document.getElementById("open-validation").onclick = async () => {
      const navigated = await navigateToView("billing");
      if (navigated) {
        setSaveStatus("Przeszedles do walidacji platnosci dla calej praktyki.", "idle");
      }
    };

    document.getElementById("open-visit-patient-card").onclick = async () => {
      await openSelectedPatientCardFromVisit();
    };

    const notesPreview = document.getElementById("visit-notes");
    const notesInkPreview = document.getElementById("visit-ink-preview");
    const notesModeTextButton = document.getElementById("notes-mode-text");
    const notesModeInkButton = document.getElementById("notes-mode-ink");
    const notesInkPenButton = document.getElementById("notes-ink-pen");
    const notesInkEraserButton = document.getElementById("notes-ink-eraser");
    const notesInkThinButton = document.getElementById("notes-ink-size-thin");
    const notesInkMediumButton = document.getElementById("notes-ink-size-medium");
    const notesInkBoldButton = document.getElementById("notes-ink-size-bold");
    const undoNotesInkButton = document.getElementById("undo-notes-ink");
    const clearNotesInkButton = document.getElementById("clear-notes-ink");
    const openNotesWorkspaceButton = document.getElementById("open-notes-workspace");
    const closeNotesWorkspaceButton = document.getElementById("close-notes-workspace");
    const notesWorkspaceInput = document.getElementById("notes-workspace-input");
    const notesWorkspaceOverlay = document.getElementById("notes-workspace-overlay");
    const notesInkCanvas = getNotesInkCanvas();
    const notesInkStage = getNotesInkStage();
    const notesPagePrevButton = document.getElementById("notes-page-prev");
    const notesPageNextButton = document.getElementById("notes-page-next");
    const notesPageAddButton = document.getElementById("notes-page-add");
    const notesPageRemoveButton = document.getElementById("notes-page-remove");
    const notesFontDownButton = document.getElementById("notes-font-down");
    const notesFontUpButton = document.getElementById("notes-font-up");
    const notesRulingButton = document.getElementById("toggle-notes-ruling");
    const notesFocusButton = document.getElementById("toggle-notes-focus");

    if (notesPreview) {
      notesPreview.onpointerdown = (event) => {
        event.preventDefault();
        setNotesWorkspaceVisibility(true);
    };
    notesPreview.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setNotesWorkspaceVisibility(true);
      }
    };
  }

    if (openNotesWorkspaceButton) {
      openNotesWorkspaceButton.onclick = () => setNotesWorkspaceVisibility(true);
    }

    if (notesModeTextButton) {
      notesModeTextButton.onclick = () => {
        setVisitNotesMode("text");
        renderNotesWorkspaceControls();
        window.requestAnimationFrame(() => {
          notesWorkspaceInput?.focus();
          const end = notesWorkspaceInput?.value.length || 0;
          notesWorkspaceInput?.setSelectionRange?.(end, end);
        });
      };
    }

    if (notesInkPreview) {
      notesInkPreview.onpointerdown = (event) => {
        event.preventDefault();
        setNotesWorkspaceVisibility(true);
      };
    }

    if (notesModeInkButton) {
      notesModeInkButton.onclick = () => {
        setVisitNotesMode("ink");
        renderNotesWorkspaceControls();
      };
    }

    if (notesInkPenButton) {
      notesInkPenButton.onclick = () => {
        setNotesInkTool("pen");
        renderNotesWorkspaceControls();
      };
    }

    if (notesInkEraserButton) {
      notesInkEraserButton.onclick = () => {
        setNotesInkTool("eraser");
        renderNotesWorkspaceControls();
      };
    }

    if (notesInkThinButton) {
      notesInkThinButton.onclick = () => {
        setNotesInkBrushSize("thin");
        renderNotesWorkspaceControls();
      };
    }

    if (notesInkMediumButton) {
      notesInkMediumButton.onclick = () => {
        setNotesInkBrushSize("medium");
        renderNotesWorkspaceControls();
      };
    }

    if (notesInkBoldButton) {
      notesInkBoldButton.onclick = () => {
        setNotesInkBrushSize("bold");
        renderNotesWorkspaceControls();
      };
    }

    if (undoNotesInkButton) {
      undoNotesInkButton.onclick = () => {
        undoNotesInkStroke();
        renderNotesWorkspaceControls();
      };
    }

    if (clearNotesInkButton) {
      clearNotesInkButton.onclick = () => {
        clearNotesInkCanvas();
        renderNotesWorkspaceControls();
      };
    }

    if (notesFontDownButton) {
      notesFontDownButton.onclick = () => {
        state.notesWorkspaceFontSize = Math.max(0.96, Number((state.notesWorkspaceFontSize - 0.06).toFixed(2)));
        renderNotesWorkspaceControls();
    };
  }

  if (notesFontUpButton) {
    notesFontUpButton.onclick = () => {
      state.notesWorkspaceFontSize = Math.min(1.32, Number((state.notesWorkspaceFontSize + 0.06).toFixed(2)));
      renderNotesWorkspaceControls();
    };
  }

  if (notesRulingButton) {
    notesRulingButton.onclick = () => {
      state.notesWorkspaceRuled = !state.notesWorkspaceRuled;
      renderNotesWorkspaceControls();
    };
  }

  if (notesFocusButton) {
    notesFocusButton.onclick = () => {
      state.notesWorkspaceFocus = !state.notesWorkspaceFocus;
      renderNotesWorkspaceControls();
    };
  }

  if (closeNotesWorkspaceButton) {
    closeNotesWorkspaceButton.onclick = () => {
      setNotesWorkspaceVisibility(false);
    };
  }

    if (notesWorkspaceInput) {
      notesWorkspaceInput.oninput = () => {
        document.getElementById("visit-notes").value = notesWorkspaceInput.value;
      };
    }

    if (notesPagePrevButton) {
      notesPagePrevButton.onclick = () => {
        openNotesInkPage(state.notesInkPageIndex - 1);
      };
    }

    if (notesPageNextButton) {
      notesPageNextButton.onclick = () => {
        openNotesInkPage(state.notesInkPageIndex + 1);
      };
    }

    if (notesPageAddButton) {
      notesPageAddButton.onclick = () => {
        addNotesInkPage();
      };
    }

    if (notesPageRemoveButton) {
      notesPageRemoveButton.onclick = () => {
        removeNotesInkPage();
      };
    }

    if (notesInkCanvas) {
      notesInkCanvas.onpointerdown = startNotesInkStroke;
      notesInkCanvas.onpointermove = moveNotesInkStroke;
      notesInkCanvas.onpointerrawupdate = moveNotesInkStroke;
      notesInkCanvas.onpointerup = endNotesInkStroke;
      notesInkCanvas.onpointercancel = endNotesInkStroke;
      notesInkCanvas.onlostpointercapture = endNotesInkStroke;
      notesInkCanvas.oncontextmenu = suppressNotesInkDefaultEvent;
      notesInkCanvas.onselectstart = suppressNotesInkDefaultEvent;
      notesInkCanvas.ondragstart = suppressNotesInkDefaultEvent;
    }

    if (notesInkStage) {
      notesInkStage.oncontextmenu = suppressNotesInkDefaultEvent;
      if (!notesInkStage.dataset.inkGuardsBound) {
        ["touchstart", "touchmove", "gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
          notesInkStage.addEventListener(eventName, suppressNotesInkDefaultEvent, { passive: false });
        });
        notesInkStage.dataset.inkGuardsBound = "true";
      }
    }

    if (notesWorkspaceOverlay) {
      notesWorkspaceOverlay.onclick = (event) => {
        if (event.target === notesWorkspaceOverlay) {
          setNotesWorkspaceVisibility(false);
      }
    };
  }

    document.getElementById("ai-summary").onclick = () => {
      if (getVisitNotesMode() === "ink" && !document.getElementById("visit-notes").value.trim()) {
        setSaveStatus("Podsumowanie AI dziala teraz tylko dla notatek tekstowych. Dla odrecznych jeszcze nie czytamy tresci.", "error");
        return;
      }

      const notes = document.getElementById("visit-notes").value.trim();
      if (!notes) {
        setSaveStatus("Brak notatek do podsumowania.", "error");
        return;
      }

    const shortened = notes.length > 220 ? `${notes.slice(0, 220)}...` : notes;
    document.getElementById("visit-summary").value = `AI draft: ${shortened}`;
    setSaveStatus("Wstawiono robocze podsumowanie AI.", "success");
    renderVisitCloseoutPreview();
  };

  document.getElementById("visit-template").onclick = () => {
    document.getElementById("visit-summary").value =
      "Cel sesji: ...\nNajwazniejsze obserwacje: ...\nUstalenia: ...\nPraca domowa / kolejny krok: ...";
    setSaveStatus("Wstawiono szablon podsumowania.", "success");
    renderVisitCloseoutPreview();
  };

  [
    "visit-summary",
    "visit-next-planned",
    "visit-next-note",
    "billing-amount"
  ].forEach((id) => {
    const field = document.getElementById(id);
    if (field) {
      field.oninput = () => renderVisitCloseoutPreview();
    }
  });

  document.querySelectorAll("[data-visit-jump]").forEach((button) => {
    button.onclick = async () => {
      await openVisitById(button.dataset.visitJump);
    };
  });

  document.querySelectorAll("[data-inbox-action]").forEach((button) => {
    button.onclick = async () => {
      const visit = state.data.visits.find((entry) => entry.id === button.dataset.visitId);
      const followUp = { ...(visit.followUp || {}) };
      let message = "Akcja zapisana.";
      let patch = {};

      if (button.dataset.inboxAction === "payment_reminder") {
        followUp.paymentReminderSent = true;
        followUp.lastActionLabel = "Wyslano przypomnienie o platnosci";
        patch = {
          followUp,
          payment: {
            ...visit.payment,
            followUpLabel: "przypomnienie wyslane"
          }
        };
        message = "Przypomnienie o platnosci oznaczone jako wyslane.";
      }

      if (button.dataset.inboxAction === "document_ready") {
        followUp.documentReady = true;
        followUp.lastActionLabel = "Dokument sprzedazy przygotowany";
        patch = {
          followUp,
          payment: {
            ...visit.payment,
            documentIssued: true,
            followUpLabel: visit.payment.status === "paid" ? "dokument gotowy" : "dokument gotowy, czeka na platnosc"
          }
        };
        message = "Dokument sprzedazy oznaczony jako gotowy.";
      }

      if (button.dataset.inboxAction === "zl_sync") {
        followUp.zlSynced = true;
        followUp.lastActionLabel = "Termin wpisany do ZnanyLekarz";
        patch = {
          followUp,
          nextVisit: {
            ...visit.nextVisit,
            status: "scheduled",
            label: "kontynuacja"
          }
        };
        message = "Termin oznaczony jako wpisany do ZL.";
      }

      state.selectedVisitId = visit.id;
      await saveVisit(
        {
          ...patch,
          closureChecklist: buildChecklist(
            visit,
            patch.nextVisit ? { nextVisit: patch.nextVisit } : null,
            patch.payment ? { payment: patch.payment } : null
          )
        },
        message
      );
    };
  });

  document.querySelectorAll("[data-history-visit]").forEach((button) => {
    button.onclick = async () => {
      await openVisitById(button.dataset.historyVisit);
    };
  });

  document.querySelectorAll(".promote-import").forEach((button) => {
    button.onclick = async () => {
      await promoteImportRow(button.dataset.importId, button.dataset.rowId);
    };
  });

  document.querySelectorAll(".confirm-payment-match").forEach((button) => {
    button.onclick = async () => {
      await confirmPaymentMatch(button.dataset.matchId);
    };
  });

  document.querySelectorAll(".remember-payer-match").forEach((button) => {
    button.onclick = async () => {
      await confirmPaymentMatch(button.dataset.matchId, true);
    };
  });

  document.querySelectorAll(".reject-payment-match").forEach((button) => {
    button.onclick = async () => {
      await rejectPaymentMatch(button.dataset.matchId);
    };
  });

  document.querySelectorAll(".open-patient-reconciliation").forEach((button) => {
    button.onclick = async () => {
      await openPatientReconciliation(
        decodeURIComponent(button.dataset.patientName || ""),
        button.dataset.targetId || null,
        button.dataset.transactionId || null
      );
    };
  });

  document.querySelectorAll(".close-patient-reconciliation").forEach((button) => {
    button.onclick = () => {
      state.reconciliationLedger = null;
      state.reconciliationSelectedSessionId = null;
      state.reconciliationSelectedSessionIds = [];
      state.reconciliationSessionFilter = "selected";
      state.reconciliationTransactionFilter = "recommended";
      state.reconciliationFocusTransactionId = null;
      renderAll();
      setActiveView("billing");
    };
  });

  document.querySelectorAll(".ledger-session").forEach((button) => {
    button.onclick = () => {
      const sessionId = button.dataset.ledgerSessionId;
      const current = normalizeIdList(state.reconciliationSelectedSessionIds);

      if (current.includes(sessionId)) {
        state.reconciliationSelectedSessionIds = current.length > 1
          ? current.filter((id) => id !== sessionId)
          : current;
      } else {
        state.reconciliationSelectedSessionIds = [...current, sessionId];
      }

      state.reconciliationSelectedSessionId = sessionId;
      state.reconciliationSessionFilter = "selected";
      renderAll();
      setActiveView("billing");
    };
  });

  document.getElementById("ledger-session-filter")?.addEventListener("change", (event) => {
    state.reconciliationSessionFilter = event.target.value;
    renderAll();
    setActiveView("billing");
  });

  document.getElementById("ledger-transaction-filter")?.addEventListener("change", (event) => {
    state.reconciliationTransactionFilter = event.target.value;
    renderAll();
    setActiveView("billing");
  });

  document.getElementById("reconciliation-status-filter")?.addEventListener("change", (event) => {
    state.reconciliationListFilter = event.target.value;
    renderAll();
    setActiveView("billing");
  });

  document.getElementById("reconciliation-date-scope")?.addEventListener("change", (event) => {
    state.reconciliationDateScope = event.target.value;
    renderAll();
    setActiveView("billing");
  });

  document.querySelectorAll(".ledger-link-payment").forEach((button) => {
    button.onclick = async () => {
      await confirmManualPaymentMatch(
        String(button.dataset.targetIds || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        button.dataset.transactionId
      );
    };
  });

  document.querySelectorAll(".manual-payment-match").forEach((button) => {
    button.onclick = async () => {
      await confirmManualPaymentMatch([button.dataset.targetId], button.dataset.transactionId);
    };
  });

  document.querySelectorAll(".external-payment-match").forEach((button) => {
    button.onclick = async () => {
      await confirmExternalPayment(button.dataset.targetId, button.dataset.method, button.dataset.remember === "true");
    };
  });

  document.querySelectorAll(".ledger-session-outcome").forEach((button) => {
    button.onclick = async () => {
      await updateReconciliationSessionOutcome(button.dataset.targetId, button.dataset.outcome);
    };
  });
}

function renderAll() {
  renderDashboard();
  renderImports();
  renderPatients();
  renderCreatePatientSuggestions();
  renderVisitForm();
  renderBilling();
  renderStats();
  attachActions();
}

async function bootstrap() {
  const loaded = await refreshBootstrapData();

  if (!loaded) {
    return;
  }
  state.activeDateKey = getCurrentDateKey();
  state.selectedVisitId = getActiveDateWorkflowVisits()[0]?.id || state.data.visits[0]?.id || null;
  state.selectedImportId = state.data.imports?.[0]?.id || null;
  state.selectedPatientName = getSelectedVisit()?.patientName || state.data.visits[0]?.patientName || null;
  syncResponsiveShell();
  renderAll();
  setActiveView("dashboard");
  setSaveStatus(`Dane zaladowane - ostatni zapis: ${state.data.meta.lastUpdated}`, "idle");
}

navButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    await navigateToView(button.dataset.view);
  });
});

document.getElementById("open-imports-view")?.addEventListener("click", async () => {
  await navigateToView("imports");
});

document.getElementById("open-data-tools")?.addEventListener("click", () => {
  setDataToolsPanelVisibility(dataToolsPanel.hidden);
});

document.getElementById("close-data-tools")?.addEventListener("click", () => {
  setDataToolsPanelVisibility(false);
});

mobileNavToggleEl?.addEventListener("click", () => {
  setSidebarOpen(!state.sidebarOpen);
});

sidebarCloseEl?.addEventListener("click", () => {
  setSidebarOpen(false);
});

shellBackdropEl?.addEventListener("click", () => {
  setSidebarOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.sidebarOpen) {
    setSidebarOpen(false);
    return;
  }

  if (event.key === "Escape" && state.notesWorkspaceOpen) {
    setNotesWorkspaceVisibility(false);
  }
});

window.addEventListener("resize", () => {
  syncResponsiveShell();

  if (state.notesWorkspaceOpen && getVisitNotesMode() === "ink") {
    drawNotesInkSnapshot();
  }
});

document.getElementById("export-data-store")?.addEventListener("click", () => {
  window.location.href = "/api/data/export";
});

document.getElementById("import-data-store")?.addEventListener("click", importDataStore);
document.getElementById("run-reconciliation-import")?.addEventListener("click", runReconciliationImport);
document.getElementById("confirm-confident-matches")?.addEventListener("click", confirmConfidentPaymentMatches);

document.getElementById("patient-search")?.addEventListener("input", (event) => {
  state.patientSearch = event.target.value;
  renderPatients();
  attachActions();
});

logoutButton?.addEventListener("click", async () => {
  const canContinue = await autosaveVisitIfNeeded("Zmiany zapisane automatycznie przed wylogowaniem.");
  if (!canContinue) {
    return;
  }
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

bootstrap().catch(() => {
  setSaveStatus("Nie udalo sie zaladowac danych.", "error");
});
