# Enclave beta: getting started

Thanks for testing Enclave. It runs each browser profile in its own sealed space on your PC, with its own proxy and its own device identity, and you can continue any profile on your phone. This guide takes about 30 minutes, most of it downloads.

## What you need
- A Windows 10 or 11 PC (64-bit) with 8 GB of memory or more (16 GB is better), and about 15 GB of free disk space.
- An Android phone or iPhone, for using profiles on the phone.
- A proxy for each profile you want (host, port, user name and password). A residential proxy in the country you want the profile to appear in works best.
- The invite code you were sent (it works once).
- A Windows account that is an administrator. Use the same account for every step and whenever you use Enclave: Docker and your profiles belong to the account that sets them up.

## 1. Install Docker Desktop
Enclave uses Docker to keep each profile sealed. Docker Desktop is free for personal use and small businesses.

1. Go to **docker.com**, click **Download Docker Desktop**, and choose **Windows - AMD64**.
2. Run the installer. Keep **Use WSL 2** ticked. Restart the PC when it asks.
3. Open **Docker Desktop** from the Start menu, accept its agreement, and skip the sign-in. Wait until the bottom left says **Engine running**.

If Docker doesn't start, see `docs/setup/windows-setup.md` (it covers WSL and turning on virtualization), or tell us what it says.

## 2. Install Enclave
1. Download **Enclave-Setup-0.3.4.exe** from https://github.com/johnabiotic-netizen/enclave-releases/releases/tag/v0.3.4 and run it.
2. Windows may show a blue box, **Windows protected your PC**. The beta isn't signed yet. Click **More info**, then **Run anyway**.
3. Enclave opens on **Setup**. Each line should turn green. On **Browser ready**, click **Fix**, then **Download the browser**. It's about 1.5 GB, once; keep the PC on until it finishes.
4. When every line is green, click **Go to profiles**.

## 3. Make your first profile
1. Click **Create profile** and give it a name.
2. Paste your proxy (for example `socks5://user:pass@host:port`) and click **Check proxy**. Enclave shows the proxy's IP and country; the profile's time zone and language will match it.
3. Click **Continue** until **Create profile**. Then **Start**, and **Open** to use it.

Each profile keeps its own logins, tabs and history. If a proxy stops working, the profile stops too and never falls back to your own connection.

## 4. Use it on your phone
1. In Enclave, open **Settings**, and under **Phone access** choose **Through your Enclave relay**.
2. Fill in:
   - **Relay address:** `relay.kybridia.com`
   - your **email**, and a new **password** (10 characters or more)
   - tick **Make a new account with this email**, and paste your **invite code**
3. Click **Create account and sign in**. The status turns **Connected**.
4. Click **Pair a phone**, choose which profiles the phone may open, and scan the QR code with the phone's camera. It opens Enclave in the phone's browser.
5. Add it to the home screen from the browser's menu (**Install app** or **Add to home screen**).

On the phone you can open any shared profile, share the phone's camera and microphone into it, send files from the phone, and save the profile's downloads.

## What to send us
No usage data leaves your PC; we only know what you tell us. After each session, a few lines help a lot:
- What you tried and what happened, with a screenshot of anything that looked wrong.
- The step you got stuck on, if any, and the exact message.
- How the phone felt: delay, picture, anything odd.

## Rules of the beta
Use Enclave only for accounts and work you're allowed to do. Not for fraud, impersonation, spam, or getting around identity checks. Accounts that break these rules lose access.
