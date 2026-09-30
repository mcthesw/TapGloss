import { expect, it } from 'vitest';
import { Builder, By, until } from 'selenium-webdriver';
import { Options, type Driver } from 'selenium-webdriver/firefox';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { startSyncServer } from './sync-servers';
import { fakeServices } from './fixtures';

it.skipIf(!process.env.TAPGLOSS_FIREFOX_TEST)(
  'runs actual Firefox lookup, wordlist UI, local backup and two-device S3/WebDAV sync',
  async () => {
    const services = fakeServices();
    const api = createServer(async (request, response) => {
      if (request.url === '/reading') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          '<!doctype html><body style="font:24px/2 sans-serif;padding:50px"><p>She was <span id="target">reluctant</span> to ask for help.</p></body>',
        );
        return;
      }
      if (request.method === 'GET') {
        response.writeHead(404);
        response.end();
        return;
      }
      let body = '';
      for await (const part of request) body += part;
      const result = await services.fetcher(`http://localhost${request.url}`, { body });
      response.setHeader('Content-Type', 'application/json');
      response.end(await result.text());
    });
    await new Promise<void>((done) => api.listen(0, '127.0.0.1', done));
    const address = api.address();
    if (!address || typeof address === 'string') throw new Error('No test API');
    const origin = `http://127.0.0.1:${address.port}`;
    const version = JSON.parse(await readFile('package.json', 'utf8')).version;
    const drivers: Driver[] = [],
      urls: string[] = [];
    const directory = await mkdtemp(join(tmpdir(), 'tapgloss-firefox-'));
    const button = (driver: Driver, text: string) =>
      driver.findElement(By.xpath(`//button[normalize-space()="${text}"]`));
    const field = (driver: Driver, label: string) =>
      driver.wait(
        until.elementLocated(
          By.xpath(
            `//label[normalize-space(text())="${label}"]/input | //input[@id=//label[normalize-space()="${label}"]/@for]`,
          ),
        ),
        10000,
      );
    const fill = async (driver: Driver, label: string, value: string) => {
      const input = await field(driver, label);
      await input.clear();
      await input.sendKeys(value);
    };
    const save = async (driver: Driver) => {
      await (await button(driver, 'Save')).click();
      await driver.wait(
        async () => (await (await button(driver, 'Save')).getDomAttribute('title')) === 'Saved',
        10000,
      );
    };
    try {
      for (let i = 0; i < 2; i++) {
        const options = new Options()
          .addArguments('-headless')
          .setPreference('intl.accept_languages', 'en-US')
          .setPreference('browser.download.folderList', 2)
          .setPreference('browser.download.dir', directory)
          .setPreference('browser.download.useDownloadDir', true)
          .setPreference('browser.helperApps.neverAsk.saveToDisk', 'application/octet-stream');
        if (process.env.TAPGLOSS_FIREFOX_BINARY) options.setBinary(process.env.TAPGLOSS_FIREFOX_BINARY);
        const driver = (await new Builder()
          .forBrowser('firefox')
          .setFirefoxOptions(options)
          .build()) as Driver;
        drivers.push(driver);
        await driver.manage().setTimeouts({ pageLoad: 30000 });
        await driver.manage().window().setRect({ width: 1280, height: 900 });
        await driver.installAddon(resolve(`.output/tapgloss-${version}-firefox.zip`), true);
        const url = (await driver.wait(async () => {
          for (const window of await driver.getAllWindowHandles()) {
            await driver.switchTo().window(window);
            const url = await driver.getCurrentUrl();
            if (url.startsWith('moz-extension:') && url.includes('options.html')) return url;
          }
          return false;
        }, 20000)) as string;
        urls.push(url);
        await driver.wait(until.elementLocated(By.xpath('//button[normalize-space()="Settings"]')), 10000);
        await fill(driver, 'API URL', origin);
        await fill(driver, 'API Key', 'test-only');
        await fill(driver, 'AnkiConnect URL', origin + '/anki');
        await save(driver);
      }
      const [a, b] = drivers as [Driver, Driver];
      const optionsWindow = await a.getWindowHandle();
      await a.switchTo().newWindow('tab');
      await a.get(origin + '/reading');
      await a.wait(until.elementLocated(By.css('tap-gloss')), 10000);
      await a.findElement(By.id('target')).click();
      await a.wait(async () => services.counts().adds === 1, 15000);
      const host = await a.findElement(By.css('tap-gloss'));
      expect(await host.getDomAttribute('data-theme')).toBe('light');
      const shadow = await host.getShadowRoot();
      await a.wait(
        async () => (await (await shadow.findElement(By.css('.lookup'))).getText()).includes('Saved to Anki'),
        10000,
      );
      await mkdir('.output/firefox-review', { recursive: true });
      await writeFile('.output/firefox-review/lookup.png', await a.takeScreenshot(), 'base64');
      await a.close();
      await a.switchTo().window(optionsWindow);
      await (await button(a, 'Wordlists')).click();
      const path = join(directory, 'Common.txt');
      await writeFile(path, 'rain\noutside');
      await a
        .wait(until.elementLocated(By.css('input[aria-label="Choose a wordlist file"]')), 10000)
        .sendKeys(path);
      await a.wait(until.elementLocated(By.css('dialog[open]')), 10000);
      await a.findElement(By.xpath('//dialog//button[normalize-space()="Import"]')).click();
      await a.wait(until.elementLocated(By.xpath('//h2[normalize-space()="Common"]')), 10000);
      await writeFile('.output/firefox-review/wordlists.png', await a.takeScreenshot(), 'base64');
      await (await button(a, 'Settings')).click();
      await (await button(a, 'Export backup')).click();
      const backup = await a.wait(async () => {
        const files = await readdir(directory);
        return files.find((file) => file.endsWith('.tapgloss') && !files.includes(file + '.part'));
      }, 10000);
      if (!backup) throw new Error('Backup download missing');
      const beforeRestore = services.counts();
      for (let i = 0; i < 2; i++) {
        await b
          .findElement(By.css('input[aria-label="Choose backup file"]'))
          .sendKeys(join(directory, backup));
        await b.wait(until.elementLocated(By.css('dialog[open]')), 10000);
        await b.findElement(By.xpath('//dialog//button[normalize-space()="Restore"]')).click();
        await b.wait(
          until.elementLocated(By.xpath('//*[@role="status" and normalize-space()="Restore complete"]')),
          10000,
        );
      }
      expect(services.counts()).toEqual(beforeRestore);
      await (await button(b, 'Records')).click();
      await b.wait(until.elementLocated(By.xpath('//span[normalize-space()="reluctant"]')), 10000);
      await (await button(b, 'Wordlists')).click();
      await b.wait(until.elementLocated(By.xpath('//h2[normalize-space()="Common"]')), 10000);
      for (const backend of ['s3', 'webdav'] as const) {
        const server = await startSyncServer(backend);
        try {
          for (const driver of drivers) {
            await (await button(driver, 'Settings')).click();
            await (await field(driver, 'Storage')).click();
            await driver
              .findElement(
                By.xpath(`//*[@role="option" and normalize-space()="${backend === 's3' ? 'S3' : 'WebDAV'}"]`),
              )
              .click();
            await fill(driver, backend === 's3' ? 'S3 endpoint' : 'WebDAV URL', server.config.endpoint);
            if (backend === 's3') await fill(driver, 'Bucket', server.config.bucket);
            await fill(driver, backend === 's3' ? 'Access Key ID' : 'Username', server.config.username);
            await fill(driver, backend === 's3' ? 'Secret Access Key' : 'Password', server.config.password);
            await (await button(driver, 'Test sync connection')).click();
            await driver.wait(
              until.elementLocated(By.xpath('//*[@role="status" and normalize-space()="Connected"]')),
              10000,
            );
            await save(driver);
            await (await button(driver, 'Sync now')).click();
            await driver.wait(
              until.elementLocated(By.xpath('//button[normalize-space()="Sync now" and not(@disabled)]')),
              15000,
            );
            await driver.wait(
              until.elementLocated(By.xpath('//p[starts-with(normalize-space(),"Last synced")]')),
              10000,
            );
          }
          await (await button(b, 'Records')).click();
          await b.wait(until.elementLocated(By.xpath('//span[normalize-space()="reluctant"]')), 10000);
          await (await button(b, 'Wordlists')).click();
          await b.wait(until.elementLocated(By.xpath('//h2[normalize-space()="Common"]')), 10000);
          expect(services.counts()).toEqual({ generations: 1, adds: 1 });
        } finally {
          await server.close();
        }
      }
      await writeFile(
        '.output/firefox-review/result.json',
        JSON.stringify(
          {
            browser: (await a.getCapabilities()).get('browserVersion'),
            lookup: true,
            wordlistImport: true,
            backupRestore: true,
            s3: true,
            webdav: true,
            duplicateNotes: 0,
          },
          null,
          2,
        ),
      );
    } finally {
      await Promise.all(drivers.map((driver) => driver.quit()));
      await new Promise<void>((done) => api.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    }
  },
  180000,
);
