# Native focused rigid benchmark

Frozen v1.12 WASM: `03cf2a4a24e2c4aab33d51411c6bd3ff21440f068a3c8830ece34ad0ed9f168a`

Candidate WASM: `c333505cf758a137c9d6a5826967248a2552701aace4fad598a61de24ca66983`

Candidate bridge matches artifact provenance: **true**

Benchmark claimable: **true**

| Case | Median speedup | Balanced-bootstrap 95% interval | Classification |
|---|---:|---:|---|
| Definite-miss explosion, static-heavy | 1.541× | 1.534–1.565× | accepted measured win |
| Definite-miss explosion, dense dynamic | 3.538× | 3.481–3.585× | accepted measured win |
| Mixed hit/miss explosion, static-heavy | 1.290× | 1.272–1.309× | accepted measured win |
| Mixed hit/miss explosion, dense dynamic | 1.124× | 1.099–1.153× | accepted measured win |
| Exact-radius boundary explosion | 1.116× | 1.093–1.137× | accepted measured win |
| Kick action, static-heavy | 1.164× | 1.148–1.181× | accepted measured win |
| Kick action, dense dynamic | 1.127× | 1.108–1.146× | accepted measured win |
| Repeated-size dense scene reconstruction | 1.230× | 1.205–1.240× | accepted measured win |
| Varied static-heavy scene reconstruction | 1.298× | 1.285–1.312× | accepted measured win |
| Large-to-small scene reset churn | 1.246× | 1.206–1.275× | accepted measured win |
| Destroy and small-scene recreate | 1.660× | 1.648–1.706× | accepted measured win |
| Explicit transform sync, static-heavy active | 0.987× | 0.981–0.998× | parity / no proven difference |
| Explicit transform sync, static-heavy partially sleeping | 0.953× | 0.937–0.965× | parity / no proven difference |
| Explicit transform sync, dense active | 0.981× | 0.972–1.006× | parity / no proven difference |
| Whole step, static-heavy partially sleeping | 1.094× | 0.958–1.142× | parity / no proven difference |
| Whole step, dense partially sleeping | 1.053× | 1.016–1.113× | small gain below acceptance threshold |

All active matrix/color bits, counters, revisions, and replay hashes matched after every timed sample. Raw samples are retained in the JSON evidence.
