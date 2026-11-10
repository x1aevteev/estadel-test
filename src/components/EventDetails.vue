<script setup lang="ts">
import { nextTick, ref, shallowRef } from "vue";
import { fullDate, statusLabels, type IntegrationEvent } from "../events";

const emit = defineEmits<{ close: [] }>();
const drawer = ref<HTMLDialogElement | null>(null);
const event = shallowRef<IntegrationEvent | null>(null);

async function open(selected: IntegrationEvent) {
  event.value = selected;
  await nextTick();
  drawer.value?.showModal();
}

defineExpose({ open });
</script>

<template>
  <dialog ref="drawer" class="detail-drawer" id="detail-dialog" aria-labelledby="detail-title" @close="emit('close')">
    <div class="detail-header">
      <div>
        <p class="eyebrow">Запись журнала</p>
        <h2 id="detail-title">Детали события</h2>
      </div>
      <form method="dialog">
        <button class="icon-button close-button" type="submit" aria-label="Закрыть детали" autofocus>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18"/>
          </svg>
        </button>
      </form>
    </div>
    <div v-if="event" class="detail-body">
      <div class="detail-summary">
        <p class="event-type" id="detail-type">{{ event.type }}</p>
        <span class="status-badge" id="detail-status" :data-status="event.status">{{ statusLabels[event.status] }}</span>
      </div>
      <dl class="detail-fields">
        <div>
          <dt>Идентификатор</dt>
          <dd class="mono" id="detail-id">{{ event.id }}</dd>
        </div>
        <div>
          <dt>Источник</dt>
          <dd id="detail-source">{{ event.source }}</dd>
        </div>
        <div>
          <dt>Время события</dt>
          <dd><time id="detail-time" :datetime="event.created_at">{{ fullDate.format(Date.parse(event.created_at)) }} МСК</time></dd>
        </div>
      </dl>
      <div class="detail-message" id="detail-message-card" :data-status="event.status">
        <h3 id="detail-message-title">{{ event.status === "error" ? "Причина ошибки" : "Описание" }}</h3>
        <p id="detail-message">{{ event.message }}</p>
      </div>
    </div>
  </dialog>
</template>
