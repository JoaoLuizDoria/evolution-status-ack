# Evolution 2.3.7 — scoped status ACK backport

Unofficial image derived from the immutable official Evolution API 2.3.7 image.
It adds the proposed top-level status stanza ACK handler to Baileys 7.0.0-rc.9.
Reference: https://github.com/WhiskeySockets/Baileys/pull/2883

Only the exact receiver file is changed. Entrypoint, command, user, environment,
database migration scripts, Manager and the other application files are preserved.
The build refuses unexpected versions, hashes, links and credentialed runtime use.

CI compares every application file and startup configuration against the base;
checks the original negative control and the patched real socket/encoder with a
mocked transport and blocked networking; and boots the official application with
empty fictitious databases on an internal-only Docker network. It publishes the
same image only after these checks pass. This does not prove WhatsApp delivery,
long-term session stability or iPhone notifications; those require later observation.

This repository contains no deployment credentials, operational settings, sessions,
contacts, message bodies, queues or user project data. There is no automatic deploy
to any external service. Consumers should pin the published image by its digest.

The backport does not read a chat, send a user message or mark messages/statuses as
read. The upstream proposal is not represented here as an official released fix.
