// Polls outbox_event WHERE published_at IS NULL and publishes to the event
// bus (System Architecture, EVT.1). Runs in the worker process, not the API
// process.
export class OutboxRelay {}
