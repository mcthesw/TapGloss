# Changelog

## [0.3.0](https://github.com/mcthesw/TapGloss/compare/v0.3.0...v0.3.0) (2026-09-30)


### Features

* add a compact drag handle to lookup popups ([00b7939](https://github.com/mcthesw/TapGloss/commit/00b7939a59b5e17da4d02cd692498d2d39b97fe9))
* add bilingual interfaces and Firefox integration coverage ([3db7866](https://github.com/mcthesw/TapGloss/commit/3db7866dc220670e26562ecef21d84460ac7c332))
* add global and per-site reading controls ([d259d7e](https://github.com/mcthesw/TapGloss/commit/d259d7e98e2a3267038f4b3cde08fabf1716793b))
* add local language exclusions for reading ([60a66a3](https://github.com/mcthesw/TapGloss/commit/60a66a32336954d9af629aed29811623498f2bce))
* add the selected tap highlight extension icon ([b811bed](https://github.com/mcthesw/TapGloss/commit/b811bed8e8dfd08daba82113203eed9fc2dcc584))
* download and manage built-in exam wordlists ([712e150](https://github.com/mcthesw/TapGloss/commit/712e1501a00d54920c08ad7fbc7d742ae25ab9b2))
* implement contextual reading and automatic Anki export ([29534be](https://github.com/mcthesw/TapGloss/commit/29534be3fd58d0ebf4b43507d0f78212f29a189c))
* manage imported wordlists on a dedicated page ([b077e6d](https://github.com/mcthesw/TapGloss/commit/b077e6db3596c5c474c2618a4d078691125ecc71))
* preserve first-letter hint preferences for new Anki cards ([8421d3e](https://github.com/mcthesw/TapGloss/commit/8421d3e1c196dddc4897353d1c03095a6bb2f79b))
* sync reading data through S3 and WebDAV ([423c8a6](https://github.com/mcthesw/TapGloss/commit/423c8a6c1103f9b707f1c0094e59355312f19e83))


### Bug Fixes

* align toolbar switches independently of label width ([d821855](https://github.com/mcthesw/TapGloss/commit/d821855476f9d4264c8e532b7b3367c184e7cb7e))
* exclude short Chinese chat fragments in mixed contexts ([ea6fb43](https://github.com/mcthesw/TapGloss/commit/ea6fb437a6009aa68c361b1801804e7416a218b7))
* guard caret ranges and invalidated extension connections ([ac7e428](https://github.com/mcthesw/TapGloss/commit/ac7e428939a1b8e60a533f3f00047b06791503c2))
* ignore numeric lookups and allow deleting from popup ([8ae3939](https://github.com/mcthesw/TapGloss/commit/8ae3939d1fb4cfcbb7889b06635e4146806ebb21))
* keep spoiler reveal gestures from creating lookups ([5a386d3](https://github.com/mcthesw/TapGloss/commit/5a386d3bf0ac9b7d1c43b329d1fade048c3360bb))
* make compact records borderless and content sized ([5887902](https://github.com/mcthesw/TapGloss/commit/5887902981ff5c550b00ff71111d132e11b9b2e7))
* refine word focus and unchanged settings feedback ([ccff77b](https://github.com/mcthesw/TapGloss/commit/ccff77b9b8e6ef52841f3ab2cb9ad12a6a45c233))
* remove extension preloads and improve dark contrast ([e6a2405](https://github.com/mcthesw/TapGloss/commit/e6a2405adc5e8970d260abbc896d8679eb519d47))
* safely tear down invalidated extension contexts ([564d4d7](https://github.com/mcthesw/TapGloss/commit/564d4d748e53ac5e94f7c5af9bc8f9bf41d6b4f6))
* simplify interface layout and save feedback ([0dee4ba](https://github.com/mcthesw/TapGloss/commit/0dee4baa563847b4ba92f4e7646cc6852b6b2313))
* skip isolated Latin letters during passive reading ([f8d974f](https://github.com/mcthesw/TapGloss/commit/f8d974f33cb01512c09ef4a4c18f9216db7f45a5))
* tighten lookup layout and compact record rows ([766b3dd](https://github.com/mcthesw/TapGloss/commit/766b3dddfe2b87ed1f7e86700c11ee7b8c3175d2))


### Performance Improvements

* index record summaries and bound background retries ([150b055](https://github.com/mcthesw/TapGloss/commit/150b055163446137d69a8194ac76dc9fd02b95fb))


### Ci

* preserve release-please changelog formatting ([c89c958](https://github.com/mcthesw/TapGloss/commit/c89c958856b86745e50549aa1ab993801b4b6fcb))
