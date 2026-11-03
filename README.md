# Morse Key

A one-button Morse code trainer and live chat. It is a static site: three files, no build step.

| File | What it does |
| --- | --- |
| `index.html` | The whole app (Learn, Chat, Guide). |
| `config.js` | Your Supabase project URL and anon key. |
| `supabase-room.js` | Connects Chat to Supabase Realtime. |

Learn, Train, the Guide and the key sound work with no setup. Live Chat needs a free Supabase project.

## 1. Set up Supabase (about 3 minutes)

1. Create a project at https://supabase.com. The free plan is enough.
2. Open **Project Settings > API**. Copy the **Project URL** and the **anon public** key.
3. Paste both into `config.js`:

   ```js
   window.MORSE_CONFIG = {
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi...'
   };
   ```

4. Open **Project Settings > Realtime** and keep **Allow public access** switched on. Chat uses public Broadcast channels, so no tables, policies or SQL are needed.

The anon key is designed to be public, so it is safe to commit. Never put the `service_role` key in this project.

## 2. Try it locally

Browsers only play audio and open realtime connections from `http://localhost` or `https`, so use a small server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Open the address in two browser windows, join the same room code in both, and hold the key in one.

## 3. Deploy to Vercel

1. Push this folder to a GitHub repository, with `index.html` at the top level.
2. In Vercel choose **Add New > Project** and import the repository.
3. Set **Framework Preset** to **Other**. Leave the build command and output directory empty.
4. Press **Deploy**.

Every push to the main branch redeploys automatically.

## How chat works

- Rooms are Supabase Broadcast channels named `morse:<room code>`. Nothing is stored.
- Anyone with the site link and the same room code can join, so use a hard-to-guess code for a private chat.
- Audio mode sends a signal when the key goes down and when it comes up. Friends hear the tone for as long as you hold. Network delay can stretch or squash a beep slightly.
- Text mode sends the message as letters. It arrives as a strip of dots and dashes that plays as beeps, with a Text button to read it.
- If `config.js` still has the placeholders, or the connection fails, the chat status shows LOCAL and messages stay on that device.

## Limits to know

- The Supabase free plan allows about 200 simultaneous connections and 100 messages per second for the whole project. That is plenty for friends. Each key press sends a few small messages.
- Public rooms can be spammed by anyone who knows the code and the site address. If you need private rooms, add Supabase Auth and private channels later.
