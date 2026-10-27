# Set up Tailscale (phone access)

Tailscale joins your PC and your phone into a private network that only your own devices can use. The phone reaches the profiles running on the PC through it. Traffic between your devices is end to end encrypted (WireGuard); Tailscale's servers only help the devices find each other.

You need: the PC, your phone, and one account to sign in with on both (Google, Microsoft, Apple or GitHub). The free personal plan is enough.

## 1. Install on the PC

1. Open https://tailscale.com/download/windows and click **Download Tailscale for Windows**.
2. Run the downloaded installer and click **Install**. Allow it when Windows asks.
3. A Tailscale icon appears in the system tray (near the clock; click the `^` arrow if you don't see it). Click it, then **Log in**.
4. Your browser opens. Sign in with the account you want to use for both devices, then click **Connect**.
5. Click the tray icon again: it should show **Connected** and your PC's name.

[screenshot: tray menu showing Connected]

## 2. Turn on HTTPS for your network (once)

The phone app needs HTTPS. Tailscale provides certificates for free, but you switch it on once:

1. Open https://login.tailscale.com/admin/dns in your browser (signed in with the same account).
2. Under **MagicDNS**, check it says **Enabled**. If not, click **Enable MagicDNS**.
3. Scroll to **HTTPS Certificates** and click **Enable HTTPS**, then confirm.
4. At the top of the page, note your **Tailnet name** (it looks like `tail1234.ts.net`).

[screenshot: DNS page with MagicDNS and HTTPS enabled]

## 3. Install on the phone

1. Install **Tailscale** from the App Store (iPhone) or Google Play (Android).
2. Open it and sign in with the **same account** as on the PC.
3. Allow it to add a VPN configuration when the phone asks.
4. Switch the toggle to **Connected**. Your PC should appear in the list of devices.

[screenshot: phone app with the PC listed]

Keep Tailscale connected on the phone whenever you want to open a profile from it.

## 4. Find your PC's address

In PowerShell on the PC:

```powershell
tailscale status
```

The first line is your PC: its Tailscale IP (starts with `100.`) and its name. Its full address is `<pc-name>.<tailnet-name>`, for example `laptop-abc.tail1234.ts.net`. The agent uses this address for the phone links; you don't need to type it anywhere.

## Notes

- Only devices signed in to your account can reach the PC. Nothing is opened to the internet.
- If you sign out of Tailscale on the PC, phone access stops until you sign in again. Profiles keep running on the PC either way.
- Tailscale is a third-party service. Stage 6 replaces it with Enclave's own phone linking for the product version.
