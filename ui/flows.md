# Key user flows

## First run
Install app -> Setup checker runs -> fix Docker/virtualization if needed -> image builds (one time, explained) -> "You're ready" -> Dashboard (empty) -> Create first profile.

## Create a profile
Create -> name it -> paste proxy -> Check (sees exit IP and location) -> pick template or Auto -> Review (location the fingerprint will match) -> Create -> profile appears, Stopped.

## Start and use
Start -> safety check runs (proxy rechecked) -> container starts -> seam goes amber then green -> Open -> browser appears -> log into accounts, they persist.

## Continue on phone
On phone, open the same profile -> see the same running browser, same tabs, same IP -> use it -> changes are the same session (nothing synced, nothing to desync).

## Use the phone camera (Stage 4)
A page in the profile asks for the camera -> phone shows the camera share screen -> user confirms -> live feed appears to the site -> user finishes -> stop sharing.

## Proxy fails mid session
Agent detects proxy down -> banner on PC and phone: "Proxy unreachable" -> pages stop loading (fail closed) -> user fixes proxy -> pages resume. Real IP never used.

## Switch a profile to a new proxy location
Edit profile -> new proxy in a different country -> safety check flags location mismatch -> user chooses "Update location" (timezone/locale/geo change, everything else fixed) or cancels.
