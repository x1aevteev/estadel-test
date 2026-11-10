const refreshInterval = 5_000;
const timeZone = "Europe/Moscow";
const clock = new Intl.DateTimeFormat("ru-RU", { timeZone, timeStyle: "medium" });
const shortDate = new Intl.DateTimeFormat("ru-RU", {
  timeZone, day: "numeric", month: "short",
});
const fullDate = new Intl.DateTimeFormat("ru-RU", {
  timeZone, dateStyle: "long", timeStyle: "medium",
});
const statusLabels = { success: "Успешно", error: "Ошибка" };

const byId = (id) => document.getElementById(id);
const refreshButton = byId("refresh");
const retryButton = byId("retry");
const filters = document.querySelectorAll("[data-filter]");
const desktopSort = byId("sort-time-desktop");
const mobileSort = byId("sort-time-mobile");
const table = byId("event-table");
const rows = byId("event-rows");
const rowTemplate = byId("event-row");
const listState = byId("list-state");
const notice = byId("notice");
const noticeText = byId("notice-text");
const announcer = byId("announcer");
const dialog = byId("detail-dialog");
const addEventButton = byId("add-event");
const entryDialog = byId("add-event-dialog");
const entryForm = byId("add-event-form");
const entryClose = byId("close-add-event");
const entryCancel = byId("cancel-add-event");
const entrySubmit = byId("submit-event");
const entryError = byId("add-event-error");
const creationSuccess = byId("creation-success");
const entryFields = ["source", "type", "status", "message"];

let events = null;
let activeFilter = "all";
let timeOrder = "descending";
let pendingRequest = null;
let journalRevision = 0;
let manualRefreshPending = false;
let detailOpener = null;
let entryPending = false;

function showListState(title, description) {
  listState.querySelector(".state-loader")?.remove();
  byId("state-title").textContent = title;
  byId("state-description").textContent = description;
  listState.hidden = false;
}

function setStatusBadge(badge, status) {
  badge.dataset.status = status;
  badge.textContent = statusLabels[status];
}

function setRowContent(row, event) {
  row.dataset.eventId = event.id;
  const time = row.querySelector("time");
  const date = new Date(event.created_at);
  time.dateTime = event.created_at;
  time.firstElementChild.textContent = clock.format(date);
  time.lastElementChild.textContent = shortDate.format(date);

  row.querySelector(".source-badge").textContent = event.source;
  row.querySelector(".event-type").textContent = event.type;
  row.querySelector(".event-message span").textContent = event.message;
  setStatusBadge(row.querySelector(".status-badge"), event.status);
  row.querySelector(".row-action").setAttribute("aria-label", `Открыть событие ${event.id}`);
}

function renderRows(visible) {
  const existing = new Map(Array.from(rows.children, (row) => [row.dataset.eventId, row]));
  const visibleIds = new Set(visible.map((event) => event.id));

  for (const [id, row] of existing) {
    if (!visibleIds.has(id)) row.remove();
  }

  let nextRow = rows.firstElementChild;
  for (const event of visible) {
    const row = existing.get(event.id) ?? rowTemplate.content.firstElementChild.cloneNode(true);
    setRowContent(row, event);
    if (row !== nextRow) rows.insertBefore(row, nextRow);
    nextRow = row.nextElementSibling;
  }
}

function renderJournal() {
  const visible = events.filter((event) => activeFilter === "all" || event.status === activeFilter);
  const direction = timeOrder === "ascending" ? 1 : -1;
  visible.sort((first, second) => direction * (Date.parse(first.created_at) - Date.parse(second.created_at)));

  renderRows(visible);
  table.hidden = visible.length === 0;
  listState.hidden = visible.length > 0;
  if (events.length === 0) {
    showListState("Событий пока нет", "Новые записи появятся здесь после получения вебхука.");
  } else if (visible.length === 0) {
    showListState("Нет событий с этим статусом", "Выберите другой статус, чтобы увидеть записи.");
  }

  byId("visible-count").textContent = `Показано ${visible.length} из ${events.length}`;
  byId("journal-footer").hidden = false;
}

function setActiveFilter(status) {
  activeFilter = status;
  for (const filter of filters) {
    filter.setAttribute("aria-pressed", String(filter.dataset.filter === status));
  }
}

