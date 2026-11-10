<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import EventDetails from "./components/EventDetails.vue";
import EventEntry from "./components/EventEntry.vue";
import EventJournal from "./components/EventJournal.vue";
import EventStats from "./components/EventStats.vue";
import { clock, isEvent, type IntegrationEvent, type StatusFilter, type TimeOrder } from "./events";

const refreshInterval = 5_000;
const snapshot = shallowRef<IntegrationEvent[] | null>(null);
const activeFilter = ref<StatusFilter>("all");
const timeOrder = ref<TimeOrder>("descending");
const syncState = ref<"loading" | "ready" | "error">("loading");
const updatedAt = ref("");
const manualRefreshPending = ref(false);
const announcer = ref("");
const creationSuccess = ref("");

const addEventButton = ref<HTMLButtonElement | null>(null);
const refreshButton = ref<HTMLButtonElement | null>(null);
const journal = ref<InstanceType<typeof EventJournal> | null>(null);
const entry = ref<InstanceType<typeof EventEntry> | null>(null);
const details = ref<InstanceType<typeof EventDetails> | null>(null);
let detailOpener: HTMLButtonElement | null = null;
let pendingRequest: Promise<boolean> | null = null;
let journalRevision = 0;
let pollTimer: number | undefined;

const total = computed(() => snapshot.value?.length ?? null);
const successful = computed(() => snapshot.value?.filter((event) => event.status === "success").length ?? null);
const failed = computed(() => total.value === null || successful.value === null ? null : total.value - successful.value);
const visibleEvents = computed(() => {
  const visible = snapshot.value?.filter((event) => activeFilter.value === "all" || event.status === activeFilter.value) ?? [];
  const direction = timeOrder.value === "ascending" ? 1 : -1;
  return visible.sort((first, second) => direction * (Date.parse(first.created_at) - Date.parse(second.created_at)));
});
const visibleCount = computed(() => total.value === null ? "" : `Показано ${visibleEvents.value.length} из ${total.value}`);
const orderLabel = computed(() => timeOrder.value === "ascending" ? "Сначала старые" : "Сначала новые");
const syncLabel = computed(() => ({
  loading: "Подключение",
  ready: `Обновлено в ${updatedAt.value}`,
  error: "Сбой обновления",
})[syncState.value]);
const notice = computed(() => {
  if (syncState.value !== "error") return "";
  return snapshot.value === null
    ? "Не удалось получить события."
    : "Не удалось обновить журнал. Показаны последние полученные данные.";
});

