import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  imports: false,
  zip: { excludeSources: ['test-results/**', 'playwright-report/**'] },
  vite: () => ({ plugins: [preact(), tailwind()] }),
  manifest: {
    name: 'TapGloss',
    description: '结合语境查词，生成例句并保存到 Anki。',
    permissions: ['storage', 'alarms'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'TapGloss' },
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
