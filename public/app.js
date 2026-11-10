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
const table = byId("event-table");
const rows = byId("event-rows");
const rowTemplate = byId("event-row");
const listState = byId("list-state");
const notice = byId("notice");
const noticeText = byId("notice-text");
const announcer = byId("announcer");
const dialog = byId("detail-dialog");

let events = null;
let activeFilter = "all";
let pendingRequest = null;
let manualRefreshPending = false;
let detailOpener = null;

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
  const visible = activeFilter === "all"
    ? events
    : events.filter((event) => event.status === activeFilter);

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
    showRequestError();
    return false;
  }

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
    activeFilter = button.dataset.filter;
    for (const filter of filters) {
      filter.setAttribute("aria-pressed", String(filter === button));
    }
    if (events !== null) {
      renderJournal();
      announcer.textContent = `${byId("visible-count").textContent}.`;
    }
  });
}

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
document.addEventListener("visibilitychange", pollEvents);
window.setInterval(pollEvents, refreshInterval);
void loadEvents();
