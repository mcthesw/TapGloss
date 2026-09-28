export const legacyCardStyle =
  '.card{font:20px/1.65 system-ui;text-align:left;max-width:650px;margin:auto;padding:24px;color:#26382f;background:#faf9f5}.cloze{font-weight:700;color:#247654}blockquote{border-left:3px solid #c5d5c9;padding-left:16px;margin-left:0}a{font-size:14px;color:#527866}hr{border:0;border-top:1px solid #dce3da;margin:24px 0}';
export const cardStyle = `
.card{font:20px/1.65 system-ui;text-align:left;max-width:650px;margin:auto;padding:24px;box-sizing:border-box;color:#26382f;background:#faf9f5;color-scheme:light}
.cloze{font-weight:700;color:#247654}
blockquote{border-left:3px solid #c5d5c9;padding-left:16px;margin-left:0;font-size:16px}
a{font-size:14px;color:#527866;overflow-wrap:anywhere}
hr{border:0;border-top:1px solid #dce3da;margin:24px 0}
summary{cursor:pointer;font-size:14px;color:#64776a}
details{margin-top:20px}
.card.nightMode,.nightMode .card,.card.night_mode,.night_mode .card{background:#202923;color:#e0e9e2;color-scheme:dark}
.nightMode .cloze,.night_mode .cloze{color:#a4d9b4}
.nightMode a,.night_mode a{color:#a4d9b4}
.nightMode summary,.night_mode summary{color:#a6b8ab}
.nightMode hr,.night_mode hr,.nightMode blockquote,.night_mode blockquote{border-color:#435449}
`;
