import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  imports: false,
  zip: { excludeSources: ['test-results/**', 'playwright-report/**'] },
  vite: () => ({ plugins: [preact(), tailwind()] }),
  manifest: {
    name: 'TapGloss',
    description: '点一下，理解语境，记住表达。',
    permissions: ['storage', 'alarms'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'TapGloss · 记录与设置' },
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
