# Security scope

Version 0.1.0 is intended for one trusted user on a local machine. It is not a
public, multi-tenant inference service. Keep the default loopback binding.

Use a random gateway token and keep `.env` and runtime state out of source
control. The gateway does not include an encrypted credential vault. Other
software or users with access to the host can read local configuration.

Status endpoints are authenticated and should expose operational metadata only.
Prompts, completions, raw provider error bodies, and credentials must not be
written into status events. Upstream providers still receive request contents.

Report security issues privately through GitHub private vulnerability reporting
if it is enabled. Otherwise, open a minimal issue requesting a private contact
channel without including credentials, customer data, or exploit details.

Do not attach real `.env` files, provider responses containing customer data,
or complete production logs to public issues.

