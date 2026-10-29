# Cloud workers

A cloud worker is AgentShot running headless as a lendable worker, leased to one person at a time.

- **Your computer** can hand it renders and agent edits: Settings → Mobile → **Use cloud worker**.
- **The phone** works on one when none of your computers is on: **AgentShot Cloud** in its list of computers.

Whoever leases a worker sees only the projects they made there, and the worker's own keys and settings stay its own.

## Lending a computer

Turn on **Share this computer as a cloud worker** in Settings → Mobile and enter the pool key (the account service's
`WORKER_POOL_SECRET`). That starts a separate background worker with its own profile and projects folder: none of
your projects, keys or sign-in go with it.

## On a server

Start AgentShot with `--worker` and `MANUL_POOL_SECRET` set. For a stateless pool, where any worker can open
anyone's space, also set `MANUL_SHARED_ROOT` (a folder every worker shares) and `MANUL_WORKER_SLOT` (this worker's
own); run it under a service manager that restarts it (systemd `Restart=always`), since a worker restarts into each
new person's space.