async function requestEvents() {
  const revision = journalRevision;
  try {
    const response = await fetch("/api/events", {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Events request failed");
    const events: unknown = await response.json();
    if (!Array.isArray(events) || !events.every(isEvent)) {
      throw new Error("Invalid events response");
    }

    // A GET started before a successful POST must not replace its local result.
    if (revision !== journalRevision) return false;
    snapshot.value = events;
    updatedAt.value = clock.format(new Date());
    syncState.value = "ready";
    return true;
  } catch {
    if (revision === journalRevision) syncState.value = "error";
    return false;
  }
}

function loadEvents() {
  pendingRequest ??= requestEvents().finally(() => {
    pendingRequest = null;
  });
  return pendingRequest;
}

async function refreshManually() {
  if (manualRefreshPending.value) return;
  manualRefreshPending.value = true;
  announcer.value = "Обновляем журнал.";

  try {
    const updated = await loadEvents();
    announcer.value = updated ? `Журнал обновлён. ${visibleCount.value}.` : "";
  } finally {
    manualRefreshPending.value = false;
  }
}

function pollEvents() {
  if (document.visibilityState === "visible") void loadEvents();
}

function setFilter(status: StatusFilter) {
  if (status === activeFilter.value) return;
  activeFilter.value = status;
  if (snapshot.value !== null) announcer.value = `${visibleCount.value}.`;
}

function toggleTimeOrder() {
  timeOrder.value = timeOrder.value === "descending" ? "ascending" : "descending";
  announcer.value = `${orderLabel.value} события.`;
}

function mergeCreatedEvent(created: IntegrationEvent) {
  if (snapshot.value === null) return;
  journalRevision += 1;
  const events = [...snapshot.value];
  const existingIndex = events.findIndex((event) => event.id === created.id);
  if (existingIndex === -1) events.unshift(created);
  else events[existingIndex] = created;
  snapshot.value = events;
}

function includeCreatedEvent(created: IntegrationEvent) {
  const revealEvent = activeFilter.value !== "all" && activeFilter.value !== created.status;
  if (revealEvent) activeFilter.value = "all";

  // Wait for the first complete snapshot in the background, so its counters stay accurate.
  if (snapshot.value === null) void loadEvents().then(() => mergeCreatedEvent(created));
  else mergeCreatedEvent(created);
  return revealEvent;
}

function openEntry() {
  creationSuccess.value = "";
  void entry.value?.open();
}

function announceCreation(switchedFilter: boolean) {
  creationSuccess.value = switchedFilter
    ? "Событие добавлено. Фильтр переключён на «Все»."
    : "Событие добавлено.";
}

function openDetails(event: IntegrationEvent, opener: HTMLButtonElement) {
  detailOpener = opener;
  void details.value?.open(event);
}

function restoreDetailFocus() {
  if (detailOpener?.isConnected) detailOpener.focus();
  else journal.value?.focusActiveFilter();
  detailOpener = null;
}

onMounted(() => {
  document.addEventListener("visibilitychange", pollEvents);
  pollTimer = window.setInterval(pollEvents, refreshInterval);
  void loadEvents();
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", pollEvents);
  window.clearInterval(pollTimer);
});
</script>

<template>
  <header class="topbar">
    <div class="shell topbar-content">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12h4l3-6 4 12 3-6h4"/>
          </svg>
        </span>
        <span class="brand-name">ESTADEL</span>
        <span class="brand-caption">Панель мониторинга</span>
      </div>
      <p class="sync-state" id="sync-state" :data-state="syncState">
        <span class="sync-dot" aria-hidden="true"></span>
        <span id="sync-label">{{ syncLabel }}</span>
      </p>
    </div>
  </header>

  <main class="shell main-content">
    <div class="page-heading">
      <div>
        <p class="eyebrow">Операционный журнал</p>
        <h1>Мониторинг интеграций</h1>
        <p class="page-description">Отслеживайте вебхуки, их результаты и причины ошибок.</p>
      </div>
      <div class="heading-actions">
        <button ref="addEventButton" class="button primary-button" id="add-event" type="button" aria-haspopup="dialog" @click="openEntry">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Добавить тестовое событие
        </button>
        <button
          ref="refreshButton"
          class="button refresh-button"
          id="refresh"
          type="button"
          aria-label="Обновить"
          :aria-disabled="manualRefreshPending || undefined"
          @click="refreshManually"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 0 0-14-4L4 9m0 0h5M4 9V4m0 9a8 8 0 0 0 14 4l2-2m0 0h-5m5 0v5"/>
          </svg>
          <span class="refresh-label">Обновить</span>
        </button>
      </div>
    </div>

    <div role="status"><p class="creation-success" id="creation-success" :hidden="!creationSuccess">{{ creationSuccess }}</p></div>

    <EventStats :total="total" :successful="successful" :failed="failed" />
    <EventJournal
      ref="journal"
      :events="visibleEvents"
      :total="total"
      :visible-count="visibleCount"
      :filter="activeFilter"
      :order="timeOrder"
      :order-label="orderLabel"
      :loading="syncState === 'loading'"
      :notice="notice"
      :refresh-pending="manualRefreshPending"
      @filter="setFilter"
      @sort="toggleTimeOrder"
      @retry="refreshManually"
      @focus-refresh="refreshButton?.focus()"
      @details="openDetails"
    />
    <p class="sr-only" id="announcer" role="status">{{ announcer }}</p>
  </main>

  <EventEntry ref="entry" :include-event="includeCreatedEvent" @saved="announceCreation" @close="addEventButton?.focus()" />
  <EventDetails ref="details" @close="restoreDetailFocus" />
</template>
