import seedEvents from '../content/seed-events.json' with { type: 'json' };

const ID_PREFIX = 'evt-';
const STATUSES = ['success', 'error'];
const TEXT_FIELDS = { source: 80, type: 80, message: 500 };

function validateEvent(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: { message: 'Тело запроса должно быть JSON-объектом.' } };
  }

  const fields = {};
  const data = {};
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) {
    const value = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!value || value.length > limit) {
      fields[field] = `Укажите непустую строку длиной до ${limit} символов.`;
    } else {
      data[field] = value;
    }
  }

  const status = typeof input.status === 'string' ? input.status.trim() : '';
  if (!STATUSES.includes(status)) {
    fields.status = 'Укажите статус success или error.';
  }
  if (Object.keys(fields).length > 0) {
    return { error: { message: 'Проверьте поля события.', fields } };
  }
  return { data: { ...data, status } };
}

export function createEventJournal() {
  const events = seedEvents.map((event) => ({ ...event }));
  let nextNumber = Math.max(...events.map(({ id }) => Number(id.slice(ID_PREFIX.length)))) + 1;

  return {
    list() {
      return events;
    },
    append(input) {
      const validation = validateEvent(input);
      if ('error' in validation) return validation;

      const event = {
        id: `${ID_PREFIX}${nextNumber}`,
        ...validation.data,
        created_at: new Date().toISOString(),
      };
      events.unshift(event);
      nextNumber += 1;
      return { event };
    },
  };
}
