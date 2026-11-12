# 🏡 HappyTown

A multiplayer classroom review game. Every student gets a plot in a shared town shown on the projector.
Students answer review questions **at their own pace** on their phones to build floors, throw bombs at
rivals and raise shields. The **tallest house** after about 14 minutes wins.

- **Players:** about 20–30 phones (tested with 21), no app and no account: scan the QR code, type the PIN, a Student ID and a name
- **Length:** 3 phases (2 + 5 + 6 minutes), an 8-second rules screen before each, then a 1-minute finale ≈ **14½ minutes**
- **Content:** ships with 90 fun questions from `HappyTown_Questions.xlsx` (brand slogans, tech shortcuts, student life, design thinking & UI/UX, marketing basics, colour psychology), mixed in every phase; edit them on the host screen
- **Phones:** played in **landscape**; Android phones rotate automatically, iPhones show a "turn your phone" hint

---

## 1. How to run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

| Screen | Open |
| --- | --- |
| Projector / lecturer laptop | `http://localhost:3000/host` |
| Students' phones | scan the QR code on the projector, or type the address and enter the PIN |

**Windows:** open the unzipped folder (the one containing `server.js`), click the address bar, type `cmd`, press Enter,
then run the two commands above. Keep that window open while you play. If Windows asks whether Node.js may use the network,
tick both boxes and click **Allow**, otherwise phones can't connect.

### Option A: your laptop on the class Wi-Fi (quickest)
The terminal and the host screen show the address students use, e.g. `http://192.168.1.23:3000`.
Phones must be on the **same Wi-Fi**. If the campus network blocks phone-to-laptop traffic, use a phone hotspot or Option B.

### Option B: put it online for free (works on any network, including 4G)

You get a permanent address like `https://happytown-xxxx.onrender.com`. Anyone with internet can join, on school
Wi-Fi or mobile data. It takes about 10–15 minutes the first time, with two free accounts (GitHub and Render).

