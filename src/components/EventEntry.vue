<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref } from "vue";
import { eventFields, isEvent, statusLabels, type EventDraft, type IntegrationEvent } from "../events";

type EventField = keyof EventDraft;
type FieldErrors = Partial<Record<EventField, string>>;

const props = defineProps<{
  includeEvent: (event: IntegrationEvent) => boolean;
}>();

const emit = defineEmits<{
  saved: [switchedFilter: boolean];
  close: [];
}>();

const emptyDraft: EventDraft = { source: "", type: "", status: "success", message: "" };
const draft = reactive<EventDraft>({ ...emptyDraft });
const drawer = ref<HTMLDialogElement | null>(null);
const form = ref<HTMLFormElement | null>(null);
const submitButton = ref<HTMLButtonElement | null>(null);
const pending = ref(false);
const errorMessage = ref("");
const fieldErrors = ref<FieldErrors>({});
const isError = computed(() => draft.status === "error");
const missingMessage = computed(() => isError.value ? "Укажите причину ошибки." : "Добавьте описание.");
const messageError = computed(() => {
  const error = fieldErrors.value.message;
  return error && !draft.message.trim() ? missingMessage.value : error;
});
const requiredNoticeDuration = 5_000;
const requiredNotice = ref<number | null>(null);
let noticeSequence = 0;
let noticeTimer: number | undefined;

function dismissRequiredNotice() {
  window.clearTimeout(noticeTimer);
  noticeTimer = undefined;
  requiredNotice.value = null;
}

function showRequiredNotice() {
  dismissRequiredNotice();
  requiredNotice.value = ++noticeSequence;
  noticeTimer = window.setTimeout(dismissRequiredNotice, requiredNoticeDuration);
}

async function focusField(field: EventField) {
  await nextTick();
  const scrollArea = form.value;
  const control = scrollArea?.elements.namedItem(field);
  if (!scrollArea || !(control instanceof HTMLElement)) return;

  control.focus({ preventScroll: true });
  const fieldBounds = (control.closest(".entry-field") ?? control).getBoundingClientRect();
  const formBounds = scrollArea.getBoundingClientRect();
  const preferredPadding = Number.parseFloat(getComputedStyle(scrollArea).scrollPaddingBlockStart) || 0;
  const availablePadding = Math.max(0, (formBounds.height - fieldBounds.height) / 2);
  const padding = Math.min(preferredPadding, availablePadding);
  const topOffset = fieldBounds.top - formBounds.top - padding;
  const bottomOffset = fieldBounds.bottom - formBounds.bottom + padding;
  if (topOffset < 0) scrollArea.scrollTop += topOffset;
  else if (bottomOffset > 0) scrollArea.scrollTop += Math.min(topOffset, bottomOffset);
}

function clearCorrectedField(field: EventField, event: Event) {
  const control = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (control.value.trim()) delete fieldErrors.value[field];
}

async function open() {
  Object.assign(draft, emptyDraft);
  errorMessage.value = "";
  fieldErrors.value = {};
  dismissRequiredNotice();
  await nextTick();
  drawer.value?.showModal();
}

function close() {
  if (pending.value) return;
  dismissRequiredNotice();
  drawer.value?.close();
}

function onCancel(event: Event) {
  if (pending.value) event.preventDefault();
  else dismissRequiredNotice();
}

function onClose() {
  dismissRequiredNotice();
  emit("close");
}

async function submit() {
  if (pending.value) return;
  errorMessage.value = "";
  fieldErrors.value = {};

  let firstInvalid: EventField | undefined;
  const missingMessages = {
    source: "Укажите источник.",
    type: "Укажите тип события.",
    status: "Выберите статус.",
    message: missingMessage.value,
  };
  for (const field of eventFields) {
    if (draft[field].trim()) continue;
    fieldErrors.value[field] = missingMessages[field];
    firstInvalid ??= field;
  }
  if (firstInvalid) {
    showRequiredNotice();
    await focusField(firstInvalid);
    return;
  }

  const payload = { ...draft };
  dismissRequiredNotice();
  pending.value = true;
  try {
    await nextTick();
    submitButton.value?.focus();

    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const body = result as { error?: { message?: unknown; fields?: Partial<Record<EventField, unknown>> } } | null;
      const error = body?.error;
      errorMessage.value = typeof error?.message === "string" ? error.message : "Не удалось добавить событие.";
      for (const field of eventFields) {
        const detail = error?.fields?.[field];
        if (typeof detail !== "string" || !detail) continue;
        fieldErrors.value[field] = detail;
        firstInvalid ??= field;
      }
      return;
    }
    if (response.status !== 201 || !isEvent(result)) throw new Error("Invalid event response");

    const switchedFilter = props.includeEvent(result);
    drawer.value?.close();
    emit("saved", switchedFilter);
  } catch {
    errorMessage.value = "Не удалось подтвердить сохранение. Проверьте журнал перед повторной отправкой.";
  } finally {
    pending.value = false;
    if (firstInvalid) await focusField(firstInvalid);
  }
}

