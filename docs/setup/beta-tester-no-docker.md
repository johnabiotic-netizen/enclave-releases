# Enclave beta: getting started (no Docker)

For a tester whose PC has no Docker. Enclave 0.3.3 or newer sets up its own Linux system with Docker inside it. Until this flow has passed on a real tester's PC, `beta-tester.md` (with Docker Desktop) stays the main guide; then this one replaces it.

What we watch for: Turn on WSL (Windows asks once, a restart finishes it), Set up (Docker installed and running), and the first profile starting and showing the browser.

---

You'll need a Windows 10 or 11 PC (64-bit) with 8 GB of memory or more and about 15 GB free on C:. You'll also need a phone and a proxy (host, port, username and password). **Use an administrator Windows account, and the same one throughout.**

## 1. Install Enclave
1. Download **Enclave-Setup-0.3.3.exe** from https://github.com/johnabiotic-netizen/enclave-releases/releases/tag/v0.3.3 and run it.
2. If Windows shows **Windows protected your PC**, click **More info**, then **Run anyway**.

## 2. Let Setup finish
Setup checks your PC line by line. Fix any line that isn't green, in order:
- **Virtualization on:** if this is red, it has to be turned on in the PC's BIOS. Send us a screenshot and we'll send the exact steps for your PC.
- **WSL working:** click **Turn on WSL**. Windows asks for permission; click **Yes**. Restart the PC when it's done, then open Enclave again.
- **Docker installed:** click **Set up**. It takes a minute or two.
- **Browser ready:** click **Fix**, then **Download the browser**. It's about 1.5 GB and downloads once.

When every line is green, click **Go to profiles**.

## 3. Connect your phone first
1. Open **Settings**. Under **Phone access**, choose **Through your Enclave relay**.
2. Fill in:
   - Relay address: `relay.kybridia.com`
   - Your email and a new password (10 characters or more)
   - Tick **Make a new account with this email**
   - Invite code: the code we send you (it works once)
3. Click **Create account and sign in**, then **Pair a phone**, and scan the QR code with your phone's camera.

## 4. Make your first profile
1. Click **Create profile**, give it a name, paste your proxy, and click **Check proxy**. You'll see a report on the proxy.
2. Click **Continue** until **Create profile**, then **Start**, then **Open**.
3. Open the same profile on your phone.

At any step, send us a screenshot of anything red or anything that looks wrong.

## Rules of the beta
Use Enclave only for accounts and work you're allowed to do. Not for fraud, impersonation, spam, or getting around identity checks. Accounts that break these rules lose access.
