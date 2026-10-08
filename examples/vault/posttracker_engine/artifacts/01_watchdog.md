# Watchdog Timer

The watchdog gives every outbound post a bounded window to be confirmed by the
inbound leg.

- Outbound leg records `T=0` and the ticket id.
- Inbound leg normally confirms within `2.4s`.
- At `12s` the watchdog runs: a ticket still unconfirmed is cancelled, its
  summary counters are decremented, and the cancellation reason is written to
  the ticket so the report can explain the gap instead of hiding it.

Never widen the window to make a test pass: a slow confirmation is a signal.
