import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  imports: false,
  hooks: {
    'build:done': async (wxt) => {
      await copyFile(new URL('./LICENSE', import.meta.url), resolve(wxt.config.outDir, 'LICENSE'));
    },
  },
  zip: { excludeSources: ['test-results/**', 'playwright-report/**'] },
  vite: () => ({ build: { modulePreload: false }, plugins: [preact(), tailwind()] }),
  manifest: {
    name: 'TapGloss',
    description: '结合语境查词，生成例句并保存到 Anki。',
    permissions: ['storage', 'alarms'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: {
      default_title: 'TapGloss',
      default_icon: { 16: 'icon/16.png', 32: 'icon/32.png' },
    },
    browser_specific_settings: {
      gecko: {
        id: 'tapgloss@tapgloss.local',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['websiteContent', 'browsingActivity', 'authenticationInfo'],
        },
      },
    },
  },
});
