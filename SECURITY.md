# Security

deltaviz runs a local server on `127.0.0.1` that reads files of the repo it was started in. It
checks the Host header (against DNS rebinding) and refuses paths outside the repo and inside `.git`.

To report a vulnerability, use [GitHub's private reporting](https://github.com/mikkmartin/deltaviz/security/advisories/new)
rather than a public issue.
