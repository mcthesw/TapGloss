# TapGloss privacy policy

Updated: 2026-10-01 · Publisher: Sworld

TapGloss is a browser extension for contextual vocabulary learning. It does not require a TapGloss account or send learning data to a server operated by the publisher. The extension does not include analytics, advertising or crash-report uploads.

## Local data

Your browser stores selected expressions, meanings, examples, original sentences, source URLs and page titles, reading states, wordlists, settings and connection credentials. Word segmentation, highlighting and language detection run locally. The extension needs website access to provide these reading features across ordinary web pages.

## Services you use

- **AI:** A lookup sends the selected expression, its sentence and selection positions to the API endpoint you configure. To match an existing meaning, TapGloss may also send generated learning material and candidate meanings from your records. It does not send the entire page, its title or URL to the AI. Your API key is sent to that endpoint for authentication. Model discovery and connection testing happen when you request them; the connection test uses a fixed sample.
- **AnkiConnect:** TapGloss sends learning material, original sentences, source links and record identifiers to your configured AnkiConnect endpoint. It reads the relevant note fields to avoid overwriting manual edits. A configured AnkiConnect key is used for authentication. Existing notes are deleted only when you explicitly choose the Anki deletion option.
- **Wordlist downloads:** Adding a built-in list downloads its published text file from GitHub. Existing lists are used locally without further download.
- **Optional sync:** When enabled, S3 or WebDAV transfers learning records, original source information, reading states and wordlists to the storage service you configure. Connection credentials and local Anki links are excluded from the shared learning data. The sync files have no application-level encryption.

These service providers process requests under their own policies and may receive network information such as your IP address. The endpoint you configure determines the transport; use HTTPS for remote services. Local AnkiConnect and local AI endpoints can use HTTP.

## Backups, retention and deletion

Exporting a backup creates a file on your device containing learning data, wordlists and Anki links. Connection settings, credentials and Anki review history are excluded. Backups are not uploaded by TapGloss and are not encrypted.

Data remains until you remove it. Record deletion uses deletion markers for synchronization; historical content may remain in local or remote snapshots and exported backups. Clearing the extension's browser data or uninstalling it removes its local storage. Anki notes, remote sync files and backup files are managed separately and are not removed by uninstalling the extension.

## Contact

Questions can be raised through [TapGloss issues](https://github.com/mcthesw/TapGloss/issues).

---

# TapGloss 隐私政策

更新日期：2026-10-01 · 发布者：Sworld

TapGloss 用于结合语境学习词汇，无需注册 TapGloss 账号，也不向发布者运营的服务器发送学习数据。扩展不包含统计分析、广告或崩溃报告上传。

## 本地数据

浏览器保存选词、释义、例句、原句、来源网址和页面标题、阅读状态、词表、设置及连接凭据。分词、高亮和语言预判在本地完成。扩展需要网站访问权限，才能在普通网页提供阅读功能。

## 你使用的服务

- **AI：** 查询时，选词、所在句子和选中位置发送至你配置的 API。匹配已有义项时，还可能发送生成的学习材料及已有记录中的候选义项。整页、页面标题和网址不发送给 AI。API Key 用于该端点的鉴权。获取模型和测试连接由你主动触发，连接测试使用固定示例。
- **AnkiConnect：** 学习材料、原句、来源链接和记录标识发送至你配置的 AnkiConnect；扩展读取相关笔记字段，以避免覆盖手动修改。配置的 AnkiConnect 密钥用于鉴权。只有明确勾选删除 Anki 笔记时，才会执行关联笔记删除。
- **词表下载：** 添加内置词表时从 GitHub 下载已发布的文本文件；已有词表在本地使用。
- **可选同步：** 启用 S3 或 WebDAV 后，学习记录、原文来源信息、阅读状态和词表发送至你配置的存储服务。连接凭据和本机 Anki 关联不包含在共享学习数据中。同步文件不提供应用层加密。

这些服务按其自身政策处理请求，也可能获得 IP 地址等网络信息。传输方式由配置的地址决定；远程服务应使用 HTTPS，本机 AnkiConnect 和本地模型端点可以使用 HTTP。

## 备份、保留与删除

导出备份会在设备上生成包含学习数据、词表和 Anki 关联的文件，不含连接设置、凭据或 Anki 复习历史。TapGloss 不上传这些备份，备份文件不加密。

数据保留至你移除它。记录删除使用同步删除标记，历史内容可能仍保留在本地或远程快照及导出的备份中。清除浏览器中的扩展数据或卸载扩展，会移除本地存储。Anki 笔记、远程同步文件和备份文件需分别管理，卸载扩展不会移除它们。

## 联系

可以通过 [TapGloss issues](https://github.com/mcthesw/TapGloss/issues) 提问。