function toggleTimeOrder() {
  timeOrder = timeOrder === "descending" ? "ascending" : "descending";
  const label = timeOrder === "ascending" ? "Сначала старые" : "Сначала новые";
  byId("time-header").setAttribute("aria-sort", timeOrder);
  byId("journal-order").textContent = label;
  byId("mobile-order").textContent = label;
  mobileSort.dataset.order = timeOrder;
  mobileSort.setAttribute("aria-label", `${label}. Изменить порядок сортировки по времени`);
  if (events !== null) renderJournal();
  announcer.textContent = `${label} события.`;
}

function updateMetrics() {
  const successCount = events.filter((event) => event.status === "success").length;
  byId("count-total").textContent = events.length;
  byId("count-success").textContent = successCount;
  byId("count-error").textContent = events.length - successCount;
}

function isEvent(event) {
  return event !== null && typeof event === "object"
    && ["id", "source", "type", "created_at", "message"].every((field) => typeof event[field] === "string")
    && (event.status === "success" || event.status === "error")
    && Number.isFinite(Date.parse(event.created_at));
}

function showRequestError() {
  byId("sync-state").dataset.state = "error";
  byId("sync-label").textContent = "Сбой обновления";
  byId("list-area").setAttribute("aria-busy", "false");

  if (notice.hidden) {
    notice.hidden = false;
    noticeText.textContent = events === null
      ? "Не удалось получить события."
      : "Не удалось обновить журнал. Показаны последние полученные данные.";
  }

  if (events === null) {
    showListState("Журнал недоступен", "Повторите запрос, чтобы загрузить события.");
  }
}

async function requestEvents() {
  const revision = journalRevision;
  let nextEvents;
  try {
    const response = await fetch("/api/events", {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Events request failed");
    nextEvents = await response.json();
    if (!Array.isArray(nextEvents) || !nextEvents.every(isEvent)) {
      throw new Error("Invalid events response");
    }
  } catch {
    if (revision === journalRevision) showRequestError();
    return false;
  }

  // A GET started before a successful POST must not replace its local result.
  if (revision !== journalRevision) return false;
  const changed = JSON.stringify(events) !== JSON.stringify(nextEvents);
  events = nextEvents;
  if (changed) {
    updateMetrics();
    renderJournal();
  }

  if (document.activeElement === retryButton) refreshButton.focus();
  notice.hidden = true;
  noticeText.textContent = "";
  byId("list-area").setAttribute("aria-busy", "false");
  byId("sync-state").dataset.state = "ready";
  byId("sync-label").textContent = `Обновлено в ${clock.format(new Date())}`;
  return true;
}

function loadEvents() {
  pendingRequest ??= requestEvents().finally(() => {
    pendingRequest = null;
  });
  return pendingRequest;
}

async function refreshManually() {
  if (manualRefreshPending) return;
  manualRefreshPending = true;
  refreshButton.setAttribute("aria-disabled", "true");
  retryButton.setAttribute("aria-disabled", "true");
  announcer.textContent = "Обновляем журнал.";

  try {
    const updated = await loadEvents();
    announcer.textContent = updated
      ? `Журнал обновлён. ${byId("visible-count").textContent}.`
      : "";
  } finally {
    manualRefreshPending = false;
    refreshButton.removeAttribute("aria-disabled");
    retryButton.removeAttribute("aria-disabled");
  }
}

function pollEvents() {
  if (document.visibilityState === "visible") void loadEvents();
}

function updateMessageLabel() {
  const isError = byId("event-status").value === "error";
  byId("event-message-label").textContent = isError ? "Причина ошибки" : "Описание";
  byId("event-message").placeholder = isError
    ? "Например, отсутствует номер заказа"
    : "Например, тестовая заявка принята";
}

function setFieldError(field, message) {
  const control = entryForm.elements.namedItem(field);
  const error = byId(`${field}-error`);
  error.textContent = message;
  error.hidden = !message;
  if (message) control.setAttribute("aria-invalid", "true");
  else control.removeAttribute("aria-invalid");
  return control;
}

function showEntryError(message, fields) {
  entryError.hidden = !message;
  entryError.textContent = message;
  let firstInvalid;
  for (const field of entryFields) {
    const detail = typeof fields?.[field] === "string" ? fields[field] : "";
    const control = setFieldError(field, detail);
    if (detail) firstInvalid ??= control;
  }
  return firstInvalid;
}

function setEntryPending(pending) {
  entryPending = pending;
  byId("entry-fields").disabled = pending;
  entrySubmit.textContent = pending ? "Добавляем…" : "Добавить событие";
  for (const button of [entrySubmit, entryClose, entryCancel]) {
    if (pending) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }
  byId("add-event-progress").textContent = pending ? "Добавляем событие." : "";
  if (pending) entrySubmit.focus();
}

async function includeCreatedEvent(created) {
  if (events === null) await loadEvents();
  const revealEvent = activeFilter !== "all" && activeFilter !== created.status;
  if (revealEvent) setActiveFilter("all");
  if (events === null) return revealEvent;

  journalRevision += 1;
  if (!events.some((event) => event.id === created.id)) events = [created, ...events];
  updateMetrics();
  renderJournal();
  return revealEvent;
}

async function submitEvent(submission) {
  submission.preventDefault();
  if (entryPending) return;
  const payload = Object.fromEntries(new FormData(entryForm));
  showEntryError("");
  setEntryPending(true);
  let invalidField;
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const error = result?.error;
      const message = typeof error?.message === "string" ? error.message : "Не удалось добавить событие.";
      invalidField = showEntryError(message, error?.fields);
      return;
    }
    if (response.status !== 201 || !isEvent(result)) throw new Error("Invalid event response");

    const switchedFilter = await includeCreatedEvent(result);
    entryDialog.close();
    creationSuccess.hidden = false;
    creationSuccess.textContent = switchedFilter
      ? "Событие добавлено. Фильтр переключён на «Все»."
      : "Событие добавлено.";
  } catch {
    showEntryError("Не удалось подтвердить сохранение. Проверьте журнал перед повторной отправкой.");
  } finally {
    setEntryPending(false);
    invalidField?.focus();
  }
}

