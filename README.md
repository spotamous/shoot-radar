# Shoot Radar

Daily phone alerts for photogenic weather around Victoria: sunrise and sunset colour, foggy dawns, big swell, electrical storms, Milky Way nights, aurora, wild wind, rainbows, full moonrises and snow, plus live lightning and aurora alerts. Each location has its own conditions, tide and swell-direction preferences, and alert thresholds that tune themselves from your shoot ratings.

- **Web app** (`index.html`): live 4-day radar for every spot, plus the tools to add and edit locations. Hosted free on GitHub Pages.
- **Alert engine** (`alert.js` + `.github/workflows/alerts.yml`): runs on GitHub Actions at 6:45am and 6:45pm Melbourne time and pushes a digest to your phone through the free **ntfy** app. Every 15 minutes it also checks for live lightning near your spots and real-time aurora activity after dark.
- **Data**: Open-Meteo forecast and marine APIs (swell and modelled tides), NOAA SWPC for the Kp index, and the Blitzortung.org community network for live lightning. No API keys needed. Sun, moon and Milky Way positions are calculated locally.

## Setup (about 10 minutes, once)

### 1. Phone: install ntfy
1. Install **ntfy** from the App Store or Google Play.
2. Tap **+** and subscribe to a topic name nobody will guess, e.g. `shootradar-tyson-7k2p9q`. Anyone who knows the name can read or send to it, so treat it like a password.

### 2. GitHub: create the repository
1. Sign in at github.com (a free account is fine) and create a **new public repository** called `shoot-radar`.
2. Upload every file from this folder, keeping the `.github/workflows` folder structure. (On the repo page: **Add file → Upload files** and drag in the whole folder contents.)
3. **Settings → Secrets and variables → Actions → New repository secret**: name `NTFY_TOPIC`, value your topic from step 1.
4. **Settings → Actions → General → Workflow permissions**: choose **Read and write permissions**, then Save. (This lets the engine keep its alert log and avoid repeat lightning and aurora alerts.)
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

## Location photos
In the location editor, use **Choose photo** (or paste an https image link) and pick how it crops. Photos are resized to 1600 px in your browser and uploaded to the repository's `images/` folder when you press **Save to GitHub**. They appear on the location cards, the radar and the alert cards, and the top spot's photo is attached to your phone digest. The repository is public, so anyone with the link can see them. Removing a photo doesn't delete the old file; delete it from `images/` on GitHub if you want it gone.

## Tides
Every condition (except snow and live lightning) has a **Tide** option: any, low, mid or high. With a preference set, the score is scaled by how well the tide matches at that moment, and the reason says e.g. "high tide falling (high wanted)". Tap a score on the radar to see the day's modelled high and low times. Tides come from Open-Meteo's sea-level model (tide plus surge). They're good for "is it high or low around sunrise", but check the BoM tide tables for exact times and heights before rock-hopping.

## Swell direction
Big swell has **Exposed to swell from** and **± degrees**. A spot set to SW ±60° scores swell from WSW through S fully, fades over the next 30°, and drops to 20% beyond that. The starter spots are preset (Flinders Blowhole: SW, high tide; Cape Woolamai: S; and so on). Adjust them from what you see on the day.

## Shoot log and self-tuning thresholds
Every spot that appears in a phone digest is logged to `history.json`. In the app's **Shoot log**, rate each one **Epic**, **OK** or **Dud** after you've been. Tap a score on the radar and press **Track** to log shoots the digest didn't flag (near misses are the most useful ratings).

Once a spot and condition has 3 or more ratings, its threshold moves to the score that best separates good shoots from duds, within 15 points of the one you set. Epic ratings count extra. The app shows what changed ("alerting at 75 instead of 60"), the editor shows the learned value next to the slider, and you can switch tuning off in Settings to keep ratings as suggestions only. Ratings are saved to `ratings.json`, which only the app writes.

## Live lightning
Switch on **Live lightning** for a spot and set a radius (default 40 km) and a minimum strike count (default 3). Every 15 minutes the engine listens to the Blitzortung network for 90 seconds. If enough strikes land inside a spot's radius, you get a high-priority push with the strike count, the distance and direction of the activity, and the spot's photo. Each spot alerts at most once every 90 minutes.

- Blitzortung is a volunteer network. Its data is free for private, non-commercial use, and coverage around Melbourne is good but not complete.
- GitHub can delay or skip 15-minute runs when busy. Treat this as a "storm's firing up near X" heads-up, not a safety system.
- Stay well back from active cells. If you can hear thunder, you're within striking distance.

## How the scores work (0–100)

| Condition | What it looks at |
|---|---|
| Sunrise / sunset colour | Mid and high cloud as a canvas (best 30–70%), low cloud at the spot **and 50 km toward the sun** (blocks the light), rain chance, bonus for clearing after rain |
| Foggy sunrise | Visibility, humidity, dew-point spread and wind in the 3 hours before sunrise |
| Big swell | Swell height vs your threshold, period and direction, bonus in golden hour and when gusty |
| Electrical storm | Thunderstorm weather codes and CAPE (instability) with rain chance; bonus after dark |
| Milky Way night | Hours of astronomical darkness with the moon down and cloud under your max; bonus when the galactic core is above 10° |
| Aurora australis | NOAA 3-day Kp forecast during darkness vs your minimum Kp, cloud 60 km to the south |
| Wild wind | Daily peak gusts vs your threshold |
| Rainbow chance | Showers with the sun 3–40° up and broken cloud |
| Full moonrise | 85%+ lit moon rising within ~1 hour of sunset (or setting near sunrise), clear horizon |
| Snowfall | Daily snowfall vs your threshold |

You're alerted when a score reaches that location's threshold. Same condition on the same day at several spots is grouped into one line.

Live aurora alerts fire (top priority, at most once every 3 hours) when the real-time estimated Kp reaches the lowest "Min Kp" across your aurora spots, or Bz is strongly southward (≤ −10 nT) with Kp close, and at least one aurora spot is dark.

## Changing the alert times
Times are in `.github/workflows/alerts.yml` as UTC cron lines, two per digest (one for daylight saving, one for standard time). `alert.js` runs whichever matches the current Melbourne offset, so you never get doubles. To move the evening digest to 5:45pm, change `45 7` → `45 6` and `45 8` → `45 7`, and update the `CRONS` table at the top of `alert.js` to match.

## Notes
- `package.json` installs one small library (`ws`) for the lightning feed; the workflow installs it automatically.
- Each part of the repo has one writer: the app writes `config.json` and `ratings.json`, the engine writes `history.json` and `state.json`. That keeps saves from clashing.
- GitHub can start scheduled runs 5–20 minutes late at busy times.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. The engine makes a small commit to `history.json` at least every 30 days to prevent this.
- Forecasts are model output. Treat scores as "worth checking", then confirm on the BoM radar and satellite before driving out.
- Starter coordinates are approximate; fine-tune them to your exact vantage point in the app.
