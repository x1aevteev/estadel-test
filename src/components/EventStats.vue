<script setup lang="ts">
defineProps<{
  total: number | null;
  successful: number | null;
  failed: number | null;
}>();
</script>

<template>
  <section aria-label="Статистика событий">
    <dl class="metrics">
      <div class="metric">
        <dt>
          <span class="metric-icon metric-icon-total" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5"/>
            </svg>
          </span>
          Всего событий
        </dt>
        <dd id="count-total">{{ total ?? "—" }}</dd>
      </div>
      <div class="metric">
        <dt>
          <span class="metric-icon metric-icon-success" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="8.5"/>
              <path d="m8.5 12 2.3 2.5 4.7-5"/>
            </svg>
          </span>
          Успешно
        </dt>
        <dd id="count-success">{{ successful ?? "—" }}</dd>
      </div>
      <div class="metric">
        <dt>
          <span class="metric-icon metric-icon-error" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5"/>
              <path d="M12 8v4.5m0 3h.01"/>
            </svg>
          </span>
          С ошибкой
        </dt>
        <dd id="count-error">{{ failed ?? "—" }}</dd>
      </div>
    </dl>
  </section>
</template>