**Part 1: put the files on GitHub**
1. Go to [github.com](https://github.com) and sign up (or log in).
2. Click the **+** at the top right → **New repository**. Name it `happytown`, choose **Public**, leave the other options
   as they are, and click **Create repository**.
3. On the new empty page, click **uploading an existing file**.
4. Open the unzipped `happytown` folder on your computer (the one containing `server.js`). Select **all the files and
   folders inside it** and drag them into the GitHub page.
   - **Do not upload** the `node_modules` folder (if you have one) or `happytown.zip`.
   - The `screenshots` and `test` folders are optional; skipping them is fine.
   - GitHub accepts up to 100 files per upload; the project is well under that.
5. Wait until every file shows as uploaded, then click the green **Commit changes** button.
6. Check that you can see `server.js`, `package.json` and the `public` folder in the repository.

**Part 2: start it on Render**
1. Go to [render.com](https://render.com) and click **Get Started**. Choose **Sign in with GitHub** and allow access.
2. Click **New +** → **Web Service**.
3. Choose **Build and deploy from a Git repository**, then pick your `happytown` repository (click **Connect**).
   If it is not listed, click **Configure account** and allow Render to see that repository.
4. Fill in the form:
   | Field | Value |
   | --- | --- |
   | Name | `happytown` (it becomes part of your address; add digits if the name is taken) |
   | Region | the one closest to you (e.g. Singapore) |
   | Branch | `main` |
   | Runtime / Language | **Node** |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |
5. Click **Create Web Service**. Render now builds the game; you can watch the log. After 2–5 minutes it says
   **Live** and shows your address at the top, like `https://happytown-xxxx.onrender.com`.
   (Shortcut: **New + → Blueprint** reads the included `render.yaml` and fills the form for you.)

**Part 3: play**
1. On the laptop connected to the projector open `https://<your-address>.onrender.com/host`.
2. The projector shows the PIN and a QR code. The QR code already contains your online address, so students scan it
   with their own phones on **4G or any Wi-Fi**; nobody has to be on the school network.
3. Everything else works as described in section 2.

**Good to know**
- **Wake it up before class.** The free plan puts the game to sleep after about 15 minutes with no visitors, and the
  first visit afterwards takes about 1 minute to wake it. Open the `/host` page 5 minutes before the lesson.
- **Games live in memory.** If the server restarts (or you change the code), the room disappears; press **New room**.
- **Updating the game later:** upload the changed files to the same GitHub repository (**Add file → Upload files**,
  same file names). Render redeploys by itself in a few minutes.
- **Stuck?** Open your service on Render and click **Logs**. The line "HappyTown is running" means it works.
  If the build fails, check that `package.json` is in the top level of the repository, not inside another folder.

<details>
<summary><b>Tiếng Việt: hướng dẫn chi tiết Option B</b></summary>

Bạn sẽ có một địa chỉ cố định, ví dụ `https://happytown-xxxx.onrender.com`. Ai có internet cũng vào được (Wi-Fi trường
hoặc 4G). Lần đầu mất khoảng 10–15 phút, cần hai tài khoản miễn phí: GitHub và Render.

**Phần 1: đưa file lên GitHub**
1. Vào [github.com](https://github.com), đăng ký hoặc đăng nhập.
2. Bấm dấu **+** ở góc trên bên phải → **New repository**. Đặt tên `happytown`, chọn **Public**, giữ nguyên các tùy chọn
   khác, bấm **Create repository**.
3. Ở trang trống vừa tạo, bấm **uploading an existing file**.
4. Mở thư mục `happytown` đã giải nén trên máy (thư mục có file `server.js`). Chọn **tất cả file và thư mục bên trong**
   rồi kéo thả vào trang GitHub.
   - **Không tải lên** thư mục `node_modules` (nếu có) và file `happytown.zip`.
   - Thư mục `screenshots` và `test` không bắt buộc, có thể bỏ qua.
5. Chờ tất cả file tải xong, bấm nút xanh **Commit changes**.
6. Kiểm tra trong repository có thấy `server.js`, `package.json` và thư mục `public`.

**Phần 2: chạy trên Render**
1. Vào [render.com](https://render.com), bấm **Get Started**, chọn **Sign in with GitHub** và cho phép truy cập.
2. Bấm **New +** → **Web Service**.
3. Chọn **Build and deploy from a Git repository**, chọn repository `happytown` rồi bấm **Connect**. Nếu không thấy,
   bấm **Configure account** và cho Render quyền xem repository đó.
4. Điền form:
   - **Name:** `happytown` (nếu bị trùng thì thêm số)
   - **Region:** gần bạn nhất (ví dụ Singapore)
   - **Branch:** `main`
   - **Runtime / Language:** **Node**
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Bấm **Create Web Service**. Render sẽ cài đặt (xem được nhật ký). Sau 2–5 phút sẽ hiện **Live** và địa chỉ ở phía trên,
   dạng `https://happytown-xxxx.onrender.com`.

**Phần 3: chơi**
1. Trên laptop nối máy chiếu, mở `https://<địa-chỉ-của-bạn>.onrender.com/host`.
2. Màn hình hiện PIN và mã QR. Mã QR đã chứa địa chỉ online, nên các bạn quét bằng điện thoại, **dùng 4G hay Wi-Fi nào
   cũng được**.
3. Các bước còn lại giống như ở mục 2.

**Lưu ý**
- **Đánh thức game trước giờ học:** gói miễn phí sẽ "ngủ" sau khoảng 15 phút không có ai vào, lần vào đầu tiên sau đó mất
  khoảng 1 phút. Hãy mở trang `/host` trước giờ học 5 phút.
- **Game chỉ nằm trong bộ nhớ:** nếu máy chủ khởi động lại thì phòng biến mất, bấm **New room** để tạo lại.
- **Cập nhật game sau này:** tải file mới lên cùng repository GitHub (**Add file → Upload files**, cùng tên file). Render
  tự cập nhật sau vài phút.
- **Bị lỗi:** vào dịch vụ trên Render, bấm **Logs**. Thấy dòng "HappyTown is running" là chạy tốt. Nếu build lỗi, kiểm tra
  `package.json` nằm ở cấp ngoài cùng của repository, không nằm trong thư mục khác.

</details>

---

## 2. Running a session

1. **Projector:** open `/host`. A room is created with a big **PIN** and QR code.
2. **Students** scan the QR code, enter the PIN, their **Student ID** and **name**, pick an avatar and tap **Join**.
   Their empty plot pops up in the town.
3. Click **▶ Start game**. Each phase opens with an 8-second rules screen (click **Let's go!** to skip it).
4. Students play at their own pace; the projector shows the town, the phase timeline and countdown, and the **Town news** ticker.
5. **Finale:** fireworks, the podium is revealed (3rd → 2nd → 1st), then the leaderboard, awards and the class's
   **most-missed questions**. Each phone shows the student's rank and their personal **review list**.

### Admin panel (hidden) — press **A**
The projector stays clean; the lecturer opens the admin panel with the **A** key (or the faint ⚙ in the corner).
F12 is not used because browsers reserve it for their developer tools.

| Tab | What it does |
| --- | --- |
| 🎮 Game | Pause / Resume, Skip (start the phase now / end the phase now / skip the finale), End game, sound, full screen, all settings |
| 👥 Players | Name, Student ID, online status, floors, accuracy · **Kick** · **Reset** (frees a frozen phone so the student can rejoin) |
| 📚 Questions | Search and fix a question (typo, wrong answer) **during the game**; add questions; spreadsheet import/export |
| 💣 Damage | Change bomb damage, Mega and Mini Bombs, shield strength and floors per correct answer, **even during the game** (see section 6) |
| 🧾 Event log | Every bomb, shield and phase change in the order the server applied it, with its queue number and time |

Shortcuts: **A** admin panel · **P** pause/resume · **F** full screen · **Esc** close the panel.

### Lost connection?
The student scans the QR code again and joins with the **same Student ID**: their house, floors and progress come back
exactly as they were. While a phone is offline its own question timer waits (the phase timer keeps running).
A refreshed phone reconnects by itself. If the old phone still "holds" the seat (it froze but shows 🟢 online),
press **Reset** in the Players tab first.

---

## 3. Rules

| Phase | Time | Questions | Rewards |
| --- | --- | --- | --- |
| 🌱 1 · Warm-up & Foundation | 2 min | single questions, ~15 s each, max **18** | each correct answer **+1 floor** |
| ⚡ 2 · Interaction & Accumulation | 5 min | sets of 3, ~20 s each, max **9 sets** | **2/3** → +1 floor · **3/3** → +1 floor **+ a bomb** |
| ♟️ 3 · Tactical Decision | 6 min | sets of 3, max **10 sets** | **2/3 or 3/3** → +3 floors · **3/3** → also **Mega Bomb or Shield** |
| 🏆 Finale | 1 min | — | fireworks, podium, leaderboard |

**Answering:** a correct answer jumps straight to the next question. A wrong answer shows the right answer (and a
short explanation) for 3 seconds. Each phase ends on its timer, not when everyone is done; players who reach the
maximum watch the town until the next phase.

**💣 Phase 2 bombs**
- A perfect set earns a bomb that destroys **2 floors**. You have **5 seconds** to throw it: **Quick Lock** buttons
  target the current **Top 1, 2 and 3**, and a scrolling carousel shows everyone else.
- Or **hold** it: each further perfect set in a row adds **+2 damage** (2 → 4 → 6, max 3 sets).
- If you hold and your next set is not 3/3, the bomb is **lost**. Bombs still held when the phase ends are lost too.

**♟️ Phase 3: Mega Bomb, Mini Bombs and Shield**
- **🛡️ Shield:** blocks up to **5 floors** of the **next bomb** that hits you, then disappears. It has no time limit
  (it stays until a bomb hits it, or until Phase 3 ends). Any bomb uses it up, even a 1-floor Mini Bomb, and a
  Mega Bomb (5) on a shield destroys nothing.
- **💣 Mega Bomb:** destroys 5 floors. Throw it (5 s) or hold it. Holding it, your next perfect set adds one
  **Mini Bomb** (1 floor); each further perfect set in a row adds **+2** to it (1 → 3 → 5, max 3 times).
  A full arsenal is Mega 5 + Mini 5 = 10 floors.
- **Free throwing:** throw your bombs at **any house**, even the same house twice (5 s, +2 s when you also have a Mini;
  a bomb you have not aimed when time runs out flies at the top house automatically).
- If you hold and your next set is not 3/3, **all** your bombs are lost (the floors from 2/3 are kept).
- No choice within 5 seconds = Shield.

**💥 Who bombed me?** Every bomb that hits a player is stored on the server with the attacker's name and avatar.
The victim's phone shows a big card for each hit (*"💥 Linh bombed you! Mega Bomb · −5 floors"*), several cards can
be on screen at once, the status bar shows the last attacker for 30 seconds, and the phone vibrates. A phone that was
offline gets a summary when it comes back (*"3 bombs hit you while you were away"*). The end-of-phase and results
screens list who bombed you and how many floors each attacker destroyed. On the projector, the house that was hit
shows the damage with the attacker's avatar, and the **Town news** ticker names both players.

**🔁 Spaced repetition:** a missed (or timed-out) question goes on the player's waiting list and comes back
**2–4 questions later** in a random upcoming slot, again and again until it is answered correctly; only then
is it removed. At most 2 review questions share a set, so fresh material keeps coming. Every player has their own
question order, so copying a neighbour doesn't help.

**🏆 Winning:** tallest house wins; ties go to the player with more correct answers.

---

## 4. Technical design

- **Stack:** Node.js + Express (web pages) + Socket.IO (live connection). The server is the single source of truth;
  phones and the projector only display what it sends.
- **Asynchronous players, real-time host:** each player has their own state machine on the server
  (*question → feedback → set result → choose → throw window → next*), with their own timers. The projector
  receives the shared town state 4 times per second plus instant events (bombs, shields) for the animations.
- **Race conditions (pessimistic lock + event queue):** every action that changes the game (answers, throws, holds,
  shield choices, timeouts, joins, kicks) is put in **one first-in-first-out queue per room** and applied while the room
  is locked (`enqueue()` in `server.js`). Floors are only ever changed by `applyDamage()` inside that queue, so if two
  bombs hit the same house in the same millisecond they are applied **one after the other**, each starting from the
  floors the previous one left. Example from a test run:
  ```
  #160  Perfect Pam → Mixed Mia: Bomb (2) · floors 19→17
  #161  Shield Sam  → Mixed Mia: Bomb (2) · floors 17→15
  ```
  You can watch this live in the admin panel's **Event log**.
- **Pause:** the server runs on a virtual clock that stops while paused, so every countdown (phase, question,
  throw window) freezes and resumes exactly.
- **Reconnect:** players are identified by Student ID (and a token stored on the phone); a second device cannot take
  over a seat that is still connected unless the host presses Reset.

---

## 5. Questions

Admin panel → **📚 Questions**:
- **Fix a question:** search, click it, edit, Save. It applies immediately, even mid-game.
- **Replace the whole bank from Excel or Google Sheets** (before or after a game): select the whole sheet **including the
  header row**, copy, paste it into the box, then *Replace bank with these*. Columns are found by their header names:
  `Question`, `Option A`–`Option D`, `Correct` / `Correct Answer` (a letter A–D or the answer text), and optional
  `Explanation` and `Level` / `Phase` (`Easy`/`Hard` or `Phase 1` / `Phase 2 & 3`). Other columns such as `No.` and
  `Topic` are ignored, so the layout of `HappyTown_Questions.xlsx` works as it is. Leave C/D empty for True/False.
  `questions-template.csv` holds the current default bank in that layout.
- **Mixing:** by default every phase draws from the whole bank (admin panel → Settings → *Mix all questions in every
  phase*). Turn it off to use the `Phase 1` (Easy) questions in Phase 1 and the `Phase 2 & 3` (Hard) ones afterwards.
- A very fast student can see up to 75 questions (18 + 27 + 30), so keep at least ~80 questions to avoid repeats.
- Your edited bank is remembered in that browser for new rooms; *Default bank* switches back.
- The earlier *Creativity Practice* bank (132 questions with explanations) is kept in `questions-creativity-practice.csv`;
  paste it in the same way to use it.

To change the built-in bank permanently, edit `questions.js`.

## 6. Settings (admin panel → Game)

| Setting | Default |
| --- | --- |
| Phase 1 / 2 / 3 timers | 2 / 5 / 6 min |
| Finale | 60 s |
| Rules screen before each phase | 8 s (0 = none) |
| Time per question: Phase 1 / Phases 2–3 | 15 s / 20 s |
| Show the right answer after a miss | 3 s |
| Throw window | 5 s (+2 s when you also have a Mini Bomb) |
| Shield / Mega choice | 5 s |
| Maximum per player: Phase 1 questions / Phase 2 sets / Phase 3 sets | 18 / 9 / 10 |
| Shuffle answer options | on (True/False keeps its order) |
| Mix all questions in every phase | on |

### Damage, shields and floors (admin panel → 💣 Damage)

| Rule | Default |
| --- | --- |
| Phase 1: floors per correct answer | 1 |
| Phase 2: floors for 2/3 or 3/3 | 1 |
| Phase 2: bomb damage · extra damage each time it is held · levels | 2 · +2 · 3 (2 → 4 → 6) |
| Phase 3: floors for 2/3 or 3/3 | 3 |
| Phase 3: Mega Bomb damage | 5 |
| Phase 3: Mini Bomb damage · extra each time it is held · levels | 1 · +2 · 3 (1 → 3 → 5) |
| Phase 3: Shield blocks up to (one bomb) | 5 |

Each group shows a live preview (e.g. *Bomb: 2 → 4 → 6*). Press **Save damage & floors**: the numbers apply at once, even
mid-game (bombs being held follow the new numbers; shields already up keep their strength), and the rules screens and
phones show them. The numbers are remembered in that browser for new rooms; **Reset to defaults** goes back.

**Practice alone:** in the lobby click **🤖 Add bot** a few times, then join from your phone.

---

## 7. Testing

`npm test` starts a server on port 3999 and plays a complete fast game with scripted players and bots. It checks:
- simultaneous bombs are applied sequentially (no lost update);
- missed questions come back, spaced, until answered correctly;
- per-phase maximums;
- Phase 2 bombs stack 2 → 4 → 6;
- the Phase 3 Mini Bomb grows 1 → 3 → 5 and can hit the same house as the Mega;
- held bombs are lost on a broken streak and at phase end;
- a Shield blocks up to 5 floors of one bomb and then disappears (no time limit);
- every victim's phone has a record of who bombed them;
- questions are mixed in every phase (default setting);
- a second short game with damage and floors changed by the host uses the new numbers;
- rejoining on a new phone with the same Student ID restores the house;
- pause freezes the timers;
- a question can be fixed mid-game.

## Project structure

```
server.js              game server: rules, timers, action queue, rooms, bots
questions.js           default question bank (90 questions from HappyTown_Questions.xlsx)
questions-template.csv the same bank as a spreadsheet (No. | Phase | Topic | Question | Option A–D | Correct Answer)
questions-creativity-practice.csv  the earlier Creativity Practice bank, ready to paste into the admin panel
public/host.html       projector screen + admin panel    public/js/host.js
public/index.html      phone screen (landscape)           public/js/player.js
public/js/town.js      the animated town (houses, bombs, shields)
public/js/common.js    shared rules text and helpers
public/css/style.css   all styles
test/simulate.js       full-game simulation with rule checks (npm test)
```
