export type EventStatus = "success" | "error";
export type StatusFilter = "all" | EventStatus;
export type TimeOrder = "ascending" | "descending";

export interface EventDraft {
  source: string;
  type: string;
  status: EventStatus;
  message: string;
}

export interface IntegrationEvent extends EventDraft {
  id: string;
  created_at: string;
}

export const statusLabels = { success: "Успешно", error: "Ошибка" } as const;

export const eventFields = ["source", "type", "status", "message"] as const;

const timeZone = "Europe/Moscow";

export const clock = new Intl.DateTimeFormat("ru-RU", { timeZone, timeStyle: "medium" });
export const shortDate = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "short" });
export const fullDate = new Intl.DateTimeFormat("ru-RU", { timeZone, dateStyle: "long", timeStyle: "medium" });

export function isEvent(value: unknown): value is IntegrationEvent {
  if (value === null || typeof value !== "object") return false;
  const event = value as Partial<Record<keyof IntegrationEvent, unknown>>;
  return typeof event.id === "string"
    && typeof event.source === "string"
    && typeof event.type === "string"
    && typeof event.message === "string"
    && (event.status === "success" || event.status === "error")
    && typeof event.created_at === "string"
    && Number.isFinite(Date.parse(event.created_at));
}
