# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately using [GitHub's private vulnerability reporting](https://github.com/davinaleong/gracesoft-drivesync/security/advisories/new) for this repository (Security tab → "Report a vulnerability"), rather than opening a public issue.

Include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof of concept if you have one.
- Which version/commit you tested against.

We'll acknowledge reports as soon as possible and keep you updated as the issue is investigated and fixed. Once a fix is released, we'll credit you in the advisory unless you'd prefer to stay anonymous.

## Scope

This is a self-hosted service — each deployment is operated by whoever runs it, with its own database, its own Google service account, and its own API keys. Vulnerabilities in this project's code (authentication, namespace isolation between tenants, injection, etc.) are in scope. Misconfiguration of a specific deployment (a leaked API key, an over-permissioned service account) is the operator's responsibility, though we're happy to hear about footguns in the setup docs that make misconfiguration more likely.