onUnmounted(dismissRequiredNotice);
defineExpose({ open });
</script>

<template>
  <dialog
    ref="drawer"
    class="detail-drawer"
    id="add-event-dialog"
    aria-labelledby="add-event-title"
    aria-describedby="add-event-hint"
    @cancel="onCancel"
    @close="onClose"
  >
    <div class="entry-layout">
      <div class="entry-top">
        <div class="detail-header">
          <div>
            <p class="eyebrow">Новая запись</p>
            <h2 id="add-event-title">Добавить тестовое событие</h2>
          </div>
          <button
            class="icon-button close-button"
            id="close-add-event"
            type="button"
            aria-label="Закрыть форму"
            :aria-disabled="pending || undefined"
            @click="close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18"/>
            </svg>
          </button>
        </div>
        <div role="alert">
          <div
            v-if="requiredNotice !== null"
            :key="requiredNotice"
            id="entry-required-notice"
            class="entry-required-notice"
            :style="{ '--notice-duration': `${requiredNoticeDuration}ms` }"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5"/>
              <path d="M12 8v4.5m0 3h.01"/>
            </svg>
            <p>Заполните все обязательные поля</p>
            <div class="entry-notice-track" aria-hidden="true">
              <div id="entry-notice-countdown" class="entry-notice-countdown"></div>
            </div>
          </div>
        </div>
      </div>
      <form ref="form" class="entry-form" id="add-event-form" novalidate @submit.prevent="submit">
        <p class="entry-hint" id="add-event-hint">Используйте вымышленные данные. Поля со звёздочкой обязательны.</p>
        <fieldset class="entry-fields" id="entry-fields" :disabled="pending">
          <div class="entry-field">
            <label for="event-source">Источник <span class="required-marker" aria-hidden="true">*</span></label>
            <input
              v-model="draft.source"
              id="event-source"
              name="source"
              placeholder="Например, amoCRM"
              required
              maxlength="80"
              autofocus
              aria-describedby="source-error"
              :aria-invalid="fieldErrors.source ? true : undefined"
              @input="clearCorrectedField('source', $event)"
            >
            <p class="entry-field-error" id="source-error" :hidden="!fieldErrors.source">{{ fieldErrors.source }}</p>
          </div>
          <div class="entry-field">
            <label for="event-type">Тип события <span class="required-marker" aria-hidden="true">*</span></label>
            <input
              v-model="draft.type"
              id="event-type"
              name="type"
              placeholder="Например, lead.created"
              required
              maxlength="80"
              aria-describedby="type-error"
              :aria-invalid="fieldErrors.type ? true : undefined"
              @input="clearCorrectedField('type', $event)"
            >
            <p class="entry-field-error" id="type-error" :hidden="!fieldErrors.type">{{ fieldErrors.type }}</p>
          </div>
          <div class="entry-field">
            <label for="event-status">Статус <span class="required-marker" aria-hidden="true">*</span></label>
            <select
              v-model="draft.status"
              id="event-status"
              name="status"
              required
              aria-describedby="status-error"
              :aria-invalid="fieldErrors.status ? true : undefined"
              @change="clearCorrectedField('status', $event)"
            >
              <option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option>
            </select>
            <p class="entry-field-error" id="status-error" :hidden="!fieldErrors.status">{{ fieldErrors.status }}</p>
          </div>
          <div class="entry-field">
            <label for="event-message" id="event-message-label">
              {{ isError ? "Причина ошибки" : "Описание" }} <span class="required-marker" aria-hidden="true">*</span>
            </label>
            <textarea
              v-model="draft.message"
              id="event-message"
              name="message"
              rows="3"
              :placeholder="isError ? 'Например, отсутствует номер заказа' : 'Например, тестовая заявка принята'"
              required
              maxlength="500"
              aria-describedby="message-error"
              :aria-invalid="messageError ? true : undefined"
              @input="clearCorrectedField('message', $event)"
            ></textarea>
            <p class="entry-field-error" id="message-error" :hidden="!messageError">{{ messageError }}</p>
          </div>
        </fieldset>
        <div role="alert"><p class="entry-error" id="add-event-error" :hidden="!errorMessage">{{ errorMessage }}</p></div>
        <p class="sr-only" id="add-event-progress" role="status">{{ pending ? "Добавляем событие." : "" }}</p>
        <div class="entry-actions">
          <button class="button" id="cancel-add-event" type="button" :aria-disabled="pending || undefined" @click="close">Отмена</button>
          <button
            ref="submitButton"
            class="button primary-button"
            id="submit-event"
            type="submit"
            :aria-disabled="pending || undefined"
          >{{ pending ? "Добавляем…" : "Добавить событие" }}</button>
        </div>
      </form>
    </div>
  </dialog>
</template>
