# Build only from the sanitized context produced by Prepare-Package.ps1.
# No runtime, database, Manager, supervisor or environment contract is replaced.
FROM evoapicloud/evolution-api@sha256:456b4104b0ddffbb092d6b3c0560a4ae86fc3e014e885b882aca4b1b371dfc81
COPY payload/ /opt/baileys-status-ack/
RUN STATUS_ACK_IMAGE_BUILD=1 node /opt/baileys-status-ack/release/install.mjs --apply-build
