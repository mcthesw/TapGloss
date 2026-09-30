# TapGloss

在网页上点词，结合语境生成例句，并保存为 Anki 挖空卡。

## 开始使用

1. 加载扩展，点击工具栏图标进入设置，填写 AI API 地址和 Key。
2. 在 Anki 中安装 [AnkiConnect](https://ankiweb.net/shared/info/2055492159)，保持 Anki 打开。
3. 点击网页中的词语。词组可以选中后按 `Alt + Q`。

三条例句组成一张卡。Anki 未打开时先保存在本地，之后重试。工具栏提供总开关与网站开关。记录页可以搜索、编辑和删除；词表页可下载四六级等内置词表或导入文件，跨设备同步按需启用。

## 安装

使用 Node.js 24 和 pnpm：

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run build
```

- **Chrome / Chromium**：在扩展管理页开启开发者模式，加载 `.output/chrome-mv3`。
- **Firefox 140+**：执行 `pnpm run build:firefox`，在 `about:debugging` 临时加载 `.output/firefox-mv2/manifest.json`。长期安装需要 Mozilla 签名。

安装后刷新已打开的网页。更新时重新加载原扩展即可，无需卸载。

## 数据

分词与词表匹配在本地完成。只有主动查询的词语和所在句子发送给你配置的 AI，整页和网址不会发送。凭据保存在当前浏览器；可选 S3 / WebDAV 同步学习数据，远程内容未加密。

## 文档

[使用说明](docs/usage.md) · [开发](docs/development.md) · [设计](docs/design.md) · [术语](CONTEXT.md)

## 许可证

项目使用 [MIT](LICENSE) 许可证。内置词表数据的来源与许可见 [词表说明](resources/wordlists/README.md)。
