import { expect } from '@playwright/test';
import type { IntegrationEvent } from '../../src/events';
import { test } from './fixtures';

const eventsPath = '/api/events';
const addEvent = 'Добавить тестовое событие';

test('offers recovery from initial failure and an action in an empty journal', async ({ appUrl, page }) => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  let firstRead = true;
  await page.route(`**${eventsPath}`, async (route) => {
    if (firstRead) {
      firstRead = false;
      await gate;
      await route.fulfill({ status: 503 });
      return;
    }
    await route.fulfill({ json: [] });
  });

  const journal = page.getByRole('region', { name: 'Журнал событий' });
  try {
    await page.goto(appUrl);
    await expect(journal.locator('#list-area')).toHaveAttribute('aria-busy', 'true');
    await expect(journal.locator('.skeleton-row').first()).toBeVisible();
  } finally {
    release();
  }

  await expect(journal.getByText('Журнал недоступен', { exact: true })).toBeVisible();
  const retry = journal.getByRole('button', { name: 'Повторить' });
  await expect(retry).toHaveCount(1);
  await retry.click();
  await expect(journal.getByText('Событий пока нет', { exact: true })).toBeVisible();
  await expect(page.locator('#count-total')).toHaveText('0');

  const emptyAction = journal.getByRole('button', { name: addEvent });
  await emptyAction.click();
  await expect(page.getByRole('dialog', { name: addEvent }).getByLabel('Источник')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(emptyAction).toBeFocused();
});

test('clears an empty filter while keeping the global counters', async ({ appUrl, page }) => {
  const response = await page.request.get(`${appUrl}${eventsPath}`);
  const events: IntegrationEvent[] = await response.json();
  const successes = events.filter((event) => event.status === 'success');
  await page.route(`**${eventsPath}`, (route) => route.fulfill({ json: successes }));
  await page.goto(appUrl);

  const journal = page.getByRole('region', { name: 'Журнал событий' });
  await expect(page.locator('#count-total')).toHaveText(String(successes.length));
  await journal.getByRole('button', { name: 'Ошибка', exact: true }).click();
  await expect(journal.getByText('Нет событий с этим статусом', { exact: true })).toBeVisible();
  await expect(page.locator('#count-total')).toHaveText(String(successes.length));
  await journal.getByRole('button', { name: 'Сбросить фильтр' }).click();
  const all = journal.getByRole('button', { name: 'Все', exact: true });
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toBeFocused();
  await expect(journal.getByRole('row')).toHaveCount(successes.length + 1);
});

test('keeps the last loaded rows and exposes retry when a refresh fails', async ({ appUrl, page }) => {
  await page.goto(appUrl);
  const journal = page.getByRole('region', { name: 'Журнал событий' });
  const row = journal.getByRole('button', { name: 'Открыть событие evt-1012' });
  await expect(row).toBeVisible();
  await page.route(`**${eventsPath}`, (route) => route.fulfill({ status: 503 }), { times: 1 });
  const refresh = page.getByRole('button', { name: 'Обновить', exact: true });
  await refresh.click();

  const retry = journal.getByRole('button', { name: 'Повторить' });
  await expect(retry).toBeVisible();
  await expect(row).toBeVisible();
  await expect(page.locator('#count-total')).toHaveText('12');
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(refresh).toBeFocused();
  await expect(row).toBeVisible();
});

test('does not select a different event when a server restart reuses an identifier', async ({ appUrl, page }) => {
  await page.clock.install();
  const response = await page.request.get(`${appUrl}${eventsPath}`);
  const events: IntegrationEvent[] = await response.json();
  const [original] = events;
  const replacement = {
    ...original,
    created_at: new Date(Date.parse(original.created_at) + 1_000).toISOString(),
    message: 'Другое событие после перезапуска',
  };
  await page.goto(appUrl);
  const row = page.locator(`[data-event-id="${original.id}"]`);
  await row.getByRole('button').click();
  const details = page.getByRole('dialog', { name: 'Детали события' });
  await expect(details.getByText(original.message, { exact: true })).toBeVisible();
  await expect(row).toHaveAttribute('data-selected', 'true');

  await page.route(`**${eventsPath}`, (route) => route.fulfill({ json: [replacement] }));
  await page.clock.fastForward(5_000);
  await expect(row).toContainText(replacement.message);
  await expect(row).not.toHaveAttribute('data-selected', 'true');
  await expect(details.getByText(original.message, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Все', exact: true })).toBeFocused();
});
