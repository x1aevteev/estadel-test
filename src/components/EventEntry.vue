<script setup lang="ts">
import { computed, nextTick, reactive, ref } from "vue";
import { eventFields, isEvent, statusLabels, type EventDraft, type IntegrationEvent } from "../events";

type EventField = keyof EventDraft;
type FieldErrors = Partial<Record<EventField, string>>;

const props = defineProps<{
  includeEvent: (event: IntegrationEvent) => Promise<boolean>;
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

async function open() {
  Object.assign(draft, emptyDraft);
  errorMessage.value = "";
  fieldErrors.value = {};
  await nextTick();
  drawer.value?.showModal();
}

function close() {
  if (!pending.value) drawer.value?.close();
}

function preventPendingClose(event: Event) {
  if (pending.value) event.preventDefault();
}

async function submit() {
  if (pending.value) return;
  const payload = { ...draft };
  errorMessage.value = "";
  fieldErrors.value = {};
  pending.value = true;

  let firstInvalid: EventField | undefined;
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

    const switchedFilter = await props.includeEvent(result);
    drawer.value?.close();
    emit("saved", switchedFilter);
  } catch {
    errorMessage.value = "Не удалось подтвердить сохранение. Проверьте журнал перед повторной отправкой.";
  } finally {
    pending.value = false;
    if (firstInvalid) {
      await nextTick();
      const control = form.value?.elements.namedItem(firstInvalid);
      if (control instanceof HTMLElement) control.focus();
    }
  }
}

defineExpose({ open });
</script>

<template>
  <dialog
    ref="drawer"
    class="detail-drawer"
    id="add-event-dialog"
    aria-labelledby="add-event-title"
    aria-describedby="add-event-hint"
    @cancel="preventPendingClose"
    @close="emit('close')"
  >
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
    <form ref="form" class="entry-form" id="add-event-form" @submit.prevent="submit">
      <p class="entry-hint" id="add-event-hint">Используйте вымышленные данные. Все поля обязательны.</p>
      <fieldset class="entry-fields" id="entry-fields" :disabled="pending">
        <div class="entry-field">
          <label for="event-source">Источник</label>
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
            @input="delete fieldErrors.source"
          >
          <p class="entry-field-error" id="source-error" :hidden="!fieldErrors.source">{{ fieldErrors.source }}</p>
        </div>
        <div class="entry-field">
          <label for="event-type">Тип события</label>
          <input
            v-model="draft.type"
            id="event-type"
            name="type"
            placeholder="Например, lead.created"
            required
            maxlength="80"
            aria-describedby="type-error"
            :aria-invalid="fieldErrors.type ? true : undefined"
            @input="delete fieldErrors.type"
          >
          <p class="entry-field-error" id="type-error" :hidden="!fieldErrors.type">{{ fieldErrors.type }}</p>
        </div>
        <div class="entry-field">
          <label for="event-status">Статус</label>
          <select
            v-model="draft.status"
            id="event-status"
            name="status"
            required
            aria-describedby="status-error"
            :aria-invalid="fieldErrors.status ? true : undefined"
            @change="delete fieldErrors.status"
          >
            <option v-for="(label, status) in statusLabels" :key="status" :value="status">{{ label }}</option>
          </select>
          <p class="entry-field-error" id="status-error" :hidden="!fieldErrors.status">{{ fieldErrors.status }}</p>
        </div>
        <div class="entry-field">
          <label for="event-message" id="event-message-label">{{ isError ? "Причина ошибки" : "Описание" }}</label>
          <textarea
            v-model="draft.message"
            id="event-message"
            name="message"
            rows="3"
            :placeholder="isError ? 'Например, отсутствует номер заказа' : 'Например, тестовая заявка принята'"
            required
            maxlength="500"
            aria-describedby="message-error"
            :aria-invalid="fieldErrors.message ? true : undefined"
            @input="delete fieldErrors.message"
          ></textarea>
          <p class="entry-field-error" id="message-error" :hidden="!fieldErrors.message">{{ fieldErrors.message }}</p>
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
  </dialog>
</template>
