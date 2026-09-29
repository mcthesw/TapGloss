import { browser } from 'wxt/browser';
import { readingControlsSchema, readingEnabled } from '../domain/reading';

export function createReadingControls(changed: () => void) {
  const read = async () =>
    readingControlsSchema.parse((await browser.storage.local.get('readingControls')).readingControls ?? {});
  const action = browser.action ?? browser.browserAction;
  const badge = async (tab: { id?: number; url?: string }) => {
    if (tab.id === undefined) return;
    const enabled = readingEnabled(await read(), tab.url);
    await action.setBadgeText({ tabId: tab.id, text: enabled ? '' : 'Ⅱ' });
    await action.setBadgeBackgroundColor({ tabId: tab.id, color: '#666666' });
  };
  browser.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.url || change.status === 'complete') void badge({ ...tab, id }).catch(() => {});
  });
  const refresh = async () => {
    await Promise.all((await browser.tabs.query({})).map((tab) => badge(tab).catch(() => {})));
  };
  void refresh().catch(() => {});
  let writing = Promise.resolve();
  return {
    read,
    change(patch: { enabled?: boolean; hostname?: string; siteEnabled?: boolean }) {
      const work = writing.then(async () => {
        const value = await read();
        if (patch.enabled !== undefined) value.enabled = patch.enabled;
        if (patch.hostname && patch.siteEnabled !== undefined) {
          const host = patch.hostname.toLowerCase();
          value.disabledSites = value.disabledSites.filter((site) => site !== host);
          if (!patch.siteEnabled) value.disabledSites.push(host);
        }
        await browser.storage.local.set({ readingControls: value });
        changed();
        await refresh();
        return value;
      });
      writing = work.then(
        () => {},
        () => {},
      );
      return work;
    },
  };
}
