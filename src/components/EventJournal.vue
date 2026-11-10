<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { clock, shortDate, statusLabels, type IntegrationEvent, type StatusFilter, type TimeOrder } from "../events";

const props = defineProps<{
  events: IntegrationEvent[];
  total: number | null;
  visibleCount: string;
  filter: StatusFilter;
  order: TimeOrder;
  orderLabel: string;
  loading: boolean;
  notice: string;
  refreshPending: boolean;
  creationSuccess: string;
  createdEventId: string | null;
  selectedEventId: string | null;
}>();

const emit = defineEmits<{
  filter: [filter: StatusFilter];
  sort: [];
  retry: [];
  create: [opener: HTMLButtonElement];
  focusRefresh: [];
  details: [event: IntegrationEvent, opener: HTMLButtonElement];
}>();

const filters = { all: "Все", ...statusLabels } as const;
const filterGroup = ref<HTMLDivElement | null>(null);
const retry = ref<HTMLButtonElement | null>(null);

function focusActiveFilter() {
  filterGroup.value?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
}

async function resetFilter() {
  emit("filter", "all");
  await nextTick();
  focusActiveFilter();
}

function openFromRow(event: IntegrationEvent, click: MouseEvent) {
  if (window.getSelection()?.type === "Range") return;
  if (!(click.currentTarget instanceof HTMLTableRowElement)) return;
  const opener = click.currentTarget.querySelector<HTMLButtonElement>(".row-action");
  if (opener) emit("details", event, opener);
}

watch(() => props.notice, (notice, previous) => {
  if (!notice && previous && document.activeElement === retry.value) emit("focusRefresh");
});

defineExpose({ focusActiveFilter });
</script>

<template>
  <section class="journal" aria-labelledby="journal-title">
    <div class="journal-header">
      <div class="journal-heading">
        <h2 id="journal-title">Журнал событий</h2>
        <div class="journal-meta">
          <p class="journal-description">
            <span class="journal-order"><span id="journal-order">{{ orderLabel }}</span> · </span><span class="journal-time-label">Время </span>МСК
          </p>
          <button
            class="time-sort mobile-time-sort"
            id="sort-time-mobile"
            type="button"
            :data-order="order"
            :aria-label="`${orderLabel}. Изменить порядок сортировки по времени`"
            @click="emit('sort')"
          >
            <span id="mobile-order">{{ orderLabel }}</span>
            <svg class="sort-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8 3v10m-3.5-3.5L8 13l3.5-3.5"/>
            </svg>
          </button>
        </div>
      </div>
      <div ref="filterGroup" class="filters" role="group" aria-label="Фильтр по статусу">
        <button
          v-for="(label, status) in filters"
          :key="status"
          type="button"
          :data-filter="status"
          :aria-pressed="filter === status"
          @click="emit('filter', status)"
        >
          {{ label }}
        </button>
      </div>
    </div>

    <div class="notice" id="notice" :class="{ 'notice-initial': total === null }" :hidden="!notice">
      <div role="alert">
        <h3 v-if="notice && total === null" class="state-title" id="state-title">Журнал недоступен</h3>
        <p id="notice-text">{{ notice }}</p>
      </div>
      <button
        ref="retry"
        class="button retry-button"
        id="retry"
        type="button"
        :aria-disabled="refreshPending || undefined"
        @click="emit('retry')"
      >Повторить</button>
    </div>

    <div role="status">
      <p class="creation-success" id="creation-success" :hidden="!creationSuccess">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5"/>
          <path d="m8.5 12 2.3 2.5 4.7-5"/>
        </svg>
        {{ creationSuccess }}
      </p>
    </div>

    <div class="list-area" id="list-area" :aria-busy="loading">
      <div v-if="loading" class="journal-loading" id="list-state">
        <p class="sr-only" id="state-title">Загружаем события</p>
        <div v-for="row in 4" :key="row" class="skeleton-row" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      </div>
      <div v-else-if="total !== null && events.length === 0" class="list-state" id="list-state">
        <h3 class="state-title" id="state-title">{{ total === 0 ? "Событий пока нет" : "Нет событий с этим статусом" }}</h3>
        <p class="state-description" id="state-description">
          {{ total === 0 ? "Добавьте тестовую запись или дождитесь первого вебхука." : "Сбросьте фильтр, чтобы увидеть все записи." }}
        </p>
        <button
          v-if="total === 0"
          class="button"
          type="button"
          aria-haspopup="dialog"
          @click="emit('create', $event.currentTarget as HTMLButtonElement)"
        >Добавить тестовое событие</button>
        <button v-else class="button" type="button" @click="resetFilter">Сбросить фильтр</button>
      </div>

      <table class="event-table" id="event-table" role="table" aria-labelledby="journal-title" :hidden="events.length === 0">
        <colgroup>
          <col class="time-column">
          <col class="source-column">
          <col class="type-column">
          <col class="status-column">
          <col>
          <col class="action-column">
        </colgroup>
        <thead role="rowgroup">
          <tr role="row">
            <th class="time-header" id="time-header" scope="col" role="columnheader" :aria-sort="order">
              <span class="time-header-label">Время</span>
              <button class="time-sort desktop-time-sort" id="sort-time-desktop" type="button" title="Изменить порядок сортировки" @click="emit('sort')">
                Время
                <svg class="sort-arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M8 3v10m-3.5-3.5L8 13l3.5-3.5"/>
                </svg>
              </button>
            </th>
            <th scope="col" role="columnheader">Источник</th>
            <th scope="col" role="columnheader">Тип события</th>
            <th scope="col" role="columnheader">Статус</th>
            <th scope="col" role="columnheader">Описание</th>
            <th scope="col" role="columnheader"><span class="sr-only">Детали</span></th>
          </tr>
        </thead>
        <tbody id="event-rows" role="rowgroup">
          <tr
            v-for="event in events"
            :key="event.id"
            role="row"
            :data-event-id="event.id"
            :data-created="event.id === createdEventId || undefined"
            :data-selected="event.id === selectedEventId || undefined"
            @click="openFromRow(event, $event)"
          >
            <td role="cell">
              <time class="event-time" :datetime="event.created_at">
                <span>{{ clock.format(Date.parse(event.created_at)) }}</span>
                <span>{{ shortDate.format(Date.parse(event.created_at)) }}</span>
              </time>
            </td>
            <td role="cell"><span class="source-badge">{{ event.source }}</span></td>
            <td role="cell"><span class="event-type">{{ event.type }}</span></td>
            <td role="cell"><span class="status-badge" :data-status="event.status">{{ statusLabels[event.status] }}</span></td>
            <td role="cell" class="event-message"><span>{{ event.message }}</span></td>
            <td role="cell">
              <button
                class="icon-button row-action"
                type="button"
                title="Открыть детали"
                aria-haspopup="dialog"
                :aria-label="`Открыть событие ${event.id}`"
                :aria-describedby="event.id === createdEventId ? 'creation-success' : undefined"
                @click.stop="emit('details', event, $event.currentTarget as HTMLButtonElement)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m10 6 6 6-6 6"/>
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="journal-footer" id="journal-footer" :hidden="total === null">
      <span id="visible-count">{{ visibleCount }}</span>
      <span class="refresh-hint">Автообновление каждые 5 сек.</span>
    </div>
  </section>
</template>