function showDetails(event, opener) {
  detailOpener = opener;
  byId("detail-type").textContent = event.type;
  byId("detail-id").textContent = event.id;
  byId("detail-source").textContent = event.source;
  const time = byId("detail-time");
  time.dateTime = event.created_at;
  time.textContent = `${fullDate.format(new Date(event.created_at))} МСК`;
  setStatusBadge(byId("detail-status"), event.status);

  byId("detail-message-card").dataset.status = event.status;
  byId("detail-message-title").textContent = event.status === "error" ? "Причина ошибки" : "Описание";
  byId("detail-message").textContent = event.message;
  dialog.showModal();
}

for (const button of filters) {
  button.addEventListener("click", () => {
    if (activeFilter === button.dataset.filter) return;
    setActiveFilter(button.dataset.filter);
    if (events !== null) {
      renderJournal();
      announcer.textContent = `${byId("visible-count").textContent}.`;
    }
  });
}

addEventButton.addEventListener("click", () => {
  entryForm.reset();
  updateMessageLabel();
  showEntryError("");
  creationSuccess.hidden = true;
  creationSuccess.textContent = "";
  entryDialog.showModal();
});
entryForm.addEventListener("submit", submitEvent);
entryForm.addEventListener("input", (event) => {
  const field = event.target.name;
  if (entryFields.includes(field)) setFieldError(field, "");
  if (field === "status") updateMessageLabel();
});
for (const button of [entryClose, entryCancel]) {
  button.addEventListener("click", () => {
    if (!entryPending) entryDialog.close();
  });
}
entryDialog.addEventListener("cancel", (event) => {
  if (entryPending) event.preventDefault();
});
entryDialog.addEventListener("close", () => addEventButton.focus());

rows.addEventListener("click", (click) => {
  const row = click.target.closest("tr[data-event-id]");
  if (!row) return;
  if (!click.target.closest(".row-action") && window.getSelection()?.type === "Range") return;
  const event = events.find((entry) => entry.id === row.dataset.eventId);
  if (event) showDetails(event, row.querySelector(".row-action"));
});

dialog.addEventListener("close", () => {
  if (detailOpener?.isConnected) {
    detailOpener.focus();
  } else {
    document.querySelector('[data-filter][aria-pressed="true"]').focus();
  }
  detailOpener = null;
});

refreshButton.addEventListener("click", refreshManually);
retryButton.addEventListener("click", refreshManually);
desktopSort.addEventListener("click", toggleTimeOrder);
mobileSort.addEventListener("click", toggleTimeOrder);
document.addEventListener("visibilitychange", pollEvents);
window.setInterval(pollEvents, refreshInterval);
void loadEvents();
