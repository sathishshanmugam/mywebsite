# Crunchery's DPS

Path intended:
`/outlet/dps/`

Tabs:
- Daily Entry
- Employee Setup
- Records

The page reuses the existing Firebase Phone OTP session. It reads the logged-in user's
`staff/{UID}` document to determine `outletId` and `outletName`.

Firestore collections used:
- `outlet_dps_settings/{outletId}`
- `outlet_dps_records/{outletId_YYYY-MM-DD}`

Employee names are saved with each achieved-day record so changing an employee name later
does not rewrite historical records.

Important:
Add/verify Firestore security rules before production use. The rules should ensure the
authenticated user's `staff/{uid}.outletId` matches the outletId being accessed.
