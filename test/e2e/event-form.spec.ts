import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, test as base, type Locator, type Page, type Response } from '@playwright/test';
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

async function holdNextJournalRead(page: Page) {
  const { promise: started, resolve: signalStarted } = Promise.withResolvers<void>();
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  let holdNextRead = true;
  await page.route(`**${eventsPath}`, async (route) => {
    if (!holdNextRead || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    holdNextRead = false;
    const response = await route.fetch();
    signalStarted();
    await gate;
    await route.fulfill({ response });
  });
  return { started, release };
}

async function fillForm(form: Locator) {
  await form.getByLabel('Источник').fill(draft.source);
  await form.getByLabel('Тип события').fill(draft.type);
  await form.getByLabel('Статус').selectOption(draft.status);
  await form.getByLabel('Причина ошибки').fill(draft.message);
}

async function expectDraft(form: Locator) {
  await expect(form.getByLabel('Источник')).toHaveValue(draft.source);
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

test('confirms a successful POST while the first journal read is still pending', async ({ page }) => {
  const read = await holdNextJournalRead(page);
  const opener = page.getByRole('button', { name: formTitle });
  const form = page.getByRole('dialog', { name: formTitle });
  try {
    await page.reload();
    await read.started;
    await opener.click();
    await fillForm(form);
    const created = page.waitForResponse(isCreateResponse);
    await form.getByRole('button', { name: 'Добавить событие' }).click();
    expect((await created).status()).toBe(201);
    await expect(form).toBeHidden({ timeout: 2_000 });
    await expect(opener).toBeFocused();
    await expect(page.locator('#creation-success')).toContainText('Событие добавлено');
    await expect(page.locator('#count-total')).toHaveText('—');
  } finally {
    read.release();
  }

  await expect(page.locator('#count-total')).toHaveText('13');
  await expect(page.getByRole('button', { name: 'Открыть событие evt-1013' })).toHaveCount(1);
});

test('keeps the created event when an older GET returns after the POST', async ({ page }) => {
  const read = await holdNextJournalRead(page);
  const refresh = page.getByRole('button', { name: 'Обновить' });
  const form = page.getByRole('dialog', { name: formTitle });
  try {
    await refresh.click();
    await read.started;
    await page.getByRole('button', { name: formTitle }).click();
    await fillForm(form);
    const created = page.waitForResponse(isCreateResponse);
    await form.getByRole('button', { name: 'Добавить событие' }).click();
    expect((await created).status()).toBe(201);
    await expect(form).toBeHidden();
    await expect(page.locator('#count-total')).toHaveText('13');
    await expect(refresh).toHaveAttribute('aria-disabled', 'true');
  } finally {
    read.release();
  }

  await expect(refresh).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#count-total')).toHaveText('13');
  await expect(page.getByRole('button', { name: 'Открыть событие evt-1013' })).toHaveCount(1);
});

test('marks missing fields and resets the dismissal timer on a repeated attempt', async ({ page }) => {
  await page.clock.install();
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
  const type = form.getByLabel('Тип события');
  const description = form.getByLabel('Описание');
  const notice = form.getByText('Заполните все обязательные поля', { exact: true });
  const markers = form.locator('.required-marker');
  await expect(markers).toHaveCount(4);
  await expect(markers.first()).toBeVisible();
  await source.fill('   ');

  await submit.click();
  await expect(notice).toBeVisible();
  await expect(source).toBeFocused();
  for (const field of [source, type, description]) {
    await expect(field).toHaveAttribute('aria-invalid', 'true');
  }
  const status = form.getByLabel('Статус');
  const messageError = form.locator('#message-error');
  await expect(status).not.toHaveAttribute('aria-invalid', 'true');
  await expect(messageError).toHaveText('Добавьте описание.');
  await status.selectOption('error');
  await expect(form.getByLabel('Причина ошибки')).toHaveAttribute('aria-invalid', 'true');
  await expect(messageError).toHaveText('Укажите причину ошибки.');

  await source.fill(draft.source);
  await expect(source).not.toHaveAttribute('aria-invalid', 'true');
  await page.clock.runFor(2_500);
  await submit.click();
  await expect(type).toBeFocused();
  await page.clock.runFor(3_000);
  await expect(notice).toBeVisible();
  await page.clock.runFor(2_500);
  await expect(notice).toBeHidden();
  await expect(type).toHaveAttribute('aria-invalid', 'true');
  await expect(source).toHaveValue(draft.source);
  expect(submissions).toBe(0);
});

test.describe('on a short mobile screen', () => {
  test.use({ viewport: { width: 280, height: 240 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });

  test('keeps the notice and the complete invalid field in view', async ({ page }) => {
    await page.getByRole('button', { name: formTitle }).tap();
    const form = page.getByRole('dialog', { name: formTitle });
    await form.getByLabel('Источник').fill(draft.source);
    await form.getByLabel('Тип события').fill(draft.type);
    await form.getByRole('button', { name: 'Добавить событие' }).tap();

    const description = form.getByLabel('Описание');
    await expect(description).toBeFocused();
    await expect(form.locator('#entry-required-notice')).toBeVisible();
    await expect(form.locator('#message-error')).toHaveText('Добавьте описание.');
    await expect.poll(() => description.evaluate((control) => {
      const field = control.closest('.entry-field')?.getBoundingClientRect();
      const scroller = control.closest('form')?.getBoundingClientRect();
      const notice = document.querySelector('#entry-required-notice')?.getBoundingClientRect();
      if (!field || !scroller || !notice) return false;
      return notice.top >= 0 && notice.bottom <= scroller.top + 1
        && field.top >= scroller.top - 1 && field.bottom <= scroller.bottom + 1
        && field.bottom <= window.innerHeight + 1;
    })).toBe(true);
  });
});

test('retains the draft after real API validation', async ({ appUrl, page }) => {
  let rejectNextPost = true;
  await page.route(`**${eventsPath}`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && rejectNextPost) {
      rejectNextPost = false;
      await route.continue({ postData: { ...request.postDataJSON(), source: '' } });
      return;
    }
    await route.continue();
  });

  await page.getByRole('button', { name: formTitle }).click();
  const form = page.getByRole('dialog', { name: formTitle });
  const submit = form.getByRole('button', { name: 'Добавить событие' });
  const source = form.getByLabel('Источник');
  await fillForm(form);

  const responsePromise = page.waitForResponse(isCreateResponse);
  await submit.click();
  const response = await responsePromise;
  expect(response.status()).toBe(400);
  const { error } = await response.json();
  await expect(form.getByRole('alert').filter({ hasText: error.message })).toBeVisible();
  await expect(form.locator('#source-error')).toHaveText(error.fields.source);
  await expect(source).toHaveAttribute('aria-invalid', 'true');
  await expect(source).toBeFocused();
  await expectDraft(form);
  const journal = await page.request.get(`${appUrl}${eventsPath}`);
  expect(await journal.json()).toHaveLength(12);

  await source.fill('Повторная доставка');
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
  await expect(form.getByRole('alert').filter({ hasText: 'Не удалось' })).toBeVisible();
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
