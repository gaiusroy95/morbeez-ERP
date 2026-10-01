# Morbeez (Android): owner and driver in one app

Kotlin + Jetpack Compose, native Android (Technology Stack, Section 02).
One install holds two apps. The first screen asks which one to open
(`ui/screens/launcher`), and after that the phone reopens the one it used
last. Back from either app's first screen returns to that choice.

- **Owner** (`ui/owner/OwnerActivity`) is the owner web app
  (`apps/owner-app`), full screen in a hardened WebView. It isn't rebuilt
  here: one set of owner screens serves the phone and any browser. It loads
  only the owner app's own site; other links open in the phone's browser.
  The web session is the web app's own httpOnly cookies, and the page has
  no bridge into the app.
- **Driver** is native: the one client that has to work with no connectivity
  at all, for hours, and reconcile cleanly when it comes back. It
  implements the "Morbeez Driver App Architecture" document (offline-first
  data, sync engine, secure local storage, trip-based permissions).

Which app someone opens only decides which sign-in they see. What they can
do is decided by the server for the account that signs in.

## Running against a local stack

| Build | API (driver) | Owner app |
|---|---|---|
| debug | `http://10.0.2.2:3000/` | `http://10.0.2.2:3001/` |
| release | `https://api.morbeez.in/` | `https://app.morbeez.in/` |

`10.0.2.2` is the host PC as the Android emulator sees it. To use a real
phone, either:

- connect it by USB, run `adb reverse tcp:3000 tcp:3000` and
  `adb reverse tcp:3001 tcp:3001`, and build with
  `-Pmorbeez.apiUrl=http://localhost:3000/ -Pmorbeez.ownerUrl=http://localhost:3001/`; or
- put it on the same Wi-Fi and build with the PC's address, for example
  `-Pmorbeez.apiUrl=http://192.168.1.20:3000/`, allowing both ports through
  the Windows firewall.

Only debug builds may use plain `http` (`src/debug`).

Inside the app, owner mode can't save the GST e-invoice JSON (it's made in
the browser, which a WebView can't hand to Android's downloads), and the
statements' Print button does nothing. The app says so when you try the
download. Both work from a computer's browser.

## Driver features

- **Login** — `ui/screens/login`, session tokens in `TokenStore`.
- **Assigned trips** — `ui/screens/route` (Today's Trip + Route), pulled
  from the driver-scoped `GET /logistics/trips/mine`, never a client-side
  filter over every trip.
- **Pickup** — completing a pickup stop from `ui/screens/stopdetail`.
- **Delivery** — `ui/screens/delivery`, proof of delivery (recipient name
  + signature or photo).
- **Photos** — `ui/components/PhotoCapture.kt`, used from pickup, delivery,
  and issue-report flows alike.
- **POD** — `SignaturePad.kt` + the 'pod' photo type; enforced client-side
  before submission and again by the backend.
- **Collections** — `ui/screens/cash`, cash/payment collected at a
  delivery stop.
- **Expenses** — `ui/screens/expenses`, Trip Summary and recording a new
  expense.
- **Sync** — `data/sync/SyncEngine.kt`, run by `SyncWorker` via
  WorkManager: an operation log, pushed in strict order before any pull,
  replaying against the exact same backend handlers the web app uses.

## Structure

- `data/local` — Room (SQLCipher-encrypted), the on-device source of truth
  while offline: `TripEntity`/`TripStopEntity` plus the
  `PendingOperationEntity`/`PendingPhotoEntity` queues.
- `data/remote` — the typed Retrofit client (`ApiService`), auth
  interceptor/authenticator.
- `data/repository` — `TripRepository`/`AuthRepository`: the only classes
  screens talk to; the only classes that talk to `ApiService`.
- `data/security` — `TokenStore` and `DatabaseKeyProvider`, both backed by
  the Android Keystore via `EncryptedSharedPreferences`.
- `data/sync` — the operation-log sync engine, run via WorkManager.
- `di` — Hilt modules wiring the above.
- `ui` — Compose screens, one package per feature, plus shared
  `components` (photo capture, signature pad) and the `nav` graph.

Chosen native over cross-platform specifically for this app's reliability
requirements — see the Technology Stack document (Section 02) for the full
reasoning and the trade-off it makes explicit.

## Known gaps

`./gradlew assembleDebug` builds (JDK 17, Android SDK 34). The app has no
automated tests yet, and it hasn't yet been walked through on a device or
emulator.

## Design

The "Fresh Ledger" design system of the owner web app, as a Compose theme
(`ui/theme/Theme.kt`) and a small kit (`ui/components/Kit.kt`: carbon header,
cards, the big thumb-sized primary action, pills, choice tiles, line icons).
Fonts: Inter and Bricolage Grotesque (`res/font`), SIL Open Font License 1.1.
