---
description: Handles plugin management (add and install)
---

This workflow handles the `/plugin` slash commands.

### `/plugin marketplace add <repo>`
Adds a repository to the marketplace.
1. Download the content of the repository.
2. Register it in the local marketplace cache.

### `/plugin install <plugin>@<version>`
Installs a plugin from the marketplace.
1. Create the `.agent/skills/<plugin>` directory.
2. Copy files from the marketplace cache or download them directly.

Usage:
```
/plugin marketplace add OthmanAdi/planning-with-files
/plugin install planning-with-files@planning-with-files
```
