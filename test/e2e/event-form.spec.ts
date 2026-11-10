import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, test as base, type Locator, type Response } from '@playwright/test';
import { createAppServer } from '../../server/app.js';

const eventsPath = '/api/events';
const formTitle = 'Добавить тестовое событие';
const draft = {
  source: 'Тестовая доставка',
  type: 'delivery.created',
  status: 'error',
  message: 'В тестовом событии нет номера отправления.',
};

const test = base.extend<{ appUrl: string }>({
  appUrl: async ({}, use) => {
    const server = createAppServer();
    await once(server.listen(0, '127.0.0.1'), 'listening');
    const address = server.address() as AddressInfo;
    try {
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

function isCreateResponse(response: Response) {
  return new URL(response.url()).pathname === eventsPath && response.request().method() === 'POST';
}

async function fillForm(form: Locator, source = draft.source) {
  await form.getByLabel('Источник').fill(source);
  await form.getByLabel('Тип события').fill(draft.type);
  await form.getByLabel('Статус').selectOption(draft.status);
  await form.getByLabel('Причина ошибки').fill(draft.message);
}

async function expectDraft(form: Locator, source = draft.source) {
  await expect(form.getByLabel('Источник')).toHaveValue(source);
  await expect(form.getByLabel('Тип события')).toHaveValue(draft.type);
  await expect(form.getByLabel('Статус')).toHaveValue(draft.status);
  await expect(form.getByLabel('Причина ошибки')).toHaveValue(draft.message);
}

test.beforeEach(async ({ appUrl, page }) => {
  await page.goto(appUrl);
  await expect(page.locator('#count-total')).toHaveText('12');
});

test('sends the form to the API and displays the new event under an initially incompatible filter', async ({ page }) => {
  const filters = page.getByRole('group', { name: 'Фильтр по статусу' });
  await filters.getByRole('button', { name: 'Успешно' }).click();
  const opener = page.getByRole('button', { name: formTitle });
  await opener.click();
  const form = page.getByRole('dialog', { name: formTitle });
  await fillForm(form);

  const responsePromise = page.waitForResponse(isCreateResponse);
  await form.getByRole('button', { name: 'Добавить событие' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual(draft);
  expect(await response.json()).toMatchObject({ ...draft, id: 'evt-1013' });

  await expect(form).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator('#creation-success')).toContainText('Событие добавлено');
  await expect(filters.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#count-total')).toHaveText('13');
  await expect(page.locator('#count-success')).toHaveText('8');
  await expect(page.locator('#count-error')).toHaveText('5');
  const row = page.getByRole('row').filter({ hasText: draft.type });
  await expect(row).toContainText(draft.source);
  await expect(row).toContainText(draft.message);
  await row.getByRole('button', { name: 'Открыть событие evt-1013' }).click();
  await expect(page.getByRole('dialog')).toContainText(draft.message);
});

test('requires fields in the browser and retains the draft after real API validation', async ({ appUrl, page }) => {
  let submissions = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === eventsPath && request.method() === 'POST') {
      submissions += 1;
    }
  });

  await page.getByRole('button', { name: formTitle }).click();
  const form = page.getByRole('dialog', { name: formTitle });
  const submit = form.getByRole('button', { name: 'Добавить событие' });
  const source = form.getByLabel('Источник');
  await submit.click();
  expect(await source.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  await expect(source).toBeFocused();
  expect(submissions).toBe(0);

  await fillForm(form, '   ');
  const responsePromise = page.waitForResponse(isCreateResponse);
  await submit.click();
  const response = await responsePromise;
  expect(response.status()).toBe(400);
  const { error } = await response.json();
  await expect(form.getByRole('alert')).toContainText(error.message);
  await expect(form.locator('#source-error')).toHaveText(error.fields.source);
  await expect(source).toHaveAttribute('aria-invalid', 'true');
  await expect(source).toBeFocused();
  await expectDraft(form, '   ');
  const journal = await page.request.get(`${appUrl}${eventsPath}`);
  expect(await journal.json()).toHaveLength(12);

  await source.fill(draft.source);
  await expect(source).not.toHaveAttribute('aria-invalid', 'true');
  await submit.click();
  await expect(form).toBeHidden();
  await expect(page.locator('#count-total')).toHaveText('13');
});

test('keeps the draft and permits retry after a server failure', async ({ page }) => {
  let rejectNextPost = true;
  await page.route(`**${eventsPath}`, async (route) => {
    if (route.request().method() === 'POST' && rejectNextPost) {
      rejectNextPost = false;
      await route.fulfill({ status: 500, body: '' });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: formTitle }).click();
  const form = page.getByRole('dialog', { name: formTitle });
  await fillForm(form);
  const submit = form.getByRole('button', { name: 'Добавить событие' });
  await submit.click();
  await expect(form.getByRole('alert')).toContainText('Не удалось');
  await expectDraft(form);
  await expect(page.locator('#count-total')).toHaveText('12');

  const responsePromise = page.waitForResponse(isCreateResponse);
  await submit.click();
  expect((await responsePromise).status()).toBe(201);
  await expect(form).toBeHidden();
});

test('ignores repeated submission and keeps the dialog open while the POST is pending', async ({ appUrl, page }) => {
  let submissions = 0;
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  await page.route(`**${eventsPath}`, async (route) => {
    if (route.request().method() === 'POST') {
      submissions += 1;
      await gate;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: formTitle }).click();
  const form = page.getByRole('dialog', { name: formTitle });
  await fillForm(form);
  try {
    await form.getByRole('button', { name: 'Добавить событие' }).click();
    const pendingButton = form.getByRole('button', { name: 'Добавляем…' });
    await expect(pendingButton).toHaveAttribute('aria-disabled', 'true');
    await pendingButton.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(form).toBeVisible();
  } finally {
    release();
  }

  await expect(form).toBeHidden();
  expect(submissions).toBe(1);
  const journal = await page.request.get(`${appUrl}${eventsPath}`);
  expect(await journal.json()).toHaveLength(13);
});
