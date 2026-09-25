package com.morbeez.driver.data.sync

// Operation-log sync: each offline action is a timestamped, idempotency-keyed
// command replayed against the same handlers the web app uses. Money/stock
// mutations are never resolved by last-writer-wins (MOB.3). Runs via
// WorkManager for guaranteed background execution.
class SyncEngine
