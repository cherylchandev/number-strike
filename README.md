# 🎯 Number Strike

A fast-paced math arcade game. Solve the equation, throw the right number of knives into the spinning oak target, and submit an answer before the timer runs out. Climb the global leaderboard!

**▶ Play it here:** https://number-strike.vercel.app/

---

## 🎮 How to Play

1. An equation appears at the top of the screen. Solve for the **?** within 20 seconds.
2. Throw the correct number of knives into the oak target, then hit **✔ Submit**.
3. Hit **↺ Retry** if you throw the wrong number of knives.
4. You start with **❤❤❤ three hearts**. You lose one if you:
   - Submit a wrong answer
   - Run out of time
   - Throw knives that collide with each other
   - Throw knives into an empty space on the oak target
5. Catch the bonus 🪙 coin when it appears for extra points!

### Controls

| Platform | Action |
|---|---|
| 📱 **Mobile** | Tap the screen |
| 💻 **PC** | Mouse click · `Space` = throw · `R` = retry · `Enter` = submit |

### Scoring

- **10 points** — correct answer on the first try/ hitting the bonus coin
- **5 points** — correct answer after a retry

---

## 🔒 A Note on the Firebase API Key

You may notice the Firebase config is committed in `js/firebase-config.js`. That's intentional and safe: Firebase web API keys are **not secrets** — they're public project identifiers that ship with every browser app and are always visible in the browser's DevTools. The real protection comes from **Firestore Security Rules**, which control who can read and write the leaderboard. The data is protected by those rules, not by hiding the key.

For more information, please refer to https://firebase.google.com/docs/projects/api-keys

---

## 🙏 Credits & Acknowledgements

This game is built with these free and open resources — thank you to their creators:

- **Emoji graphics** — [Twemoji](https://github.com/jdecked/twemoji), © Twitter, Inc. and other contributors. Licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). The Twemoji code is licensed under [MIT](https://opensource.org/licenses/MIT).
- **Comic Neue** font — by Craig Rozynski, served via [Google Fonts](https://fonts.google.com/specimen/Comic+Neue). Licensed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
