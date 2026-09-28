# TapGloss

在网页上点选词语，保留原文语境，生成三条简单例句并自动存入 Anki。

## 安装与使用

需要 Node.js 24 和 pnpm（版本由 `packageManager` 固定）。构建扩展：

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run build
pnpm run build:firefox
```

- Chrome / Chromium：在扩展管理页打开开发者模式，选择“加载已解压的扩展程序”，加载 `.output/chrome-mv3`。
- Firefox：在 `about:debugging#/runtime/this-firefox` 选择“临时载入附加组件”，打开 `.output/firefox-mv2/manifest.json`。临时安装在重启后失效；长期安装需要 Mozilla 签名。最低版本为 Firefox 140。
- 点击扩展图标打开设置，填写 OpenAI 兼容 API 地址与密钥。默认使用 DeepSeek Flash；点击“获取模型”读取可选模型，再选择模型或手动填写名称；“测试连接”会验证实际生成是否可用。
- 打开 Anki，安装 [AnkiConnect](https://ankiweb.net/shared/info/2055492159)。默认连接本机 `8765` 端口，自动创建 `TapGloss` 牌组及专用笔记类型。如果 AnkiConnect 提示连接授权，允许扩展访问。
- 刷新安装前已打开的网页，点击正文中的词语开始查询。查询手势可改为 `Alt + 点击`。词组或已认识的词可以选中后按 `Alt + Q`；按 `Esc` 关闭弹窗。

三条例句共用 `c1`，一份学习条目生成一张复习卡。再次遇到相同义项时，新原文追加到背面；不同义项单独制卡。原句原位置重复查询会复用本地结果。标记“认识了”后恢复普通正文，仍可主动查询其他语境。

Anki 未启动时先保存本地材料，后台会按退避间隔重试；单个任务最多自动尝试五次，之后可在详情中手动重试。鉴权、参数或内容错误直接暂停。在记录页可以搜索、修改释义与例句、移除来源及删除条目，支持标准与紧凑两档布局，每页最多 100 条。点击词条打开单个详情浮窗，在浮窗内操作，不撑开列表。搜索覆盖全库的词条、释义及保留来源，按词语前缀匹配。删除条目默认保留 Anki 笔记，需要勾选才联动删除。Anki 内容被手动修改时自动更新暂停，避免覆盖修正。

设置输入与保存均不主动联网或重试失败任务；获取模型与测试连接由按钮触发，离开设置会取消未完成的测试请求。切换页面会保留未保存的草稿。设置中的 AI 连接、阅读与外观、Anki 分开配置，宽屏采用独立的两列布局。顶部区域统一放置页面切换与当前页操作；保存成功时按钮变为绿色，继续编辑后恢复。卡片右上角的问号支持悬停查看帮助、点击固定，提示中的链接可以点击。Anki 提供只读连接测试，不创建测试卡片。可修改生成提示词并一键恢复默认；修改仅影响之后的新查询。连接测试使用固定示例，不保存记录、不创建卡片。外观支持自动、浅色、深色；自动模式下弹窗跟随网页，记录页跟随系统，卡片跟随 Anki 夜间模式。卡背仅显示揭晓答案的三句、短释义和折叠来源，不重复例句。

更新扩展后，本地已有记录会排队更新对应 Anki 笔记，保留笔记身份与复习历史；手动修改过的 Anki 内容和模板样式仍会保留。

“阅读与外观”中的“忽略语言”支持添加、移除语言，默认不忽略任何语言。被识别为这些语言的词不高亮、不响应点选；主动选中后按 `Alt + Q` 仍可查询。保存设置会立即更新已打开页面的标记，不删除记录或改变认识状态。

识别使用本地 `tinyld/light`，提供 24 种语言选项，不会为识别而调用模型。短词、近似语言及混合语境可能无法可靠判断；无法确定时保留查询入口。忽略中文时，中文句子中的英文词仍可点选。

## 数据与权限

扩展在允许注入的 HTTP/HTTPS 网页运行。浏览器内部页、扩展商店、内置 PDF 阅读器和不可访问的页面内容不适用。

分词与高亮在本地进行。只有主动查询的表达、所在句子和位置会发送给配置的模型端点；整页、页面标题和网址不发送给模型。原文来源保存在浏览器本地，并随学习材料写入 Anki。API 凭据仅保存在当前浏览器扩展的本地设置中。

当前实现包含本地持久化、阅读状态、语境生成、记录管理及 AnkiConnect 导出。S3/WebDAV 同步、Yjs 合并、词表导入及界面语言切换尚未实现。清除扩展数据或卸载会删除本地记录；Anki 已保存的笔记不受影响。

## 开发

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

## 代码边界

入口负责装配配置和后台任务；页面层只负责文本定位与展示。模型、Anki 与本地存储分别集中在 `src/explain`、`src/anki`、`src/storage`；普通领域类型与校验位于 `src/domain`。后台任务持久化保存重试状态，使用稳定笔记身份核验不确定的 Anki 写入结果。

产品设计见 [docs/design.md](docs/design.md)，术语见 [CONTEXT.md](CONTEXT.md)。
