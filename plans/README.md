# plans

Work-in-flight for harvest-axi, tracked as a micro-DAG. Each `<slug>.md` is one scope-bounded chunk: what it covers, the specs it implements, its dependencies, and checkbox validation criteria that convert it to `done`.

Plans describe **motion** (how we get there next); [`../specs/`](../specs/) describe **state** (what should be true). Specs lead; plans execute against already-agreed state.

This file intentionally keeps **no** hand-drawn DAG or status table — they rot. Query the authoritative frontmatter on demand:

```sh
specops            # readiness dashboard (ready / blocked)
specops next       # what to work on next, topologically ordered
specops dag        # Mermaid graph of the DAG
```

Full protocol: the specops skill's `references/plans-protocol.md`.
