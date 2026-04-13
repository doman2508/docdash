const views = {
  dashboard: {
    title: "Dzien pracy",
    subtitle: "Jedno miejsce do ogarniania sesji, zaleglosci i kolejnych krokow."
  },
  imports: {
    title: "Importy",
    subtitle: "Tymczasowo zaimportowane zestawienia z ZnanyLekarz i innych zrodel."
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
    title: "Rozliczenia",
    subtitle: "Status platnosci, dokument sprzedazy i lista rzeczy do dopilnowania."
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
  showDayFollowup: false,
  showImportArchive: false,
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

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("pl-PL")} zl`;
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

function getDateSortValue(label) {
  const normalized = normalizeDateKey(label);
  const match = String(normalized || "").match(/^(\d{1,2})\.(\d{2})\.(\d{4})$/);

  if (!match) {
    return null;
  }

  return Number(match[3]) * 10000 + Number(match[2]) * 100 + Number(match[1]);
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
      const totalDue = visits.reduce((sum, visit) => sum + visit.payment.amount, 0);
      const totalPaid = visits
        .filter((visit) => visit.payment.status === "paid")
        .reduce((sum, visit) => sum + visit.payment.amount, 0);
      const pending = totalDue - totalPaid;
      const nextVisit = visits.find((visit) => visit.nextVisit.status === "scheduled");

      return {
        patientName,
        visits,
        importedRows,
        visitCount: visits.length,
        importedCount: importedRows.length,
        totalDue,
        totalPaid,
        pending,
        nextVisit,
        activeStatus: pending > 0 || importedRows.some((row) => !row.processed) ? "wymaga uwagi" : "aktywny"
      };
    })
    .sort((left, right) => left.patientName.localeCompare(right.patientName));
}

function getSelectedPatient() {
  const patients = getPatients();
  return patients.find((patient) => patient.patientName === state.selectedPatientName) || patients[0];
}

function getImports() {
  return state.data.imports || [];
}

function getSelectedImport() {
  const imports = getImports();
  return imports.find((item) => item.id === state.selectedImportId) || imports[0] || null;
}

function setSaveStatus(message, type = "idle") {
  saveStatusEl.textContent = message;
  saveStatusEl.dataset.state = type;
}

function setActiveView(viewKey) {
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

function getTodayMetrics() {
  const workflowToday = getActiveDateWorkflowVisits();
  const importedToday = getActiveDateImportRows();
  const completed = workflowToday.filter((visit) => visit.status === "closed").length;
  const due = workflowToday.reduce((sum, visit) => sum + visit.payment.amount, 0);
  const paid = workflowToday
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
  const paid = visits
    .filter((visit) => visit.payment.status === "paid")
    .reduce((sum, visit) => sum + visit.payment.amount, 0);
  const due = visits.reduce((sum, visit) => sum + visit.payment.amount, 0);
  const unscheduled = visits.filter((visit) => visit.nextVisit.status !== "scheduled").length;
  const pendingPayments = visits.filter((visit) => visit.payment.status !== "paid").length;
  const closed = visits.filter((visit) => visit.status === "closed").length;
  const closureRate = Math.round((closed / visits.length) * 100);
  const average = visits.length ? Math.round(due / visits.length) : 0;

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

  if (selectedVisit && selectedVisit.id !== state.selectedVisitId) {
    state.selectedVisitId = selectedVisit.id;
  }

  document.getElementById("day-context").innerHTML = `
    <div class="day-context-copy">
      <p class="panel-label">Aktywny dzien workflow</p>
      <h3>${workingDayLabel}</h3>
      <p>Importy z tej daty wpadaja tu od razu jako pozycje dnia. Do workflow przejmujesz je dopiero wtedy, kiedy chcesz wejsc w sesje.</p>
    </div>
    <div class="day-context-meta">
      <span class="day-pill">${todayVisits.length} wizyt w workflow</span>
      <span class="day-pill">${metrics.importedPending} do przejecia z importu</span>
      <span class="day-pill">${metrics.openItems} rzeczy do domkniecia</span>
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
  ].sort((left, right) => {
    if (left.statusRank !== right.statusRank) {
      return left.statusRank - right.statusRank;
    }

    return left.patientName.localeCompare(right.patientName);
  });

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
              return `
                <article class="day-entry workflow-entry day-list-row" data-day-open-visit="${visit.id}">
                  <div>
                    <h4>${visit.patientName}</h4>
                    <p>${visit.serviceName || "sesja"} - ${visit.source}</p>
                  </div>
                  <span class="day-entry-time">${visit.time || "bez godziny"}</span>
                  <span class="tag">${visit.status === "closed" ? "zamknieta" : "w workflow"}</span>
                  <span class="tag">${visit.payment.statusLabel}</span>
                  <button class="ghost" type="button">Sesja</button>
                </article>
              `;
            }

            const row = item.row;
            return `
              <article class="day-entry import-entry day-list-row" data-day-promote="${row.id}" data-import-id="${row.importId}">
                <div>
                  <h4>${row.patientName}</h4>
                  <p>${row.serviceName} - import z ${row.source}</p>
                </div>
                <span class="day-entry-time">${row.time || "bez godziny"}</span>
                <span class="tag">z importu</span>
                <span class="tag">${row.paymentStatus}</span>
                <button class="primary" type="button">Przejmij</button>
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
      <h4>Przejmij rekord z importu albo dodaj wizyte recznie</h4>
      <span>Dopiero wtedy Dzien bedzie pracowal na realnych sesjach dla ${workingDayLabel}.</span>
    `;
  renderInbox(state.activeDateKey);
  document.getElementById("day-followup-panel").hidden = !state.showDayFollowup;
  const toggleButton = document.getElementById("toggle-followup");
  if (toggleButton) {
    toggleButton.textContent = state.showDayFollowup ? "Ukryj domkniecia" : "Pokaz domkniecia";
  }

  document.querySelectorAll("[data-day-open-visit]").forEach((item) => {
    item.onclick = () => {
      state.selectedVisitId = item.dataset.dayOpenVisit;
      renderAll();
      setActiveView("visit");
    };
  });

  document.querySelectorAll("[data-day-promote]").forEach((item) => {
    item.onclick = async () => {
      await promoteImportRow(item.dataset.importId, item.dataset.dayPromote);
    };
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

    if (visit.payment.status !== "paid" && !followUp.paymentReminderSent) {
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

    if (visit.payment.documentType !== "none" && !followUp.documentReady) {
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

  document.getElementById("visit-heading").textContent = `${visit.patientName} - ${visit.dateLabel} - ${visit.time}`;
  badge.textContent = visit.status === "closed" ? "zamknieta" : "wymaga akcji";
  badge.className = `badge ${visit.status === "closed" ? "success" : "warning"}`;

  document.getElementById("visit-notes").value = visit.notes;
  document.getElementById("visit-summary").value = visit.summary;
  document.getElementById("visit-next-note").value = visit.nextVisit.note;
  document.getElementById("visit-next-planned").value = visit.nextVisit.plannedLabel;
  setChoiceState("next-status", visit.nextVisit.status);
}

function renderPatients() {
  const patients = getPatients();
  const selectedPatient = getSelectedPatient();

  document.getElementById("patient-heading").textContent = selectedPatient.patientName;
  document.getElementById("patient-badge").textContent = selectedPatient.activeStatus;
  document.getElementById("patient-badge").className = `badge ${selectedPatient.pending > 0 ? "warning" : "success"}`;

  document.getElementById("patient-list").innerHTML = patients
    .map((patient) => {
      return `
        <article class="patient-item ${patient.patientName === selectedPatient.patientName ? "selected" : ""}" data-patient-name="${patient.patientName}">
          <div>
            <h4>${patient.patientName}</h4>
            <span>${patient.visitCount} wizyt w workflow - ${patient.importedCount} rekordow z importu - zaleglosc: ${formatCurrency(patient.pending)}</span>
          </div>
          <span class="badge ${patient.pending > 0 ? "warning" : "success"}">${patient.activeStatus}</span>
        </article>
      `;
    })
    .join("");

  document.getElementById("patient-summary-grid").innerHTML = `
    <div class="patient-summary-card">
      <p>Liczba wizyt</p>
      <strong>${selectedPatient.visitCount}</strong>
    </div>
    <div class="patient-summary-card">
      <p>ZL do przejecia</p>
      <strong>${selectedPatient.importedRows.filter((row) => !row.processed).length}</strong>
    </div>
    <div class="patient-summary-card">
      <p>Saldo otwarte</p>
      <strong>${formatCurrency(selectedPatient.pending)}</strong>
    </div>
    <div class="patient-summary-card">
      <p>Nastepna wizyta</p>
      <strong>${selectedPatient.nextVisit ? selectedPatient.nextVisit.nextVisit.plannedLabel : "brak"}</strong>
    </div>
  `;

  const historyItems = [
    ...selectedPatient.visits.map((visit) => ({
      type: "visit",
      sortKey: `1-${visit.dateLabel}-${visit.time}`,
      data: visit
    })),
    ...selectedPatient.importedRows.map((row) => ({
      type: "import",
      sortKey: `0-${row.dateLabel}`,
      data: row
    }))
  ];

  document.getElementById("patient-history").innerHTML = historyItems
    .map((item) => {
      if (item.type === "visit") {
        const visit = item.data;
        return `
          <article class="history-item">
            <div>
              <h4>${visit.dateLabel} - ${visit.time}</h4>
              <span>${visit.summary || "Brak podsumowania"}</span>
            </div>
            <div class="inbox-actions">
              <span class="badge ${visit.payment.status === "paid" ? "success" : "warning"}">${visit.payment.statusLabel}</span>
              <button class="ghost history-open" type="button" data-history-visit="${visit.id}">Otworz wizyte</button>
            </div>
          </article>
        `;
      }

      const row = item.data;
      return `
        <article class="history-item">
          <div>
            <h4>${row.dateLabel} - import ZL</h4>
            <span>${row.serviceName} - ${row.bookingStatus} - ${formatCurrency(row.amount)}</span>
          </div>
          <div class="inbox-actions">
            <span class="badge ${row.processed ? "success" : "warning"}">${row.processed ? "przetworzone" : "do przejecia"}</span>
            ${
              row.processed
                ? `<button class="ghost history-open" type="button" data-history-visit="${row.linkedVisitId}">Otworz wizyte</button>`
                : `<button class="primary promote-import" type="button" data-import-id="${row.importId}" data-row-id="${row.id}">Przenies do workflow</button>`
            }
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
              row.processed
                ? `<button class="ghost history-open" type="button" data-history-visit="${row.linkedVisitId}">Otworz</button>`
                : `<button class="primary promote-import" type="button" data-import-id="${selectedImport.id}" data-row-id="${row.id}">Przenies</button>`
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

  document.getElementById("billing-amount").value = String(visit.payment.amount);
  setChoiceState("payment-status", visit.payment.status);
  setChoiceState("payment-method", visit.payment.method);
  setChoiceState("payment-document", visit.payment.documentType);

  document.getElementById("payment-list").innerHTML = state.data.visits
    .filter((entry) => entry.payment.status !== "paid")
    .map((entry) => {
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
    .join("");

  document.getElementById("billing-summary").innerHTML = `
    <div><span>Przychod miesieczny</span><strong>${formatCurrency(monthly.due)}</strong></div>
    <div><span>Do odzyskania</span><strong>${formatCurrency(monthly.pending)}</strong></div>
    <div><span>Oplacone sesje</span><strong>${state.data.visits.filter((entry) => entry.payment.status === "paid").length}</strong></div>
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
    return;
  }

  const updatedVisit = await response.json();
  state.data.visits = state.data.visits.map((entry) => (entry.id === updatedVisit.id ? updatedVisit : entry));
  state.data.meta.lastUpdated = new Date().toISOString().slice(0, 16).replace("T", " ");
  setSaveStatus(message, "success");
  renderAll();
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
  state.selectedImportId = importId;
  state.selectedPatientName = updatedRow.patientName || state.selectedPatientName;
  state.selectedVisitId = updatedRow.linkedVisitId || state.selectedVisitId;
  renderAll();
  setActiveView("visit");
  setSaveStatus("Rekord z importu przeniesiony do workflow DocDash.", "success");
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

async function refreshBootstrapData() {
  const response = await fetch("/api/bootstrap");

  if (response.status === 401) {
    window.location.href = "/login.html";
    return false;
  }

  state.data = await response.json();
  return true;
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

async function createManualVisit() {
  const payload = {
    patientName: document.getElementById("create-patient-name").value.trim(),
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
    notes: document.getElementById("visit-notes").value,
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
  const status = document.querySelector('[data-choice-group="payment-status"].active').dataset.choiceValue;
  const documentType = document.querySelector('[data-choice-group="payment-document"].active').dataset.choiceValue;

  return {
    payment: {
      ...visit.payment,
      amount: Number(document.getElementById("billing-amount").value || visit.payment.amount),
      status,
      statusLabel: status === "paid" ? "oplacone" : status === "partial" ? "platnosc czesciowa" : "platnosc oczekuje",
      method: document.querySelector('[data-choice-group="payment-method"].active').dataset.choiceValue,
      documentType,
      documentIssued: documentType !== "none"
    }
  };
}

function buildChecklist(visit, visitPatch, paymentPatch) {
  const nextVisit = visitPatch?.nextVisit || visit.nextVisit;
  const payment = paymentPatch?.payment || visit.payment;

  return [
    { label: "Notatka robocza zapisana", done: true },
    { label: "Podsumowanie wizyty uzupelnione", done: true },
    {
      label: nextVisit.status === "scheduled" ? "Kolejna wizyta ustawiona" : "Brak wpisanej kolejnej wizyty w ZL",
      done: nextVisit.status === "scheduled"
    },
    {
      label: payment.status === "paid" ? `Platnosc ${formatCurrency(payment.amount)} potwierdzona` : `Platnosc ${formatCurrency(payment.amount)} nadal oczekuje`,
      done: payment.status === "paid"
    },
    {
      label: payment.documentIssued ? "Dokument sprzedazy wystawiony" : "Dokument sprzedazy nie wystawiony",
      done: payment.documentIssued
    }
  ];
}

function attachActions() {
  document.querySelectorAll("[data-choice-group]").forEach((button) => {
    button.onclick = () => setChoiceState(button.dataset.choiceGroup, button.dataset.choiceValue);
  });

  const openCreateButton = document.getElementById("open-create-visit");
  const saveCreateButton = document.getElementById("save-create-visit");
  const cancelCreateButton = document.getElementById("cancel-create-visit");
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

  if (toggleFollowupButton) {
    toggleFollowupButton.onclick = () => {
      state.showDayFollowup = !state.showDayFollowup;
      renderDashboard();
      attachActions();
    };
  }

  document.getElementById("save-visit").onclick = async () => {
    await saveVisit(collectVisitPatch(), "Karta wizyty zapisana.");
  };

  document.getElementById("close-visit").onclick = async () => {
    const visit = getSelectedVisit();
    const visitPatch = collectVisitPatch();
    await saveVisit(
      {
        ...visitPatch,
        status: "closed",
        workflowStage: "closed",
        closureChecklist: buildChecklist(visit, visitPatch)
      },
      "Wizyta domknieta operacyjnie."
    );
  };

  document.getElementById("mark-paid").onclick = async () => {
    const visit = getSelectedVisit();
    const paymentPatch = collectBillingPatch();
    paymentPatch.payment.status = "paid";
    paymentPatch.payment.statusLabel = "oplacone";
    paymentPatch.payment.followUpLabel = "oplacone tego samego dnia";

    await saveVisit(
      {
        payment: paymentPatch.payment,
        closureChecklist: buildChecklist(visit, null, paymentPatch)
      },
      "Platnosc oznaczona jako oplacona."
    );
  };

  document.getElementById("issue-document").onclick = async () => {
    const visit = getSelectedVisit();
    const paymentPatch = collectBillingPatch();
    paymentPatch.payment.documentIssued = paymentPatch.payment.documentType !== "none";

    await saveVisit(
      {
        payment: paymentPatch.payment,
        closureChecklist: buildChecklist(visit, null, paymentPatch)
      },
      "Dokument sprzedazy zaktualizowany."
    );
  };

  document.getElementById("ai-summary").onclick = () => {
    const notes = document.getElementById("visit-notes").value.trim();
    if (!notes) {
      setSaveStatus("Brak notatek do podsumowania.", "error");
      return;
    }

    const shortened = notes.length > 220 ? `${notes.slice(0, 220)}...` : notes;
    document.getElementById("visit-summary").value = `AI draft: ${shortened}`;
    setSaveStatus("Wstawiono robocze podsumowanie AI.", "success");
  };

  document.getElementById("visit-template").onclick = () => {
    document.getElementById("visit-summary").value =
      "Cel sesji: ...\nNajwazniejsze obserwacje: ...\nUstalenia: ...\nPraca domowa / kolejny krok: ...";
    setSaveStatus("Wstawiono szablon podsumowania.", "success");
  };

  document.querySelectorAll("[data-visit-jump]").forEach((button) => {
    button.onclick = () => {
      state.selectedVisitId = button.dataset.visitJump;
      renderAll();
      setActiveView("visit");
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
    button.onclick = () => {
      state.selectedVisitId = button.dataset.historyVisit;
      renderAll();
      setActiveView("visit");
    };
  });

  document.querySelectorAll(".promote-import").forEach((button) => {
    button.onclick = async () => {
      await promoteImportRow(button.dataset.importId, button.dataset.rowId);
    };
  });
}

function renderAll() {
  renderDashboard();
  renderImports();
  renderPatients();
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
  renderAll();
  setActiveView("dashboard");
  setSaveStatus(`Dane zaladowane - ostatni zapis: ${state.data.meta.lastUpdated}`, "idle");
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.view));
});

document.getElementById("open-data-tools")?.addEventListener("click", () => {
  setDataToolsPanelVisibility(dataToolsPanel.hidden);
});

document.getElementById("close-data-tools")?.addEventListener("click", () => {
  setDataToolsPanelVisibility(false);
});

document.getElementById("export-data-store")?.addEventListener("click", () => {
  window.location.href = "/api/data/export";
});

document.getElementById("import-data-store")?.addEventListener("click", importDataStore);

logoutButton?.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
});

bootstrap().catch(() => {
  setSaveStatus("Nie udalo sie zaladowac danych.", "error");
});
