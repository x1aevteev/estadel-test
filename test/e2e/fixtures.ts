import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test as base } from '@playwright/test';
import { createAppServer } from '../../server/app.js';

export const test = base.extend<{ appUrl: string }>({
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
