# Built-in wordlists

Generated from [ECDICT](https://github.com/skywind3000/ECDICT) revision `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`, under the [MIT license](LICENSE).

These are ECDICT exam-tagged lists, not a claim of complete official exam syllabuses. Each list includes ECDICT middle-school and high-school tags (`zk`, `gk`); CET-6 also includes CET-4. Files contain normalized headwords and their listed inflections; translations, examples, audio, and images are excluded. Counts distinguish headwords from all matching forms.

To reproduce, download `ecdict.csv` from the pinned revision and run:

```sh
python scripts/prepare-wordlists.py path/to/ecdict.csv
```

The catalog records each file's size and SHA-256. The extension downloads individual lists only when requested, verifies the snapshot, and imports them into local storage.
