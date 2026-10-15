# Shoot Radar

Daily phone alerts for photogenic weather around Victoria: sunrise and sunset colour, foggy dawns, big swell, electrical storms, Milky Way nights, aurora, wild wind, rainbows, full moonrises and snow. Each location has its own conditions and alert thresholds.

- **Web app** (`index.html`): live 4-day radar for every spot, plus the tools to add and edit locations. Hosted free on GitHub Pages.
- **Alert engine** (`alert.js` + `.github/workflows/alerts.yml`): runs on GitHub Actions at 6:45am and 6:45pm Melbourne time and pushes a digest to your phone through the free **ntfy** app. It also checks real-time aurora activity every 30 minutes after dark.
- **Data**: Open-Meteo forecast and marine APIs, plus NOAA SWPC for the Kp index. No API keys needed. Sun, moon and Milky Way positions are calculated locally.

## Setup (about 10 minutes, once)

### 1. Phone: install ntfy
1. Install **ntfy** from the App Store or Google Play.
2. Tap **+** and subscribe to a topic name nobody will guess, e.g. `shootradar-tyson-7k2p9q`. Anyone who knows the name can read or send to it, so treat it like a password.

### 2. GitHub: create the repository
1. Sign in at github.com (a free account is fine) and create a **new public repository** called `shoot-radar`.
2. Upload every file from this folder, keeping the `.github/workflows` folder structure. (On the repo page: **Add file → Upload files** and drag in the whole folder contents.)
3. **Settings → Secrets and variables → Actions → New repository secret**: name `NTFY_TOPIC`, value your topic from step 1.
4. **Settings → Actions → General → Workflow permissions**: choose **Read and write permissions**, then Save. (This lets the engine remember it already sent an aurora alert.)
5. **Settings → Pages**: Source **Deploy from a branch**, branch `main`, folder `/ (root)`. After a minute the app is live at `https://YOUR-USERNAME.github.io/shoot-radar/`.

### 3. Test it
1. **Actions** tab → **Shoot Radar alerts** → **Run workflow** → mode `digest`. Within a minute you should get a notification. (If nothing is above threshold you'll see "No alerts above thresholds" in the log. Turn on "Send a digest even when nothing's on" in the app to always get one.)
2. Open the web app on your phone and use **Share → Add to Home Screen** so it opens like an app. Tapping a notification opens it too.

### 4. Let the app save your locations
The app edits `config.json` in your repository.
1. github.com → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Repository access: **Only select repositories** → `shoot-radar`. Permissions: **Contents → Read and write**. Set an expiry you're happy with.
3. In the app: **Settings** → Repository `YOUR-USERNAME/shoot-radar`, branch `main`, paste the token. It stays in that browser only.

Now add or edit spots, choose what to watch at each, and press **Save to GitHub**. The next digest uses the new settings.

## How the scores work (0–100)

| Condition | What it looks at |
|---|---|
| Sunrise / sunset colour | Mid and high cloud as a canvas (best 30–70%), low cloud at the spot **and 50 km toward the sun** (blocks the light), rain chance, bonus for clearing after rain |
| Foggy sunrise | Visibility, humidity, dew-point spread and wind in the 3 hours before sunrise |
| Big swell | Swell height vs your threshold, swell period, bonus in golden hour and when gusty |
| Electrical storm | Thunderstorm weather codes and CAPE (instability) with rain chance; bonus after dark |
| Milky Way night | Hours of astronomical darkness with the moon down and cloud under your max; bonus when the galactic core is above 10° |
| Aurora australis | NOAA 3-day Kp forecast during darkness vs your minimum Kp, cloud 60 km to the south |
| Wild wind | Daily peak gusts vs your threshold |
| Rainbow chance | Showers with the sun 3–40° up and broken cloud |
| Full moonrise | 85%+ lit moon rising within ~1 hour of sunset (or setting near sunrise), clear horizon |
| Snowfall | Daily snowfall vs your threshold |

You're alerted when a score reaches that location's threshold. Same condition on the same day at several spots is grouped into one line.

Live aurora alerts fire (high priority, at most once every 3 hours) when the real-time estimated Kp reaches the lowest "Min Kp" across your aurora spots, or Bz is strongly southward (≤ −10 nT) with Kp close, and at least one aurora spot is dark.

## Changing the alert times
Times are in `.github/workflows/alerts.yml` as UTC cron lines, two per digest (one for daylight saving, one for standard time). `alert.js` runs whichever matches the current Melbourne offset, so you never get doubles. To move the evening digest to 5:45pm, change `45 7` → `45 6` and `45 8` → `45 7`, and update the `CRONS` table at the top of `alert.js` to match.

## Notes
- GitHub can start scheduled runs 5–20 minutes late at busy times.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. The engine makes a small commit to `state.json` every 30 days to prevent this.
- Forecasts are model output. Treat scores as "worth checking", then confirm on the BoM radar and satellite before driving out.
- Starter coordinates are approximate; fine-tune them to your exact vantage point in the app.
