package com.morbeez.driver

import android.app.Application

// Offline-first driver app. Local SQLite (Room) is the source of truth
// while offline; a sync engine reconciles with the backend opportunistically
// (System Architecture, MOB.2-MOB.3). Structure only.
class MorbeezDriverApp : Application()
