# Windows setup (for the user)

This is the content the in-app setup checker should mirror. Written for a non technical user. All commands are PowerShell.

## What you need
- Windows 10 or 11, 64 bit
- Virtualization enabled (most PCs have it on)
- Docker Desktop (free for personal use)

## Step 1: Install Docker Desktop
1. Go to docker.com and choose "Download for Windows - AMD64" (this is right for both Intel and AMD; do not pick ARM64).
2. Run the installer, keep the WSL 2 option checked, finish, and restart if asked.
3. Open Docker Desktop. If it asks you to sign in, click Skip. No account is needed.
4. Wait until the bottom left says "Engine running" in green. Leave Docker open whenever you use Enclave.

## If Docker will not start or mentions WSL
Open PowerShell as administrator (Start, type PowerShell, right click, Run as administrator), then run these one at a time:
```powershell
wsl --update --web-download
wsl --install --no-distribution
```
If the second command asks you to name a distribution:
```powershell
wsl --install -d Ubuntu --web-download
```
If an Ubuntu window asks for a username and password, type any simple ones and close it. Enclave does not use it. Restart the PC, open Docker Desktop, wait for "Engine running".

## If Docker says "Virtual Machine Platform not enabled"
In PowerShell as administrator:
```powershell
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
```
Restart if asked, then open Docker and click Recheck.

## If virtualization is off
Press Ctrl + Shift + Esc, open Performance, click CPU. If Virtualization says Disabled, turn it on in the PC's BIOS (look for "Virtualization", "VT-x", "SVM" or "AMD-V"). Steps vary by PC maker; search your PC model plus "enable virtualization".

## Step 2: First launch builds the browser
The first time you open Enclave with Docker running, it builds its secure browser. This takes about 5 to 10 minutes and happens once. Keep the app open.

## Step 3: Create a profile
Create profile, leave the built in test proxy on to try it, then Start. For real use, turn the test proxy off and enter your own proxy.
