<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
}>();

const emit = defineEmits<{
  filter: [filter: StatusFilter];
  sort: [];
  retry: [];
  focusRefresh: [];
  details: [event: IntegrationEvent, opener: HTMLButtonElement];
}>();

const filters = { all: "Все", ...statusLabels } as const;
const filterGroup = ref<HTMLDivElement | null>(null);
const retry = ref<HTMLButtonElement | null>(null);

const listState = computed(() => {
  if (props.loading) return {
    title: "Загружаем события",
    description: "Получаем данные журнала.",
  };
  if (props.total === null) return {
    title: "Журнал недоступен",
    description: "Повторите запрос, чтобы загрузить события.",
  };
  if (props.total === 0) return {
    title: "Событий пока нет",
    description: "Новые записи появятся здесь после получения вебхука.",
  };
  return {
    title: "Нет событий с этим статусом",
    description: "Выберите другой статус, чтобы увидеть записи.",
  };
});

function focusActiveFilter() {
  filterGroup.value?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
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
      <div>
        <h2 id="journal-title">Журнал событий</h2>
        <div class="journal-meta">
          <p class="journal-description"><span class="journal-order"><span id="journal-order">{{ orderLabel }}</span> · </span>Время МСК</p>
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

    <div class="notice" id="notice" :hidden="!notice">
      <div role="alert" id="notice-text">{{ notice }}</div>
      <button
        ref="retry"
        class="button retry-button"
        id="retry"
        type="button"
        :aria-disabled="refreshPending || undefined"
        @click="emit('retry')"
      >Повторить</button>
    </div>

    <div class="list-area" id="list-area" :aria-busy="loading">
      <div class="list-state" id="list-state" :hidden="events.length > 0">
        <div class="state-symbol" aria-hidden="true"><span v-if="loading" class="state-loader"></span></div>
        <p class="state-title" id="state-title">{{ listState.title }}</p>
        <p class="state-description" id="state-description">{{ listState.description }}</p>
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
          <tr v-for="event in events" :key="event.id" role="row" :data-event-id="event.id" @click="openFromRow(event, $event)">
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
                :aria-label="`Открыть событие ${event.id}`"
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
