# 开发

```sh
pnpm run dev
pnpm run check
pnpm run lint
pnpm run format:check
pnpm test
pnpm exec playwright install chromium
pnpm run build
pnpm run test:e2e
```

`pnpm run dev:firefox` 启动 Firefox 开发模式。`pnpm run zip` 与 `pnpm run zip:firefox` 在 `.output` 生成分发压缩包。

浏览器测试使用独立临时配置和本机模拟服务，不操作日常浏览器或私人 Anki 数据。可以用 `TAPGLOSS_TEST_BROWSER` 指定已有 Chromium 可执行文件。

真实集成测试默认跳过。临时设置 `TAPGLOSS_LIVE_API_KEY` 可以验证模型连接，可选 `TAPGLOSS_LIVE_BASE_URL` 与 `TAPGLOSS_LIVE_MODEL`。设置 `TAPGLOSS_LIVE_ANKI=1` 会在正在运行的 Anki 中创建测试笔记并在结束时删除该测试笔记，专用牌组和笔记类型保留。运行 `pnpm exec vitest run tests/live.test.ts`；不要把真实凭据写入文件或提交。

可复现的大数据测试：`pnpm run build` 后执行 `node scripts/benchmark-records.mjs 100000`。脚本使用独立浏览器配置与合成数据，不连接真实 Anki 或模型；报告和截图写入 `.output/benchmark-100000-v2`。可用 `TAPGLOSS_TEST_BROWSER` 指定 Chromium；设置 `TAPGLOSS_BENCH_LEGACY` 为旧版解压目录可验证旧库迁移。迁移测试会在临时浏览器配置中开启开发者模式并重载该测试扩展。

同步测试使用临时 S3 兼容服务和 WebDAV 服务，两份独立浏览器配置验证传输与 Anki 边界，不需要私人云存储凭据。构建后执行 `node scripts/benchmark-sync.mjs 100000` 可测同步的大库开销；结果位于 `.output/sync-performance/`，使用真正的 Chromium IndexedDB 与本机 S3 兼容 HTTP 服务，不代表广域网耗时。

`node scripts/benchmark-wordlists.mjs 100000` 验证词表预览、导入和按页面词语查询的开销，使用独立 Chromium 配置，结果与截图写入 `.output/wordlist-performance/`。

Firefox 实际浏览器测试：先执行 `pnpm run zip:firefox`，设置 `TAPGLOSS_FIREFOX_TEST=1` 后执行 `pnpm exec vitest run tests/firefox.test.ts`。可以通过 `TAPGLOSS_FIREFOX_BINARY` 指定 Firefox 路径。Selenium 会管理测试驱动，创建独立临时配置并临时安装扩展；测试通过实际控件验证查词、词表导入与两种后端同步，不使用日常浏览器配置。

## 代码边界

入口负责装配配置和后台任务；页面层只负责文本定位与展示。模型、Anki 与本地存储分别集中在 `src/explain`、`src/anki`、`src/storage`；普通领域类型与校验位于 `src/domain`。后台任务持久化保存重试状态，使用稳定笔记身份核验不确定的 Anki 写入结果。

`src/sync` 包含合并文档、分片交换、传输适配和调度服务。业务写入与待同步变更在同一个 IndexedDB 事务中提交；Anki 绑定单独存储。AWS SDK 的 pnpm 补丁仅取消 XML 解析器的浏览器重定向，以使用 SDK 自带的无 DOM 解析器，兼容扩展 Service Worker。

产品设计见 [docs/design.md](design.md)，术语见 [CONTEXT.md](../CONTEXT.md)。

## 发布

release-please 根据 `main` 上的 Conventional Commits 维护版本 PR，更新 `package.json`、版本清单和 `CHANGELOG.md`。首版为 `0.3.0`；0.x 阶段功能更新增加 minor，修复增加 patch。合并版本 PR 后创建 `v` 前缀标签及 GitHub Release。

工作流使用仓库的 `GITHUB_TOKEN`，需允许 GitHub Actions 创建 PR。由该令牌创建的 PR 和标签不会触发普通工作流，因此 release-please 直接调用检查和打包工作流，无需额外 PAT。版本 PR 不自动合并。

发布包包括 Chrome ZIP、Firefox 未签名 ZIP、Firefox 审核源码 ZIP 和 `SHA256SUMS`。Firefox ZIP 需提交 Mozilla 签名后才能作为正式安装包；GitHub 发版不等于商店上架。审核源码包包含 lockfile 与 pnpm 补丁，按本文的 Node.js 24 构建步骤复现。

既有标签可通过 Release 工作流的手动入口重新打包；打包前运行完整检查，并核对标签与包版本一致。
